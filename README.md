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

## Configuration

Add the following block to your `config/config.js`:

```javascript
{
  module: "MMM-TadoOverview",
  position: "top_right",       // any valid MagicMirror position
  header: "Room Climate",      // optional heading
  config: {

    // ── Required: Tado credentials ────────────────────────────────────────
    username: "your@email.com",
    password: "yourPassword",

    // ── Optional: room filter ─────────────────────────────────────────────
    // Leave empty to show ALL rooms, or provide specific zone IDs:
    // roomIds: [1, 5, 12]
    roomIds: [],

    // ── Optional: update interval (milliseconds) ──────────────────────────
    updateInterval: 5 * 60 * 1000,   // default: every 5 minutes

    // ── Optional: temperature thresholds (°C) ─────────────────────────────
    tempCold:   18,   // below this → blue tile
    tempNormal: 22,   // below this → teal tile
    tempHot:    25,   // below this → orange tile, above → red tile

    // ── Optional: display toggles ─────────────────────────────────────────
    showHumidity:      true,    // show humidity reading
    showHeatingPower:  true,    // show heating % badge when active
    showManualOverlay: true,    // show "Manual" badge when active
    showTadoMode:      false,   // show Home / Away badge
    units:             "metric" // "metric" = °C | "imperial" = °F
  }
}
```

### Finding your Room IDs

Start MagicMirror once with `roomIds: []` – all rooms will appear automatically.
If you only want to display specific rooms, query the Tado API after logging in:

```
https://my.tado.com/api/v2/homes/YOUR_HOME_ID/zones
```

The `id` field of each zone entry is what you put in `roomIds`.

---

## Configuration Reference

| Option | Type | Default | Description |
|---|---|---|---|
| `username` | String | `""` | Your Tado account e-mail (**required**) |
| `password` | String | `""` | Your Tado account password (**required**) |
| `roomIds` | Array | `[]` | Zone IDs to display; empty = show all rooms |
| `updateInterval` | Number | `300000` | Refresh interval in milliseconds (min. 60 000) |
| `tempCold` | Number | `18` | Upper bound for "cold" colour (°C) |
| `tempNormal` | Number | `22` | Upper bound for "normal" colour (°C) |
| `tempHot` | Number | `25` | Upper bound for "warm" colour, above = "hot" (°C) |
| `showHumidity` | Boolean | `true` | Display humidity below temperature |
| `showHeatingPower` | Boolean | `true` | Show active heating percentage |
| `showManualOverlay` | Boolean | `true` | Show badge when room is in manual mode |
| `showTadoMode` | Boolean | `false` | Show Home / Away status badge |
| `units` | String | `"metric"` | Temperature unit: `"metric"` (°C) or `"imperial"` (°F) |

---

## How It Works

### Authentication

The module authenticates against the Tado cloud using the **OAuth2 Password Grant** flow:

```
POST https://auth.tado.com/oauth/token
```

The access token is refreshed automatically before it expires – no manual renewal needed. Your credentials are stored only in your local `config.js` and are never shared with any third party.

### Data Flow

```
node_helper.js
  │
  ├─ POST auth.tado.com/oauth/token   → access token
  ├─ GET  my.tado.com/api/v2/me       → home ID
  ├─ GET  …/homes/{id}/zones          → room list
  └─ GET  …/zones/{id}/state          → temp · humidity · heating (parallel)
        │
        └─ sendSocketNotification → MMM-TadoOverview.js → DOM update
```

### File Structure

```
MMM-TadoOverview/
├── MMM-TadoOverview.js    Main module – DOM rendering, tile colours
├── node_helper.js          Node.js helper – Tado API, OAuth2 token handling
├── MMM-TadoOverview.css   Tile styles – gradients, grid, badges, spinner
├── package.json            Module metadata
└── README.md               This file
```

---

## Troubleshooting

| Symptom | Solution |
|---|---|
| "Verbinde mit Tado …" stays forever | Check that `username` and `password` are correct |
| Tile shows `—` for temperature | The zone has no indoor sensor; Tado reports no data |
| Some rooms are missing | Confirm the zone IDs in `roomIds` match the API response |
| Module stops updating | Check MagicMirror logs (`pm2 logs`); token refresh is automatic |

---

## License

[MIT](LICENSE) – free to use, modify and distribute.
