# Weather → ntfy

A tiny self-hosted weather watcher with a web dashboard. It checks the weather for
your location every few minutes and pushes a notification to [ntfy](https://ntfy.sh)
when conditions match your rules — then stays quiet about that condition for a day.

- **Rain** alert only when the chance hits a threshold you choose (default **80%**).
- **Wind**, **sunny**, **overcast/moody**, **snow**, **heat** and **cold** rules as well.
- **One combined notification** per check, even if several rules fire at once.
- **24-hour cooldown per condition** by default, so a rainy day doesn't spam you
  every 5 minutes. Change the cooldown in the UI.
- Weather from [Open-Meteo](https://open-meteo.com) — free, no API key.
- **Dry run** starts enabled, so you can watch it work without sending anything.

## Quick start

Requires Node.js 18.17+ (no npm dependencies).

```bash
cd weather-ntfy
npm start
```

Open <http://127.0.0.1:4321>.

1. Search for your location and select it.
2. Enter an ntfy **topic** (any unique name, e.g. `dhanuz-weather-7f3a`).
3. Leave **Dry run** on for a first test, press **Check now**.
4. Subscribe to the same topic in the [ntfy app](https://ntfy.sh/app) or at
   `https://ntfy.sh/<your-topic>`, then turn **Dry run** off and save.

Use your own ntfy server if you like: set **ntfy server** to e.g.
`https://ntfy.example.com` and add an access token if that server requires one.

## How it decides

Every check fetches current conditions plus the next 3 hourly steps:

| Rule | Fires when |
| --- | --- |
| 🌧️ Rain | max rain probability in the next 3h ≥ threshold (default 80%), or it is raining now |
| 💨 Wind | current gusts ≥ your limit (default 40 km/h) |
| ☀️ Sunny | daytime, cloud cover ≤ 20%, rain chance < 20% |
| ☁️ Overcast | cloud cover ≥ 75% and not raining/snowing |
| ❄️ Snow | snow code in the current conditions or snowfall > 0 |
| 🥵 Heat | temperature ≥ your limit |
| 🥶 Cold | temperature ≤ your limit |

If multiple rules fire, they are merged into one ntfy message. Each rule has its own
cooldown timestamp, so a rain alert sent at 09:00 blocks the next rain alert until
09:00 the next day, while a wind alert can still go out sooner.

Dry runs are **not** counted against the cooldown, so switching to live mode is safe.

## Notes

- The server binds to `127.0.0.1` by default. Set `HOST=0.0.0.0` if you want it on
  your LAN (the dashboard has no login, so keep it private).
- Change the port with `PORT=8080 npm start`.
- Settings and history live in `data/` (`config.json`, `state.json`, `logs.json`).
  The config file is written with mode `0600` because it may contain an ntfy token.
- Keep it running with `pm2 start server.js --name weather-ntfy`, a launchd plist,
  or any process manager. `npm run dev` uses `node --watch`.

## Docker

```bash
cp .env.example .env      # fill in topic/token/location
docker compose up -d --build
docker compose logs -f
```

The container listens on `4321` and the default compose file publishes it on
`127.0.0.1:4321`. Put it behind your own reverse proxy or tunnel if you need remote
access, and set **Dashboard auth** below — the dashboard can change settings and
send notifications.

Set `DASHBOARD_USER` and `DASHBOARD_PASS` to require HTTP basic auth on the
dashboard and API (the `/api/health` endpoint stays open for container health
checks). Leave both empty for local-only use. The ntfy token is never sent back to
the browser; leaving the token field blank keeps the saved one.

Environment variables (`NTFY_URL`, `NTFY_TOPIC`, `NTFY_TOKEN`, `NTFY_DRY_RUN`,
`WEATHER_LOCATION_NAME`, `WEATHER_LAT`, `WEATHER_LON`, `WEATHER_NAME`,
`WEATHER_INTERVAL_MINUTES`, `WEATHER_COOLDOWN_HOURS`, `WEATHER_RAIN_THRESHOLD`,
`NTFY_MIN_PRIORITY`) seed `data/config.json` on the very first boot. After that the
dashboard is the source of truth and env changes are ignored. Set `DATA_DIR` to
relocate the data folder.

A `compose.override.yaml` (gitignored) is handy for host-specific ports and networks:

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

## Tests

```bash
npm test
```

Covers the 80% rain threshold boundary, active-rain override, wind/sunny/overcast/
snow/heat/cold rules, combined notification building, and config clamping.

## API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/bootstrap` | config, current weather, monitor state, recent logs |
| `PUT /api/config` | save settings (validated + clamped) |
| `GET /api/geocode?q=pune` | location search via Open-Meteo geocoding |
| `POST /api/check` | run a check immediately |
| `POST /api/test` | send (or dry-run) a test notification |
| `DELETE /api/logs` | clear the activity log |

## Troubleshooting

- **Nothing arrives**: is Dry run on? Does the topic match? Test the topic with
  `curl -d "hello" https://ntfy.sh/your-topic`.
- **No alerts even though it's raining**: check the rule toggle, the threshold, and
  the activity log. If an alert was sent recently, it is inside its cooldown.
- **Weather check failed**: the machine needs outbound HTTPS access to
  `api.open-meteo.com`.
