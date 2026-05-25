/**
 * node_helper.js – MMM-TadoOverview
 *
 * Authentication: OAuth2 Device Code Grant Flow (RFC 8628)
 *   Tado switched from password grant to device code grant on 21 March 2025.
 *   Docs: https://support.tado.com/en/articles/8565472-how-do-i-authenticate-to-access-the-rest-api
 *
 * First run:
 *   1. POST /oauth2/device_authorize  → device_code, user_code, verification_uri
 *   2. Module shows user_code + URL on the mirror
 *   3. User visits the URL on any device and logs in with their Tado account
 *   4. Module polls /oauth2/token until approved
 *   5. Tokens are saved to .tado-tokens.json (gitignored)
 *
 * Subsequent runs:
 *   - Refresh token is loaded from .tado-tokens.json
 *   - Access token is refreshed silently before every expiry (token rotation)
 *   - If refresh token is expired (> 30 days unused), device code flow restarts
 */

"use strict";

const NodeHelper = require("node_helper");
const https      = require("https");
const fs         = require("fs");
const path       = require("path");
const QRCode     = require("qrcode");

// ── Tado / OAuth constants ────────────────────────────────────────────────────
const TADO_AUTH_HOST = "login.tado.com";
const API_HOST_V3    = "my.tado.com";    // Tado V3+ devices
const API_HOST_X     = "hops.tado.com";  // Tado Generation X (LINE_X)
const CLIENT_ID      = "1bb50063-6b0c-4d11-bd99-387f4a91cc46";
const SCOPE          = "offline_access";
const TOKEN_FILE     = path.join(__dirname, ".tado-tokens.json");

// ── Auth states ───────────────────────────────────────────────────────────────
const STATE = {
  IDLE:          "IDLE",
  AWAITING_AUTH: "AWAITING_AUTH",
  AUTHENTICATED: "AUTHENTICATED"
};

