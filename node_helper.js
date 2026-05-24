/**
 * node_helper.js – MMM-TadoOverview
 *
 * Handles all communication with the Tado REST API v2.
 *
 * Authentication flow (OAuth2 password grant):
 *   POST https://auth.tado.com/oauth/token
 *       → access_token + expires_in
 *
 * Data flow:
 *   GET /api/v2/me                                → homeId
 *   GET /api/v2/homes/{homeId}/zones              → zone list
 *   GET /api/v2/homes/{homeId}/zones/{id}/state   → temperature / humidity
 */

"use strict";

const NodeHelper = require("node_helper");
const https      = require("https");
const http       = require("http");

// ── Tado OAuth2 constants (publicly known, intentionally shipped) ──────────
const TADO_AUTH_HOST   = "auth.tado.com";
const TADO_API_HOST    = "my.tado.com";
const OAUTH_CLIENT_ID  = "tado-web-app";
const OAUTH_CLIENT_SECRET = "wZaRN7rpjn3FoNyF5IFuxg9uMzYJcvvR";

module.exports = NodeHelper.create({

  start() {
    console.log(`[MMM-TadoOverview] Node helper started.`);
    this.config       = null;
    this.accessToken  = null;
    this.tokenExpiry  = 0;      // Unix ms timestamp
    this.homeId       = null;
    this.timer        = null;
  },

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  },

  // ── Socket notifications from the browser module ─────────────────────────

  socketNotificationReceived(notification, payload) {
    if (notification === "TADO_CONFIG") {
      this.config = payload;

      // Clear any existing timer first
      if (this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }

      // Initial fetch, then on interval
      this.fetchAllRooms();
      this.timer = setInterval(
        () => this.fetchAllRooms(),
        this.config.updateInterval
      );
    }
  },

  // ── OAuth2 authentication ─────────────────────────────────────────────────

  async ensureToken() {
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return; // token still valid
    }

    const body = new URLSearchParams({
      client_id:     OAUTH_CLIENT_ID,
      client_secret: OAUTH_CLIENT_SECRET,
      grant_type:    "password",
      username:      this.config.username,
      password:      this.config.password,
      scope:         "home.user"
    }).toString();

    const data = await this.httpsRequest({
      hostname: TADO_AUTH_HOST,
      path:     "/oauth/token",
      method:   "POST",
      headers:  {
        "Content-Type":   "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(body)
      }
    }, body);

    if (!data.access_token) {
      throw new Error(
        data.error_description || data.error || "Authentication failed"
      );
    }

    this.accessToken = data.access_token;
    // Subtract 60 s buffer so we refresh slightly before actual expiry
    this.tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
    console.log("[MMM-TadoOverview] Token acquired.");
  },

  // ── Tado API helpers ──────────────────────────────────────────────────────

  async tadoGet(path) {
    await this.ensureToken();
    return this.httpsRequest({
      hostname: TADO_API_HOST,
      path,
      method:   "GET",
      headers:  { Authorization: `Bearer ${this.accessToken}` }
    });
  },

  async getHomeId() {
    if (this.homeId) return this.homeId;
    const me = await this.tadoGet("/api/v2/me");
    if (!me.homes || me.homes.length === 0) {
      throw new Error("No Tado home found for this account.");
    }
    this.homeId = me.homes[0].id;
    console.log(`[MMM-TadoOverview] Using home ID: ${this.homeId}`);
    return this.homeId;
  },

  // ── Main data fetch ───────────────────────────────────────────────────────

  async fetchAllRooms() {
    try {
      const homeId = await this.getHomeId();

      // All zones for this home
      const zones = await this.tadoGet(`/api/v2/homes/${homeId}/zones`);

      // Only heating zones have temperature/humidity sensor data
      const heatingZones = zones.filter(z => z.type === "HEATING");

      // Optional zone ID filter from config
      const filtered =
        this.config.roomIds && this.config.roomIds.length > 0
          ? heatingZones.filter(z => this.config.roomIds.includes(z.id))
          : heatingZones;

      if (filtered.length === 0) {
        this.sendSocketNotification("TADO_DATA", []);
        return;
      }

      // Fetch all zone states in parallel
      const rooms = await Promise.all(
        filtered.map(zone => this.fetchZoneState(homeId, zone))
      );

      // Sort alphabetically by room name
      rooms.sort((a, b) => a.name.localeCompare(b.name));

      this.sendSocketNotification("TADO_DATA", rooms);

    } catch (err) {
      console.error("[MMM-TadoOverview] Error fetching data:", err.message);
      // Reset cached token and home ID on auth errors
      if (err.message.includes("401") || err.message.includes("auth")) {
        this.accessToken = null;
        this.homeId      = null;
      }
      this.sendSocketNotification("TADO_ERROR", err.message);
    }
  },

  async fetchZoneState(homeId, zone) {
    const state = await this.tadoGet(
      `/api/v2/homes/${homeId}/zones/${zone.id}/state`
    );

    const inside = state.sensorDataPoints?.insideTemperature;
    const hum    = state.sensorDataPoints?.humidity;
    const heat   = state.activityDataPoints?.heatingPower;

    return {
      id:           zone.id,
      name:         zone.name,
      temperature:  inside  != null ? inside.celsius   : null,
      humidity:     hum     != null ? hum.percentage   : null,
      heatingPower: heat    != null ? heat.percentage  : 0,
      tadoMode:     state.tadoMode         || null,
      overlayType:  state.overlay?.type    || null
    };
  },

  // ── Low-level HTTPS helper ────────────────────────────────────────────────

  httpsRequest(options, body = null) {
    return new Promise((resolve, reject) => {
      const protocol = options.port === 80 ? http : https;

      const req = protocol.request(options, res => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data",  chunk => { raw += chunk; });
        res.on("end", () => {
          if (res.statusCode >= 400) {
            reject(new Error(
              `HTTP ${res.statusCode} on ${options.path}: ${raw.slice(0, 200)}`
            ));
            return;
          }
          try {
            resolve(JSON.parse(raw));
          } catch {
            // Some endpoints return empty body on success
            resolve({});
          }
        });
      });

      req.on("error", reject);

      if (body) req.write(body);
      req.end();
    });
  }
});
