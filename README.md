# Weather → ntfy

A tiny self-hosted weather watcher with a web dashboard. It checks the weather for
your location every few minutes and pushes a notification to [ntfy](https://ntfy.sh)
when conditions match your rules — then stays quiet about that condition for a day.

- **Rain** alert only when the chance hits a threshold you choose (default **80%**).
- **Wind**, **sunny**, **overcast/moody**, **snow**, **heat** and **cold** rules too.
- Personal, dramatic messages: “Hey Alex — I guess it’s raining.”
- **One combined notification** per check, even if several rules fire at once.
- **24-hour cooldown per condition** by default, so a rainy day doesn’t spam you every
  5 minutes. Configurable.
- **Priority floor** for push visibility (`0` per-alert, `5` urgent for lock screens).
- Weather from [Open-Meteo](https://open-meteo.com) — free, no API key.
- **Dry run** starts enabled, so you can watch it work without sending anything.
- Optional HTTP basic auth on the dashboard, and the ntfy token is never sent back to
  the browser.

## Contents

- [How it works](#how-it-works)
- [Quick start (local)](#quick-start-local)
- [Configuration](#configuration)
- [ntfy setup](#ntfy-setup)
- [Set the location from your phone](#set-the-location-from-your-phone)
- [Docker deployment](#docker-deployment)
- [Security](#security)
- [Updating](#updating)
- [API](#api)
- [Tests](#tests)
- [Troubleshooting](#troubleshooting)
- [iPhone Shortcuts guide](docs/IPHONE-SHORTCUTS.md)
- [Server deployment runbook](docs/DEPLOYMENT.md)

## How it works

Every check fetches current conditions plus the next three hourly steps from
Open-Meteo:

| Rule | Fires when |
| --- | --- |
| 🌧️ Rain | max rain probability in the next 3h ≥ threshold (default 80%), or it is raining now |
| 💨 Wind | current gusts ≥ your limit (default 40 km/h) |
| ☀️ Sunny | daytime, cloud cover ≤ 20%, rain chance < 20% |
| ☁️ Overcast | cloud cover ≥ 75% and not raining/snowing |
| ❄️ Snow | snow code in the current conditions or snowfall > 0 |
| 🥵 Heat | temperature ≥ your limit |
| 🥶 Cold | temperature ≤ your limit |

If several rules fire, they are merged into one ntfy message. Each rule keeps its own
cooldown timestamp, so a rain alert sent at 09:00 blocks the next rain alert until
09:00 the next day, while wind can still notify sooner. Dry runs do **not** consume
the cooldown.

## Quick start (local)

Requires Node.js 18.17+ (no npm dependencies).

```bash
npm start
```

Open <http://127.0.0.1:4321> and:

1. Search for your location and select it.
2. Enter an ntfy **topic** (any unique name, e.g. `my-weather-7f3a`).
3. Leave **Dry run** on and press **Check now** to preview.
4. Subscribe to the same topic in the ntfy app, then turn **Dry run** off and save.

Settings and history live in `data/` (`config.json`, `state.json`, `logs.json`).
`config.json` is written with mode `0600` because it may contain an ntfy token.

## Configuration

Everything is editable in the dashboard. The same values can seed the first run via
environment variables (useful for Docker); after `data/config.json` exists, the
dashboard is the source of truth.

| Variable | Default | Purpose |
| --- | --- | --- |
| `NTFY_URL` | `https://ntfy.sh` | ntfy server base URL. Use `http://ntfy:80` on a shared Docker network. |
| `NTFY_TOPIC` | empty | Topic to publish to. |
| `NTFY_TOKEN` | empty | Access token with **write** access to the topic. |
| `NTFY_DRY_RUN` | `true` | Compose messages but do not deliver them. |
| `NTFY_MIN_PRIORITY` | `0` | Priority floor: `0` per-alert, `3` normal, `4` high, `5` urgent. |
| `WEATHER_NAME` | `there` | Name used in alert messages. |
| `WEATHER_LOCATION_NAME` | Pune | Display name of the location. |
| `WEATHER_LAT` / `WEATHER_LON` | Pune | Coordinates. |
| `WEATHER_INTERVAL_MINUTES` | `5` | How often to check. |
| `WEATHER_COOLDOWN_HOURS` | `24` | Per-condition cooldown. |
| `WEATHER_RAIN_THRESHOLD` | `80` | Rain probability threshold, 1–100. |
| `DASHBOARD_USER` / `DASHBOARD_PASS` | empty | Set both to require HTTP basic auth on the dashboard/API. |
| `WEATHER_API_TOKEN` | empty | Enables `POST /api/location` for iPhone Shortcuts/scripts. |
| `HOST` | `127.0.0.1` | Listen address. Container images set `0.0.0.0`. |
| `PORT` | `4321` | Listen port. |
| `DATA_DIR` | `./data` | Where config/state/logs are stored. |

## ntfy setup

### Option A: ntfy.sh (easiest)

1. Pick a hard-to-guess topic, e.g. `my-weather-7f3a`.
2. Set `NTFY_URL=https://ntfy.sh` and `NTFY_TOPIC=my-weather-7f3a`.
3. Subscribe in the [web app](https://ntfy.sh/app) or the mobile app.
4. Send a test from the dashboard.

### Option B: self-hosted ntfy

A minimal private ntfy server behind a TLS reverse proxy:

```yaml
services:
  ntfy:
    image: binwiederhier/ntfy:latest
    command: serve
    restart: unless-stopped
    environment:
      TZ: Asia/Kolkata
      NTFY_BASE_URL: https://ntfy.example.com
      NTFY_CACHE_FILE: /var/lib/ntfy/cache.db
      NTFY_AUTH_FILE: /var/lib/ntfy/auth.db
      NTFY_AUTH_DEFAULT_ACCESS: deny-all
      NTFY_BEHIND_PROXY: "true"
      NTFY_ENABLE_LOGIN: "true"
      # Needed for instant notifications in the iOS app:
      NTFY_UPSTREAM_BASE_URL: https://ntfy.sh
    ports:
      - "127.0.0.1:2586:80"
    volumes:
      - ./cache:/var/lib/ntfy
```

Put it behind Caddy/Nginx or Cloudflare Tunnel at `https://ntfy.example.com`.

Create a **publisher** user and token (write access only to the weather topic):

```bash
docker compose exec ntfy ntfy user add --role=user weatherpublisher
docker compose exec ntfy ntfy access weatherpublisher weather write-only
docker compose exec ntfy ntfy token add --label weather-app weatherpublisher
```

For the account you use on your phone, grant read access:

```bash
docker compose exec ntfy ntfy access myuser weather read-only
```

Then set in the weather app:

```dotenv
NTFY_URL=http://ntfy:80          # if the app is on the same Docker network
NTFY_TOPIC=weather
NTFY_TOKEN=tk_…                   # output of `ntfy token add`
```

Topics are exact and case-sensitive: `weather` is not `Weather` or `wetaher`.

### Subscribing to the topic

- **Web app:** open `https://ntfy.example.com`, sign in, open the sidebar and choose
  **Subscribed topics → Subscribe to topic**. You can also open
  `https://ntfy.example.com/weather` directly.
- **Mobile app:** add the server, add credentials (token or username/password), then
  **+ → Subscribe to topic → `weather`**.
- **iOS:** install the ntfy app and allow notifications. For a self-hosted server,
  instant delivery goes through `ntfy.sh`; keep `NTFY_UPSTREAM_BASE_URL` set.

### Optional: browser push (web app)

The web app can show notifications while open over WebSocket. For background browser
push, generate VAPID keys and add them to the ntfy server:

```bash
docker compose exec ntfy ntfy webpush keys
```

```dotenv
NTFY_WEB_PUSH_PUBLIC_KEY=...
NTFY_WEB_PUSH_PRIVATE_KEY=...
NTFY_WEB_PUSH_FILE=/var/lib/ntfy/webpush.db
NTFY_WEB_PUSH_EMAIL_ADDRESS=admin@example.com
```

Restart ntfy, reload the web app, and grant notification permission. On iOS, web
push only works from a PWA installed via **Share → Add to Home Screen**.

### Push priority

- `1` min, `2` low, `3` default, `4` high, `5` urgent.
- Set `NTFY_MIN_PRIORITY=5` (or choose **Urgent** in the dashboard) if every alert
  must pop on the lock screen.
- iOS Focus/DND can still silence notifications; allow ntfy in
  **Settings → Notifications** and disable Focus for testing.

## Set the location from your phone

Set `WEATHER_API_TOKEN` to a long random value, restart the container, and call:

**Simplest for Shortcuts (no request body):**

```http
GET https://weather.example.com/api/location?query=Coimbatore
X-Weather-Token: <location-api-token>
```

Coordinates work the same way:

```http
GET https://weather.example.com/api/location?latitude=11.0168&longitude=76.9558&name=Home
X-Weather-Token: <location-api-token>
```

**Or use a JSON body** with `POST`:

```http
POST https://weather.example.com/api/location
Content-Type: application/json
X-Weather-Token: <location-api-token>

{ "query": "Coimbatore" }
```

The endpoint validates and saves the location, then runs a weather check. The token
only grants access to location updates — it cannot read config/logs or send arbitrary
notifications. The dashboard still uses its own basic auth.

This makes iOS Shortcuts and automations possible: one-tap cities, Siri, arrival/
departure, Wi-Fi, time-of-day, CarPlay and current-GPS shortcuts. See
**[docs/IPHONE-SHORTCUTS.md](docs/IPHONE-SHORTCUTS.md)** for step-by-step recipes.

The endpoint must be reachable from the phone: expose the dashboard through your
Cloudflare Tunnel (e.g. `weather.example.com → http://172.17.0.1:3102`) or connect
the phone to a VPN.

## Docker deployment

The repo ships a `Dockerfile` and `compose.yaml` (non-root, healthcheck, data volume).

```bash
cp .env.example .env       # topic, token, location, optional dashboard auth
docker compose up -d --build
docker compose logs -f
```

The default compose file publishes the dashboard on `127.0.0.1:4321`. Put it behind
your reverse proxy or tunnel, and always set dashboard auth if it is reachable by
anyone else:

```dotenv
DASHBOARD_USER=admin
DASHBOARD_PASS=a-long-random-password
```

For host-specific ports/networks, create a gitignored `compose.override.yaml`:

```yaml
services:
  weather-ntfy:
    ports: !override
      - "172.17.0.1:3102:4321"
    networks: [homenet]
networks:
  homenet:
    external: true
```

Cloudflare Tunnel example: add a **Public Hostname** for `weather.example.com`
pointing at `http://172.17.0.1:3102` (or `http://weather-ntfy:4321` if the tunnel is
on the same Docker network). Cloudflare Access is recommended in front of it.

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for a complete server runbook.

## Security

- **Never commit `.env`, `data/`, tokens, passwords or server IPs.** They are
  gitignored; only `.env.example` is tracked.
- Keep `.env` and `data/config.json` at mode `0600`.
- The API never returns the saved ntfy token; leaving the token field blank keeps it.
- Use HTTP basic auth (`DASHBOARD_USER`/`DASHBOARD_PASS`) whenever the dashboard is
  not strictly local.
- Terminate TLS at a reverse proxy/tunnel; do not expose plain HTTP.
- Give the weather app a **write-only** ntfy token, and give your phone account
  **read-only** access.
- Rotate tokens with `ntfy token remove` / `ntfy token add` if one leaks.
- Use a hard-to-guess topic if the server allows anonymous reads.

## Updating

```bash
git pull
docker compose up -d --build
```

Data lives in the `./data` volume and survives rebuilds.

## API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | Liveness/readiness probe (never requires auth). |
| `GET /api/bootstrap` | Config (token masked), current weather, monitor state, recent logs. |
| `PUT /api/config` | Save settings (validated + clamped). |
| `GET /api/geocode?q=pune` | Location search via Open-Meteo geocoding. |
| `GET`/`POST /api/location` | Set the location from Shortcuts/scripts (requires `WEATHER_API_TOKEN`). |
| `POST /api/check` | Run a check immediately. |
| `POST /api/test` | Send (or dry-run) a test notification. |
| `DELETE /api/logs` | Clear the activity log. |

## Tests

```bash
npm test
```

Covers the 80% rain threshold boundary, active-rain override, wind/sunny/overcast/
snow/heat/cold rules, combined notifications, the priority floor, env seeding and
config clamping.

## Troubleshooting

- **Nothing arrives:** is Dry run on? Is the topic exactly `weather`? Is the server
  URL right? Does the token have **read** access for the subscribing user? Check the
  dashboard activity log for the ntfy HTTP status.
- **Message is in the app but no lock-screen popup:** raise `NTFY_MIN_PRIORITY` to
  `5`, allow notifications on the phone, disable Focus/DND, and keep the app closed
  (iOS suppresses banners while the app is open). For the web app, enable browser
  permissions/PWA install.
- **iOS only gets messages when opened:** set `NTFY_UPSTREAM_BASE_URL=https://ntfy.sh`
  on the ntfy server and restart it. Confirm the server can reach `ntfy.sh`.
- **401/403 from ntfy:** the token/user lacks access to the topic; re-check
  `ntfy access` and the topic spelling.
- **No “Subscribe to topic” in the web app:** open the sidebar and look under
  **Subscribed topics**, or navigate directly to `https://your-server/weather`.
- **WebSocket problems behind a proxy:** the ntfy WebSocket endpoint is
  `/<topic>/ws` and should upgrade with HTTP `101`.
- **Weather check failed:** the host needs outbound HTTPS to `api.open-meteo.com`
  and `api.open-meteo.com`’s geocoding endpoint.
