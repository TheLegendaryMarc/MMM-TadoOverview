/**
 * MMM-TadoOverview
 *
 * MagicMirror module that displays Tado room temperatures and humidity
 * as colour-coded tiles – similar to the Tado app.
 *
 * Colour coding (configurable thresholds):
 *   cold   < tempCold  → blue
 *   cool   < tempNormal → teal
 *   warm   < tempHot   → orange
 *   hot    >= tempHot  → red
 */

Module.register("MMM-TadoOverview", {

  defaults: {
    // ── Tado credentials ──────────────────────────────────────────────────
    username: "",           // your Tado account email
    password: "",           // your Tado account password

    // ── Room filter ───────────────────────────────────────────────────────
    // Leave empty [] to display ALL rooms, or specify IDs: [1, 2, 5]
    roomIds: [],

    // ── Refresh interval ─────────────────────────────────────────────────
    updateInterval: 5 * 60 * 1000,   // 5 minutes

    // ── Temperature thresholds (°C) ───────────────────────────────────────
    tempCold:   18,
    tempNormal: 22,
    tempHot:    25,

    // ── Display options ───────────────────────────────────────────────────
    showHumidity:        true,
    showHeatingPower:    true,
    showManualOverlay:   true,
    showTadoMode:        false,  // HOME / AWAY indicator
    units:               "metric"   // "metric" = °C | "imperial" = °F
  },

  // ── Lifecycle ────────────────────────────────────────────────────────────

  start() {
    Log.info(`[MMM-TadoOverview] Starting module …`);
    this.rooms    = [];
    this.error    = null;
    this.loaded   = false;

    this.sendSocketNotification("TADO_CONFIG", {
      username:       this.config.username,
      password:       this.config.password,
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
      case "TADO_DATA":
        this.rooms  = payload;
        this.error  = null;
        this.loaded = true;
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

    // Loading state
    if (!this.loaded && !this.error) {
      wrapper.innerHTML =
        `<div class="tado-status-msg tado-loading">
           <span class="tado-spinner"></span>
           Verbinde mit Tado …
         </div>`;
      return wrapper;
    }

    // Error state
    if (this.error) {
      wrapper.innerHTML =
        `<div class="tado-status-msg tado-error">
           <span class="tado-icon">⚠</span>
           ${this.error}
         </div>`;
      return wrapper;
    }

    // No rooms
    if (!this.rooms || this.rooms.length === 0) {
      wrapper.innerHTML =
        `<div class="tado-status-msg">Keine Räume gefunden.</div>`;
      return wrapper;
    }

    // Tile grid
    const grid = document.createElement("div");
    grid.className = "tado-grid";

    this.rooms.forEach(room => grid.appendChild(this.createTile(room)));

    wrapper.appendChild(grid);
    return wrapper;
  },

  createTile(room) {
    const tile = document.createElement("div");
    tile.className = `tado-tile ${this.tempClass(room.temperature)}`;

    // Room name
    const name = document.createElement("div");
    name.className = "tado-room-name";
    name.textContent = room.name;
    tile.appendChild(name);

    // Temperature
    const tempWrapper = document.createElement("div");
    tempWrapper.className = "tado-temp-wrapper";

    const tempEl = document.createElement("div");
    tempEl.className = "tado-temperature";

    if (room.temperature != null) {
      const value = this.config.units === "imperial"
        ? this.celsiusToFahrenheit(room.temperature)
        : room.temperature;
      const unitLabel = this.config.units === "imperial" ? "°F" : "°C";

      tempEl.innerHTML =
        `${value.toFixed(1)}<span class="tado-unit">${unitLabel}</span>`;
    } else {
      tempEl.innerHTML = `<span class="tado-no-data">—</span>`;
    }
    tempWrapper.appendChild(tempEl);
    tile.appendChild(tempWrapper);

    // Bottom row: humidity + status badges
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
           <path d="M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2zm1 15H11v-6h2v6zm0-8H11V7h2v2z"/>
         </svg>${Math.round(room.heatingPower)}%`;
      bottom.appendChild(heat);
    }

    if (this.config.showManualOverlay && room.overlayType === "MANUAL") {
      const manual = document.createElement("span");
      manual.className = "tado-badge tado-badge-manual";
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
    if (temp == null)                          return "tado-temp-unknown";
    if (temp < this.config.tempCold)           return "tado-temp-cold";
    if (temp < this.config.tempNormal)         return "tado-temp-cool";
    if (temp < this.config.tempHot)            return "tado-temp-warm";
    return "tado-temp-hot";
  },

  celsiusToFahrenheit(c) {
    return c * 9 / 5 + 32;
  }
});
