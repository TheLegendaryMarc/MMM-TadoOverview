/**
 * MMM-TadoOverview
 *
 * Displays Tado room temperatures and humidity as colour-coded tiles.
 *
 * Authentication uses the OAuth2 Device Code Grant Flow (RFC 8628).
 * On first start the mirror shows a short code + URL – visit the URL
 * on any device, log in with your Tado account, and the module
 * activates automatically. The refresh token is stored locally so
 * subsequent starts require no action from the user.
 *
 * Tile colour is based on temperature thresholds (all configurable):
 *   cold   < tempCold   → blue
 *   cool   < tempNormal → teal
 *   warm   < tempHot    → orange
 *   hot   >= tempHot    → red
 */

Module.register("MMM-TadoOverview", {

  defaults: {
    // ── Room filter ───────────────────────────────────────────────────────
    // Leave empty [] to display ALL rooms, or specify zone IDs: [1, 2, 5]
    roomIds: [],

    // ── Refresh interval ─────────────────────────────────────────────────
    updateInterval: 5 * 60 * 1000,   // 5 minutes

    // ── Temperature thresholds (°C) ───────────────────────────────────────
    tempCold:   18,
    tempNormal: 22,
    tempHot:    25,

    // ── Display options ───────────────────────────────────────────────────
    showHumidity:      true,
    showHeatingPower:  true,
    showManualOverlay: true,
    showTadoMode:      false,  // HOME / AWAY badge
    units:             "metric"   // "metric" = °C | "imperial" = °F
  },

  // ── Lifecycle ────────────────────────────────────────────────────────────

  start() {
    Log.info("[MMM-TadoOverview] Starting …");
    this.rooms     = [];
    this.error     = null;
    this.authInfo  = null;   // set while waiting for device authorisation
    this.loaded    = false;

    this.sendSocketNotification("TADO_CONFIG", {
      roomIds:        this.config.roomIds,
      updateInterval: this.config.updateInterval,
      units:          this.config.units
    });
  },

  getStyles() {
    return ["MMM-TadoOverview.css"];
  },

  getHeader() {
    return this.data.header || "";
  },

  // ── Socket communication ─────────────────────────────────────────────────

  socketNotificationReceived(notification, payload) {
    switch (notification) {

      case "TADO_AUTH_REQUIRED":
        // Device code flow – show instructions on the mirror
        this.authInfo = payload;
        this.error    = null;
        this.loaded   = false;
        this.updateDom(300);
        break;

      case "TADO_DATA":
        this.rooms    = payload;
        this.authInfo = null;
        this.error    = null;
        this.loaded   = true;
        this.updateDom(400);
        break;

      case "TADO_ERROR":
        this.error = payload;
        this.updateDom(400);
        break;
    }
  },

  // ── DOM generation ───────────────────────────────────────────────────────

  getDom() {
    const wrapper = document.createElement("div");
    wrapper.className = "tado-overview";

    // ── Auth required (device code flow) ──────────────────────────────────
    if (this.authInfo) {
      wrapper.appendChild(this.buildAuthScreen(this.authInfo));
      return wrapper;
    }

    // ── Loading ───────────────────────────────────────────────────────────
    if (!this.loaded && !this.error) {
      wrapper.innerHTML =
        `<div class="tado-status-msg tado-loading">
           <span class="tado-spinner"></span>
           Verbinde mit Tado …
         </div>`;
      return wrapper;
    }

    // ── Error ─────────────────────────────────────────────────────────────
    if (this.error) {
      wrapper.innerHTML =
        `<div class="tado-status-msg tado-error">
           <span class="tado-icon">⚠</span> ${this.error}
         </div>`;
      return wrapper;
    }

    // ── No rooms ──────────────────────────────────────────────────────────
    if (!this.rooms.length) {
      wrapper.innerHTML =
        `<div class="tado-status-msg">Keine Räume gefunden.</div>`;
      return wrapper;
    }

    // ── Tile grid ─────────────────────────────────────────────────────────
    const grid = document.createElement("div");
    grid.className = "tado-grid";
    this.rooms.forEach(room => grid.appendChild(this.createTile(room)));
    wrapper.appendChild(grid);
    return wrapper;
  },

  // ── Auth screen ──────────────────────────────────────────────────────────

  buildAuthScreen(info) {
    const screen = document.createElement("div");
    screen.className = "tado-auth-screen";

    screen.innerHTML = `
      <div class="tado-auth-title">
        <span class="tado-auth-icon">🔑</span>
        Tado Anmeldung erforderlich
      </div>
      <div class="tado-auth-body">
        <p class="tado-auth-hint">
          Öffne die folgende Adresse auf deinem Smartphone oder Computer
          und melde dich mit deinem Tado-Konto an:
        </p>
        <div class="tado-auth-url">${info.verificationUri}</div>
        <p class="tado-auth-hint">Oder gib diesen Code manuell ein:</p>
        <div class="tado-auth-code">${info.userCode}</div>
        <p class="tado-auth-hint tado-auth-wait">
          <span class="tado-spinner"></span>
          Warte auf Bestätigung …
        </p>
      </div>`;

    return screen;
  },

  // ── Room tile ────────────────────────────────────────────────────────────

  createTile(room) {
    const tile = document.createElement("div");
    tile.className = `tado-tile ${this.tempClass(room.temperature)}`;

    // Room name
    const name = document.createElement("div");
    name.className   = "tado-room-name";
    name.textContent = room.name;
    tile.appendChild(name);

    // Temperature
    const tempWrapper = document.createElement("div");
    tempWrapper.className = "tado-temp-wrapper";

    const tempEl = document.createElement("div");
    tempEl.className = "tado-temperature";

    if (room.temperature != null) {
      const value    = this.config.units === "imperial"
        ? this.celsiusToFahrenheit(room.temperature)
        : room.temperature;
      const unitLbl  = this.config.units === "imperial" ? "°F" : "°C";
      tempEl.innerHTML =
        `${value.toFixed(1)}<span class="tado-unit">${unitLbl}</span>`;
    } else {
      tempEl.innerHTML = `<span class="tado-no-data">—</span>`;
    }
    tempWrapper.appendChild(tempEl);
    tile.appendChild(tempWrapper);

    // Bottom: humidity + badges
    const bottom = document.createElement("div");
    bottom.className = "tado-bottom";

    if (this.config.showHumidity && room.humidity != null) {
      const hum = document.createElement("span");
      hum.className = "tado-humidity";
      hum.innerHTML =
        `<svg class="tado-svg-icon" viewBox="0 0 24 24">
           <path d="M12 2C6 10 4 14 4 16a8 8 0 0 0 16 0c0-2-2-6-8-14z"/>
         </svg>${Math.round(room.humidity)}<span class="tado-pct">%</span>`;
      bottom.appendChild(hum);
    }

    if (this.config.showHeatingPower && room.heatingPower > 0) {
      const heat = document.createElement("span");
      heat.className = "tado-badge tado-badge-heat";
      heat.innerHTML =
        `<svg class="tado-svg-icon" viewBox="0 0 24 24">
           <path d="M13.5 0.67s.74 2.65.74 4.8c0 2.06-1.35 3.73-3.41
                    3.73-2.07 0-3.63-1.67-3.63-3.73l.03-.36C5.21 7.51
                    4 10.62 4 14c0 4.42 3.58 8 8 8s8-3.58 8-8C20 8.61
                    17.41 3.8 13.5 0.67z"/>
         </svg>${Math.round(room.heatingPower)}%`;
      bottom.appendChild(heat);
    }

    if (this.config.showManualOverlay && room.overlayType === "MANUAL") {
      const manual = document.createElement("span");
      manual.className   = "tado-badge tado-badge-manual";
      manual.textContent = "Manuell";
      bottom.appendChild(manual);
    }

    if (this.config.showTadoMode && room.tadoMode) {
      const mode = document.createElement("span");
      mode.className =
        `tado-badge ${room.tadoMode === "HOME" ? "tado-badge-home" : "tado-badge-away"}`;
      mode.textContent = room.tadoMode === "HOME" ? "Zuhause" : "Abwesend";
      bottom.appendChild(mode);
    }

    tile.appendChild(bottom);
    return tile;
  },

  // ── Helpers ──────────────────────────────────────────────────────────────

  tempClass(temp) {
    if (temp == null)                    return "tado-temp-unknown";
    if (temp < this.config.tempCold)     return "tado-temp-cold";
    if (temp < this.config.tempNormal)   return "tado-temp-cool";
    if (temp < this.config.tempHot)      return "tado-temp-warm";
    return "tado-temp-hot";
  },

  celsiusToFahrenheit(c) {
    return c * 9 / 5 + 32;
  }
});
