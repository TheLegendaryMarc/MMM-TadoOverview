# MMM-TadoOverview

Ein [MagicMirror²](https://magicmirror.builders/) Modul, das die aktuellen Temperaturen und Luftfeuchtigkeitswerte deiner Tado-Räume als farbcodierte Kacheln anzeigt – ähnlich wie in der Tado-App.

![Kachel-Vorschau](preview.png)

## Features

- 🌡 **Temperatur & Luftfeuchtigkeit** pro Raum auf einen Blick
- 🎨 **Farb-Kacheln** die sich dynamisch anpassen:
  - 🔵 **Blau** – kalt (< 18 °C)
  - 🟢 **Grün** – kühl/normal (18–22 °C)
  - 🟠 **Orange** – warm (22–25 °C)
  - 🔴 **Rot** – heiß (≥ 25 °C)
- 🔥 Heizleistung-Anzeige pro Raum
- ✋ Anzeige bei manueller Überschreibung
- 🏠 Optionaler Heim/Abwesend-Status
- 🔄 Konfigurierbares Aktualisierungsintervall
- ✅ Automatisches Token-Refresh (kein manuelles Erneuern nötig)

---

## Installation

```bash
cd ~/MagicMirror/modules
git clone https://github.com/thelegendarymarc/mmm-tadooverview MMM-TadoOverview
```

Keine zusätzlichen npm-Pakete erforderlich – das Modul verwendet ausschließlich Node.js-Boardmittel.

---

## Konfiguration

Füge folgendes in deine `config/config.js` ein:

```javascript
{
  module: "MMM-TadoOverview",
  position: "top_right",        // beliebige MagicMirror-Position
  header: "Raumklima",          // optionale Überschrift
  config: {
    // ── Pflicht: Tado-Zugangsdaten ─────────────────────────────────────
    username: "deine@email.de",
    password: "deinPasswort",

    // ── Optional: Welche Räume anzeigen? ──────────────────────────────
    // Leer lassen → alle Räume werden angezeigt
    // Oder IDs angeben, z.B. [1, 5, 12]
    roomIds: [],

    // ── Optional: Aktualisierungsintervall (Millisekunden) ────────────
    updateInterval: 5 * 60 * 1000,   // Standard: 5 Minuten

    // ── Optional: Temperaturschwellenwerte (°C) ───────────────────────
    tempCold:   18,   // unter diesem Wert → blaue Kachel
    tempNormal: 22,   // unter diesem Wert → grüne Kachel
    tempHot:    25,   // unter diesem Wert → orange Kachel, darüber → rot

    // ── Optional: Anzeige-Optionen ────────────────────────────────────
    showHumidity:      true,   // Luftfeuchtigkeit anzeigen
    showHeatingPower:  true,   // Heizleistung (%) anzeigen wenn aktiv
    showManualOverlay: true,   // "Manuell"-Badge anzeigen
    showTadoMode:      false,  // Heim/Abwesend-Badge anzeigen
    units:             "metric"  // "metric" = °C | "imperial" = °F
  }
}
```

### Tado Room IDs herausfinden

Starte MagicMirror einmal mit `roomIds: []` – alle deine Räume werden angezeigt.  
Die IDs siehst du im Log (`pm2 logs` oder `node serveronly`):

```
[MMM-TadoOverview] Using home ID: 123456
```

Alternativ kannst du die Tado-API direkt abfragen (nach dem Login):

```
https://my.tado.com/api/v2/homes/DEINE_HOME_ID/zones
```

---

## Konfigurationsoptionen im Überblick

| Option              | Typ      | Standard         | Beschreibung                                          |
|---------------------|----------|------------------|-------------------------------------------------------|
| `username`          | String   | `""`             | Tado-Konto-E-Mail (Pflichtfeld)                       |
| `password`          | String   | `""`             | Tado-Passwort (Pflichtfeld)                           |
| `roomIds`           | Array    | `[]`             | Raum-IDs zum Filtern; leer = alle Räume               |
| `updateInterval`    | Number   | `300000` (5 min) | Aktualisierungsintervall in Millisekunden             |
| `tempCold`          | Number   | `18`             | Schwellenwert für „kalt" (°C)                        |
| `tempNormal`        | Number   | `22`             | Schwellenwert für „normal" (°C)                      |
| `tempHot`           | Number   | `25`             | Schwellenwert für „warm/heiß" (°C)                   |
| `showHumidity`      | Boolean  | `true`           | Luftfeuchtigkeit anzeigen                             |
| `showHeatingPower`  | Boolean  | `true`           | Aktive Heizleistung anzeigen                          |
| `showManualOverlay` | Boolean  | `true`           | Manuellen Modus als Badge anzeigen                    |
| `showTadoMode`      | Boolean  | `false`          | Heim/Abwesend-Status anzeigen                         |
| `units`             | String   | `"metric"`       | Temperatureinheit: `"metric"` (°C) oder `"imperial"` (°F) |

---

## Technische Details

Das Modul authentifiziert sich über den **OAuth2 Password Grant Flow** der Tado API:

```
POST https://auth.tado.com/oauth/token
```

Das Access-Token wird automatisch erneuert, bevor es abläuft. Zugangsdaten werden nur lokal auf deinem Raspberry Pi gespeichert und nie an Dritte weitergegeben.

Verwendete Tado-API-Endpunkte:
- `GET /api/v2/me` → Home-ID ermitteln
- `GET /api/v2/homes/{homeId}/zones` → Raumliste
- `GET /api/v2/homes/{homeId}/zones/{zoneId}/state` → Temperatur, Feuchtigkeit, Heizung

---

## Lizenz

MIT License – freie Verwendung, Änderung und Weitergabe.
