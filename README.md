# MMM-TadoOverview

> A [MagicMirror²](https://magicmirror.builders/) module that displays your Tado smart home room temperatures and humidity as colour-coded tiles – inspired by the Tado app.

![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)
![MagicMirror²](https://img.shields.io/badge/MagicMirror²-compatible-brightgreen)
![No dependencies](https://img.shields.io/badge/dependencies-none-success)

---

## Preview

Each room is shown as a tile whose background colour changes based on temperature:

| Colour | Temperature |
|--------|-------------|
| 🔵 Blue | Cold – below `tempCold` (default 18 °C) |
| 🟢 Teal | Cool / normal – below `tempNormal` (default 22 °C) |
| 🟠 Orange | Warm – below `tempHot` (default 25 °C) |
| 🔴 Red | Hot – at or above `tempHot` |

Every tile shows:
- **Room name**
- **Temperature** (large, prominent)
- **Humidity** (with drop icon)
- Optional badges: active heating power · manual override · home / away status

---

## Installation

```bash
cd ~/MagicMirror/modules
git clone https://github.com/thelegendarymarc/mmm-tadooverview MMM-TadoOverview
```

No extra npm packages required – the module uses only built-in Node.js modules.

---

## Authentication

This module uses the **OAuth2 Device Code Grant Flow** (RFC 8628) – the method
[officially required by Tado since 21 March 2025](https://support.tado.com/en/articles/8565472-how-do-i-authenticate-to-access-the-rest-api).

### How it works

```
First start
───────────
  1. Module requests a device code from Tado
  2. Mirror shows a short code (e.g. ABCD-1234) and a URL
  3. Open the URL on any device → log in with your Tado account → confirm
  4. Module detects the approval automatically and starts showing your rooms

Subsequent starts
─────────────────
  The refresh token is saved to .tado-tokens.json inside the module folder.
  No further action required – the module authenticates silently.
```

> **Refresh token rotation:** Tado rotates refresh tokens on every use.
> The module always saves the newest token automatically.
> Tokens expire after 30 days of inactivity; in that case the mirror will
> simply show the pairing screen again.

### Security note

`.tado-tokens.json` is saved with permissions `600` (owner read/write only)
and is excluded from git via `.gitignore`.  
Your Tado credentials are never stored anywhere.

---

## Configuration

Add the following block to your `config/config.js`:

```javascript
{
  module: "MMM-TadoOverview",
  position: "top_right",       // any valid MagicMirror position
  header: "Room Climate",      // optional heading
  config: {

    // ── Optional: update interval (milliseconds) ──────────────────────────
    updateInterval: 30 * 60 * 1000,  // default: every 30 minutes (API rate limit)

    // ── Optional: temperature thresholds (°C) ─────────────────────────────
    tempCold:   18,   // below this → blue tile
    tempNormal: 22,   // below this → teal tile
    tempHot:    25,   // below this → orange tile, above → red tile

    // ── Optional: display toggles ─────────────────────────────────────────
    showHumidity: true,    // show humidity reading
    units:        "metric" // "metric" = °C | "imperial" = °F
  }
}
```

---

## Configuration Reference

| Option | Type | Default | Description |
|---|---|---|---|
| `updateInterval` | Number | `1800000` | Refresh interval in ms – default 30 min due to Tado API rate limit |
| `tempCold` | Number | `18` | Upper bound for "cold" colour (°C) |
| `tempNormal` | Number | `22` | Upper bound for "normal" colour (°C) |
| `tempHot` | Number | `25` | Upper bound for "warm" colour, above = "hot" (°C) |
| `showHumidity` | Boolean | `true` | Display humidity below temperature |
| `units` | String | `"metric"` | Temperature unit: `"metric"` (°C) or `"imperial"` (°F) |

---

## How It Works

### Authentication flow (Device Code Grant)

```
node_helper.js
  │
  ├─ POST login.tado.com/oauth2/device_authorize
  │       → device_code, user_code, verification_uri
  │
  ├─ Mirror shows user_code + URL
  │
  ├─ Poll login.tado.com/oauth2/token (every ~5 s)
  │   ├─ 400 authorization_pending → keep polling
  │   └─ 200 access_token          → save refresh_token to disk
  │
  └─ On next start / token expiry:
       POST login.tado.com/oauth2/token (grant_type=refresh_token)
           → new access_token + new refresh_token (rotation)
```

### Data flow

```
node_helper.js
  │
  ├─ GET  my.tado.com/api/v2/me                     → home ID
  ├─ GET  …/homes/{homeId}/zones                    → room list
  └─ GET  …/homes/{homeId}/zones/{id}/state (×N)   → temp · humidity · heating
        │
        └─ sendSocketNotification("TADO_DATA") → MMM-TadoOverview.js → DOM
```

### File structure

```
MMM-TadoOverview/
├── MMM-TadoOverview.js    Main module – DOM rendering, tile colours, auth screen
├── node_helper.js          Node.js helper – OAuth2 device code flow, token refresh, API calls
├── MMM-TadoOverview.css   Tile styles – gradients, grid, badges, auth screen, spinner
├── package.json            Module metadata (no external dependencies)
├── README.md               This file
└── .tado-tokens.json       Auto-created on first auth – contains only the refresh token
```

---

## Troubleshooting

| Symptom | Solution |
|---|---|
| Auth screen keeps appearing | Token file may be corrupted – delete `.tado-tokens.json` and re-authenticate |
| Auth screen appeared but never went away | The device code expires after ~5 min; restart MagicMirror to get a new one |
| Tile shows `—` for temperature | The zone has no indoor sensor (e.g. extension kit only) |
| Unexpected rooms are shown | Check the MagicMirror log – all rooms returned by the API are listed there |
| Module stops updating after ~30 days | Refresh token expired – auth screen will appear automatically for re-login |

---

## License

[MIT](LICENSE) – free to use, modify and distribute.