module.exports = NodeHelper.create({

  start() {
    console.log("[MMM-TadoOverview] Node helper started.");
    this.config       = null;
    this.authState    = STATE.IDLE;
    this.accessToken  = null;
    this.tokenExpiry  = 0;
    this.refreshToken = null;
    this.homeId       = null;
    this.apiHost      = API_HOST_V3;   // updated after /me reveals the device generation
    this.dataTimer    = null;
    this.pollTimer    = null;
  },

  stop() {
    clearInterval(this.dataTimer);
    clearTimeout(this.pollTimer);
  },

  // ── Entry point ─────────────────────────────────────────────────────────────

  socketNotificationReceived(notification, payload) {
    if (notification === "TADO_CONFIG") {
      this.config = payload;
      this.initialize();
    }
  },

  async initialize() {
    clearInterval(this.dataTimer);
    clearTimeout(this.pollTimer);

    // Try stored refresh token first
    const stored = this.loadStoredTokens();
    if (stored?.refreshToken) {
      console.log("[MMM-TadoOverview] Found stored refresh token, using it.");
      this.refreshToken = stored.refreshToken;
      this.authState    = STATE.AUTHENTICATED;
      this.startDataFetching();
      return;
    }

    // No token on disk → start device code flow
    await this.startDeviceCodeFlow();
  },

  // ── Device Code Flow ────────────────────────────────────────────────────────

  async startDeviceCodeFlow() {
    console.log("[MMM-TadoOverview] Starting device code authorization flow …");
    try {
      const body = this.encodeForm({ client_id: CLIENT_ID, scope: SCOPE });
      const res  = await this.authPost("/oauth2/device_authorize", body);

      if (!res.device_code) {
        throw new Error("No device_code in response: " + JSON.stringify(res));
      }

      this.authState = STATE.AWAITING_AUTH;

      // Generate QR code as inline SVG so the user can scan instead of typing the URL
      const verificationUri = res.verification_uri_complete || res.verification_uri;
      let qrSvg = null;
      try {
        qrSvg = await QRCode.toString(verificationUri, {
          type:          "svg",
          margin:        1,
          color:         { dark: "#000000", light: "#ffffff" },
          errorCorrectionLevel: "M"
        });
      } catch (qrErr) {
        console.warn("[MMM-TadoOverview] QR code generation failed:", qrErr.message);
      }

      this.sendSocketNotification("TADO_AUTH_REQUIRED", {
        userCode:        res.user_code,
        verificationUri: verificationUri,
        expiresIn:       res.expires_in,
        qrSvg:           qrSvg
      });

      this.pollForToken(
        res.device_code,
        res.interval   ?? 5,
        res.expires_in ?? 300
      );

    } catch (err) {
      console.error("[MMM-TadoOverview] Device code flow error:", err.message);
      this.sendSocketNotification("TADO_ERROR", `Auth start failed: ${err.message}`);
    }
  },

  pollForToken(deviceCode, intervalSec, expiresIn) {
    const deadline = Date.now() + expiresIn * 1000;

    const attempt = async () => {
      if (Date.now() >= deadline) {
        this.sendSocketNotification(
          "TADO_ERROR",
          "Authentifizierung abgelaufen. Bitte MagicMirror neu starten."
        );
        return;
      }

      try {
        const body = this.encodeForm({
          client_id:   CLIENT_ID,
          device_code: deviceCode,
          grant_type:  "urn:ietf:params:oauth:grant-type:device_code"
        });

        // Accept both 200 (approved) and 400 (pending / slow_down)
        const { status, data } = await this.authPostRaw("/oauth2/token", body);

        if (status === 200 && data.access_token) {
          // ── Authorised ────────────────────────────────────────────────────
          console.log("[MMM-TadoOverview] Device authorised – tokens received.");
          this.accessToken  = data.access_token;
          this.tokenExpiry  = Date.now() + (data.expires_in - 10) * 1000;
          this.refreshToken = data.refresh_token;
          this.saveTokens({ refreshToken: data.refresh_token });
          this.authState = STATE.AUTHENTICATED;
          this.startDataFetching();

        } else if (data.error === "slow_down") {
          // Server asked us to back off
          this.pollTimer = setTimeout(attempt, (intervalSec + 5) * 1000);

        } else if (
          data.error === "authorization_pending" ||
          data.error === "authorization_declined" ||
          status === 400
        ) {
          // Still waiting
          this.pollTimer = setTimeout(attempt, intervalSec * 1000);

        } else {
          throw new Error(data.error_description || data.error || `HTTP ${status}`);
        }

      } catch (err) {
        // Network hiccup – retry rather than give up
        console.warn("[MMM-TadoOverview] Poll error (will retry):", err.message);
        this.pollTimer = setTimeout(attempt, intervalSec * 1000);
      }
    };

    // First poll after interval
    this.pollTimer = setTimeout(attempt, intervalSec * 1000);
  },

  // ── Token management ────────────────────────────────────────────────────────

  async ensureAccessToken() {
    if (this.accessToken && Date.now() < this.tokenExpiry) return;

    if (!this.refreshToken) {
      throw new Error("Kein Refresh-Token vorhanden. Bitte neu anmelden.");
    }

    console.log("[MMM-TadoOverview] Refreshing access token …");
    const body = this.encodeForm({
      client_id:     CLIENT_ID,
      grant_type:    "refresh_token",
      refresh_token: this.refreshToken
    });

    let data;
    try {
      data = await this.authPost("/oauth2/token", body);
    } catch (err) {
      // Refresh token likely expired (> 30 days) → restart device code flow
      console.warn("[MMM-TadoOverview] Refresh failed – restarting auth:", err.message);
      this.refreshToken = null;
      this.accessToken  = null;
      this.tokenExpiry  = 0;
      this.homeId       = null;
      this.apiHost      = API_HOST_V3;   // reset to default until /me is called again
      this.deleteStoredTokens();
      clearInterval(this.dataTimer);
      this.dataTimer = null;
      await this.startDeviceCodeFlow();
      throw new Error("Refresh-Token abgelaufen – bitte neu authentifizieren.");
    }

    this.accessToken = data.access_token;
    this.tokenExpiry = Date.now() + (data.expires_in - 10) * 1000;

    // Tado uses refresh token rotation – always save the newest token
    if (data.refresh_token) {
      this.refreshToken = data.refresh_token;
      this.saveTokens({ refreshToken: data.refresh_token });
    }
  },

  // ── Data fetching ────────────────────────────────────────────────────────────

  startDataFetching() {
    if (this.dataTimer) clearInterval(this.dataTimer);
    this.fetchAllRooms();
    this.dataTimer = setInterval(
      () => this.fetchAllRooms(),
      this.config.updateInterval
    );
  },

  async fetchAllRooms() {
    try {
      const homeId = await this.getHomeId();
      const zones  = await this.tadoGet(`/api/v2/homes/${homeId}/zones`);

      const heatingZones = zones.filter(z => z.type === "HEATING");

      console.log(
        `[MMM-TadoOverview] ${heatingZones.length} Raum/Räume von der Tado API erhalten:`,
        heatingZones.map(z => `"${z.name}" (ID ${z.id})`).join(", ")
      );

      if (heatingZones.length === 0) {
        this.sendSocketNotification("TADO_DATA", []);
        return;
      }

      const rooms = await Promise.all(
        heatingZones.map(zone => this.fetchZoneState(homeId, zone))
      );

      rooms.sort((a, b) => a.name.localeCompare(b.name));
      this.sendSocketNotification("TADO_DATA", rooms);

    } catch (err) {
      console.error("[MMM-TadoOverview] fetchAllRooms error:", err.message);
      this.sendSocketNotification("TADO_ERROR", err.message);
    }
  },

  async fetchZoneState(homeId, zone) {
    const state  = await this.tadoGet(`/api/v2/homes/${homeId}/zones/${zone.id}/state`);
    const inside = state.sensorDataPoints?.insideTemperature;
    const hum    = state.sensorDataPoints?.humidity;
    const heat   = state.activityDataPoints?.heatingPower;

    return {
      id:           zone.id,
      name:         zone.name,
      temperature:  inside != null ? inside.celsius    : null,
      humidity:     hum    != null ? hum.percentage    : null,
      heatingPower: heat   != null ? heat.percentage   : 0,
      tadoMode:     state.tadoMode      || null,
      overlayType:  state.overlay?.type || null
    };
  },

  async getHomeId() {
    if (this.homeId) return this.homeId;

    // Step 1: /api/v2/me → home ID (always on my.tado.com, common entry point)
    const me = await this.tadoGet("/api/v2/me");
    if (!me.homes?.length) throw new Error("Kein Tado-Zuhause für dieses Konto gefunden.");
    this.homeId = me.homes[0].id;
    console.log(`[MMM-TadoOverview] Home ID: ${this.homeId}`);

    // Step 2: /api/v2/homes/{homeId} → generation field
    // This call still goes to my.tado.com (this.apiHost is still API_HOST_V3 here)
    const homeInfo = await this.tadoGet(`/api/v2/homes/${this.homeId}`);
    const generation = homeInfo.generation ?? "unbekannt";

    if (generation === "LINE_X") {
      this.apiHost = API_HOST_X;
      console.log(`[MMM-TadoOverview] Tado Generation X erkannt (${generation}) → API-Host: ${API_HOST_X}`);
    } else {
      this.apiHost = API_HOST_V3;
      console.log(`[MMM-TadoOverview] Tado Generation V3 erkannt (${generation}) → API-Host: ${API_HOST_V3}`);
    }

    return this.homeId;
  },

  async tadoGet(path) {
    await this.ensureAccessToken();
    return this.httpsRequest({
      hostname: this.apiHost,
      path,
      method:   "GET",
      headers:  { Authorization: `Bearer ${this.accessToken}` }
    });
  },

  // ── Token persistence ────────────────────────────────────────────────────────

  loadStoredTokens() {
    try {
      if (fs.existsSync(TOKEN_FILE)) {
        return JSON.parse(fs.readFileSync(TOKEN_FILE, "utf8"));
      }
    } catch (e) {
      console.warn("[MMM-TadoOverview] Could not read token file:", e.message);
    }
    return null;
  },

  saveTokens(tokens) {
    try {
      fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2), { mode: 0o600 });
    } catch (e) {
      console.warn("[MMM-TadoOverview] Could not save token file:", e.message);
    }
  },

  deleteStoredTokens() {
    try {
      if (fs.existsSync(TOKEN_FILE)) fs.unlinkSync(TOKEN_FILE);
    } catch (e) {
      console.warn("[MMM-TadoOverview] Could not delete token file:", e.message);
    }
  },

  // ── HTTP helpers ─────────────────────────────────────────────────────────────

  /** POST to auth host, expect 200, resolve parsed JSON or throw. */
  authPost(path, bodyStr) {
    return this.httpsRequest({
      hostname: TADO_AUTH_HOST,
      path,
      method:   "POST",
      headers:  {
        "Content-Type":   "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(bodyStr)
      }
    }, bodyStr);
  },

  /**
   * POST to auth host, resolve { status, data } for ANY status code.
   * Used during polling where 400 + authorization_pending is normal.
   */
  authPostRaw(path, bodyStr) {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: TADO_AUTH_HOST,
        path,
        method:  "POST",
        headers: {
          "Content-Type":   "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(bodyStr)
        }
      };

      const req = https.request(options, res => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data",  chunk => { raw += chunk; });
        res.on("end",   () => {
          let data = {};
          try { data = JSON.parse(raw); } catch {}
          resolve({ status: res.statusCode, data });
        });
      });

      req.on("error", reject);
      req.write(bodyStr);
      req.end();
    });
  },

  /** Generic HTTPS GET – expects 2xx, resolves parsed JSON or throws. */
  httpsRequest(options, body = null) {
    return new Promise((resolve, reject) => {
      const req = https.request(options, res => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data",  chunk => { raw += chunk; });
        res.on("end",   () => {
          if (res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode} for ${options.path}: ${raw.slice(0, 300)}`));
            return;
          }
          try   { resolve(JSON.parse(raw)); }
          catch { resolve({}); }
        });
      });

      req.on("error", reject);
      if (body) req.write(body);
      req.end();
    });
  },

  encodeForm(params) {
    return new URLSearchParams(params).toString();
  }
});
