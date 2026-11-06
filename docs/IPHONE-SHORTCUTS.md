# Set the weather location from an iPhone Shortcut

The app exposes a small, token-protected API so iOS Shortcuts can change the weather
location with one tap, by voice, or automatically when you arrive somewhere / join a
Wi-Fi network.

## What is possible

- **One-tap shortcut** on the Home Screen, Lock Screen widget or Action Button.
- **Siri**: “Hey Siri, set weather city.”
- **Arrive/leave automations** for home, office, a city or a favourite place.
- **Wi-Fi automations**: set Home when you join home Wi-Fi, Office when you join work.
- **Time-of-day automation**: every morning, use the phone’s current location.
- **CarPlay / Bluetooth / NFC tag** automations.
- A **menu of cities** (Home / Work / Travel) or free-text input.
- **Current GPS location** with latitude/longitude.

## Prerequisites

1. The app must be reachable from the iPhone over HTTPS. Options:
   - A Cloudflare Tunnel public hostname like `https://weather.example.com`
     (recommended), or
   - A VPN (Tailscale/WireGuard) back to the server, or
   - Home Wi-Fi only, with the app bound to the LAN.
2. `WEATHER_API_TOKEN` must be set in the app's `.env` (a long random value).
   Restart the container after adding it.
3. The API token is **not** the dashboard password and **not** the ntfy token.

## The endpoint

```http
POST https://weather.example.com/api/location
Content-Type: application/json
X-Weather-Token: <location-api-token>

{ "query": "Coimbatore" }
```

Or with explicit coordinates:

```json
{
  "name": "Home",
  "latitude": 11.0168,
  "longitude": 76.9558
}
```

`PUT` works too. The response looks like:

```json
{
  "ok": true,
  "location": { "name": "Coimbatore, Tamil Nadu, India", "latitude": 11.0168, "longitude": 76.9558, "timezone": "auto" },
  "weather": { "description": "Overcast", "temperature": 27.3, "emoji": "☁️", "rainChance": 59 },
  "message": "Location set to Coimbatore, Tamil Nadu, India."
}
```

The update saves the config and immediately runs a weather check (which may send an
alert if conditions match). A `query` uses Open-Meteo geocoding and picks the first
match; coordinates are exact and skip geocoding.

## Shortcut 1: one-tap city

1. Open **Shortcuts → +**.
2. Add **Get Contents of URL**.
3. URL: `https://weather.example.com/api/location`
4. Tap **Show More** → Method **POST**.
5. Headers:
   - `X-Weather-Token`: `<location-api-token>`
   - `Content-Type`: `application/json` (usually added automatically)
6. Request Body: **JSON**, add field `query` (Text) = `Coimbatore`.
7. Optionally add **Get Dictionary from Input** → **Get Dictionary Value** (`message`)
   → **Show Notification**.
8. Name it **Set Weather City**, then add it to the Home Screen or assign a Siri
   phrase.

## Shortcut 2: menu of cities

1. Add **Choose from Menu** with branches `Home`, `Work`, `Travel`.
2. In each branch, add **Set Variable** `City` to the corresponding city name.
3. After the menu, add **Get Contents of URL** with a JSON body:
   `query` = `City` (insert the variable).
4. Add **Show Notification** with the returned `message`.

To use exact coordinates for each place, set `Latitude`/`Longitude` variables in each
branch and use a JSON body with those fields plus a `name`.

## Shortcut 3: current GPS location

1. Add **Get Current Location**.
2. Add **Get Details of Locations** → get `Latitude` and `Longitude`.
3. Add **Get Contents of URL**:
   - Method `POST`
   - Header `X-Weather-Token`
   - JSON body fields: `name` = `Current location`, `latitude` = the variable,
     `longitude` = the variable.
4. Optional: **Get Addresses from Input** → **Get Details of Addresses** → `City`,
   and pass that as `name`.
5. Allow **Precise Location** for Shortcuts.

## Automations

In **Shortcuts → Automation → +**:

- **Arrive** at Home / Office / a city → **Run Immediately** → pick the matching
  shortcut. Use one shortcut per place, or a menu shortcut.
- **Leave** a place → set your default/home city.
- **Wi-Fi** → when connected to home/office Wi-Fi → set the matching city.
- **Time of Day** → e.g. 07:00 daily → current-location shortcut.
- **CarPlay / Bluetooth / NFC / Action Button** → trigger the shortcut.

On iOS 17+, choose **Run Immediately** so the automation does not ask for
confirmation.

## Security notes

- Put the token in the `X-Weather-Token` header, **not** in the URL.
- The token can only update the location; it cannot read the config, change ntfy
  settings, or read logs.
- The dashboard still uses its own basic-auth credentials.
- Rotate the token by changing `WEATHER_API_TOKEN` in `.env`, restarting the
  container, and updating the Shortcut.
- If Cloudflare Access protects the hostname, add its service-token headers to the
  Shortcut (`CF-Access-Client-Id`, `CF-Access-Client-Secret`).
- HTTPS only. Do not use a plain public HTTP endpoint.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `401 Authentication required` | Missing/wrong `X-Weather-Token`, or `WEATHER_API_TOKEN` is empty; restart after setting it. |
| `404 No location found` | The `query` didn't geocode; use coordinates or a simpler city name. |
| `400` | Provide either `query` or valid `latitude`/`longitude`. |
| Shortcut times out | The hostname is not reachable from the phone (tunnel/VPN), or the server is down. |
| Location changes but no alert | Alerts are rule-based and have per-condition cooldowns; use **Send test** to verify ntfy. |
