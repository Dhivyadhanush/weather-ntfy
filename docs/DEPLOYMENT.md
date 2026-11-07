# Server deployment runbook

A step-by-step guide to hosting **Weather → ntfy** on a Linux Docker host, with a
private ntfy server, a public HTTPS dashboard, and reliable phone notifications.

Everything below uses placeholders: replace `example.com`, `admin`, paths, IPs and
tokens with your own. **Never commit the filled-in `.env` or `data/` directory.**

## Architecture

```
Open-Meteo  ←──  weather-ntfy container  ──publish──→  ntfy container  ──→  phone / web
                        │                                   │
                   data/config.json                    auth.db, cache.db,
                   (0600, holds token)                 webpush.db
                        │                                   │
                        └──── reverse proxy / tunnel ───────┘
```

The weather app only needs outbound HTTPS to Open-Meteo and network access to ntfy.

## Prerequisites

- Linux host with Docker Engine and Docker Compose v2.
- A domain (optional, but recommended) and a TLS reverse proxy or Cloudflare Tunnel.
- A location (latitude/longitude) for the weather checks.

## 1. Deploy the app

```bash
sudo mkdir -p /opt/stacks/weather-ntfy
sudo chown "$USER":"$USER" /opt/stacks/weather-ntfy
git clone https://github.com/Dhivyadhanush/weather-ntfy.git /opt/stacks/weather-ntfy
cd /opt/stacks/weather-ntfy
```

Create a data directory owned by the container user (`node`, uid 1000):

```bash
mkdir -p data
sudo chown 1000:1000 data
```

## 2. Prepare ntfy

If you already run ntfy, skip to “Create a topic user”. Otherwise add an ntfy stack:

```yaml
# /opt/stacks/ntfy/compose.yaml
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
      NTFY_UPSTREAM_BASE_URL: https://ntfy.sh
    ports:
      - "127.0.0.1:2586:80"
    volumes:
      - ./cache:/var/lib/ntfy
```

Start it and expose it at `https://ntfy.example.com` through your proxy/tunnel.

### Create a topic user

The weather app gets a **write-only** token; your phone account gets **read-only**.

```bash
cd /opt/stacks/ntfy

# Publisher user (script-friendly password)
docker compose exec -e NTFY_PASSWORD='replace-with-a-strong-password' \
  ntfy ntfy user add --role=user weatherpublisher

# Allow it to publish to the weather topic only
docker compose exec ntfy ntfy access weatherpublisher weather write-only

# Create the token and copy the output
docker compose exec ntfy ntfy token add --label weather-app weatherpublisher

# Your phone account must be able to read the topic
docker compose exec ntfy ntfy access myuser weather read-only
```

Topics are exact and case-sensitive: `weather` ≠ `Weather` ≠ `wetaher`.

### iOS instant notifications

Set `NTFY_UPSTREAM_BASE_URL=https://ntfy.sh` (already in the compose above) and
restart ntfy. The self-hosted server forwards a small poll request to ntfy.sh, which
delivers it through APNs; the phone then fetches the real message from your server.
Without this, iOS may take hours to fetch messages in the background.

### Browser push (optional)

For lock-screen notifications from the **web app**, generate VAPID keys:

```bash
docker compose exec ntfy ntfy webpush keys
```

Add the values to the ntfy environment and restart:

```dotenv
NTFY_WEB_PUSH_PUBLIC_KEY=...
NTFY_WEB_PUSH_PRIVATE_KEY=...
NTFY_WEB_PUSH_FILE=/var/lib/ntfy/webpush.db
NTFY_WEB_PUSH_EMAIL_ADDRESS=admin@example.com
```

On iOS, web push only works after **Share → Add to Home Screen**; open the installed
PWA and grant notifications.

## 3. Configure the weather app

```bash
cd /opt/stacks/weather-ntfy
cp .env.example .env
chmod 600 .env
```

Fill in:

```dotenv
NTFY_URL=http://ntfy:80
NTFY_TOPIC=weather
NTFY_TOKEN=tk_…                 # write-only token from step 2
NTFY_DRY_RUN=false
NTFY_MIN_PRIORITY=5             # 5 = urgent / lock-screen for every alert

WEATHER_NAME=Alex
WEATHER_LOCATION_NAME=London, United Kingdom
WEATHER_LAT=51.5074
WEATHER_LON=-0.1278
WEATHER_INTERVAL_MINUTES=5
WEATHER_COOLDOWN_HOURS=24
WEATHER_RAIN_THRESHOLD=80

DASHBOARD_USER=admin
DASHBOARD_PASS=replace-with-a-long-random-password

# Token for the iPhone Shortcuts location API (generate with: openssl rand -hex 24)
WEATHER_API_TOKEN=replace-with-a-long-random-token
```

Notes:

- If the app and ntfy are **not** on the same Docker network, use the public ntfy URL
  (e.g. `https://ntfy.example.com`) and make sure the container can reach it.
- These variables only seed `data/config.json` on the **first** boot. After that, use
  the dashboard (or edit `data/config.json` with the container stopped).
- The dashboard password is read from the environment on every restart, so changing
  `DASHBOARD_PASS` in `.env` works after `docker compose up -d`.

## 4. Host-specific compose override

Keep machine-specific ports/networks out of git with `compose.override.yaml`:

```yaml
# compose.override.yaml (gitignored)
services:
  weather-ntfy:
    ports: !override
      - "172.17.0.1:3102:4321"
    networks: [homenet]
networks:
  homenet:
    external: true
```

If you do not need a shared network, skip the override; the default compose file
publishes `127.0.0.1:4321`.

## 5. Build and start

```bash
docker compose up -d --build
docker compose ps
docker compose logs --tail 50
```

The container runs as the non-root `node` user, exposes `4321`, and has a healthcheck
against `/api/health`.

## 6. Verify

```bash
# Health (no auth)
curl -s http://172.17.0.1:3102/api/health

# Dashboard/API with basic auth
curl -s -u 'admin:your-dashboard-password' http://172.17.0.1:3102/api/bootstrap

# Publish a test through the app
curl -s -u 'admin:your-dashboard-password' -X POST http://172.17.0.1:3102/api/test
```

Expected: health `ok`, config shows the token as masked (`tokenSet: true`), and the
test returns an ntfy HTTP `200`. Check the `weather` topic in the ntfy app.

## 6b. Location API for iPhone Shortcuts

`WEATHER_API_TOKEN` enables a scoped endpoint that lets Shortcuts change the weather
location without exposing the dashboard password:

```bash
# simplest (no request body)
curl -s 'https://weather.example.com/api/location?query=London' \
  -H 'X-Weather-Token: <location-api-token>'

# or with a JSON body
curl -s -X POST https://weather.example.com/api/location \
  -H 'X-Weather-Token: <location-api-token>' \
  -H 'Content-Type: application/json' \
  -d '{"query":"London"}'
```

Test it before building the Shortcut. The endpoint updates the location and triggers
a check. Full copy-paste Shortcut recipes (city menu, current GPS, arrival/Wi-Fi
automations) are in **[IPHONE-SHORTCUTS.md](IPHONE-SHORTCUTS.md)**.

Because Shortcuts on cellular need a public URL, expose the dashboard at
`https://weather.example.com` via the tunnel/proxy before using the API from outside
the house. A VPN to the home network also works.

## 7. Expose the dashboard

### Reverse proxy (Caddy example)

```caddyfile
weather.example.com {
    reverse_proxy 172.17.0.1:3102
}
```

### Cloudflare Tunnel

In **Zero Trust → Networks → Tunnels → (your tunnel) → Public Hostname**, add:

- Subdomain: `weather`
- Domain: `example.com`
- Service: `HTTP` → `172.17.0.1:3102` (or `weather-ntfy:4321` on the same network)

Add a Cloudflare Access policy if the dashboard should not be open to the internet.
The app already has its own basic auth.

## 8. Set up the phone

1. Install the **ntfy** app (Android/iOS).
2. Add server `https://ntfy.example.com` and the **read-only** user/token.
3. Subscribe to topic `weather`.
4. Allow notifications and enable lock-screen/banner/sound.
5. **iOS:** notifications arrive via the `ntfy.sh` upstream; keep Focus/DND off for
   testing. **Android:** enable **Instant delivery** and disable battery optimization
   for ntfy if you need immediate pushes.
6. Keep the app **closed** when testing lock-screen delivery; iOS suppresses banners
   while the app is in the foreground.

The dashboard **Send test** button (`POST /api/test`) uses the configured priority
floor, so with `NTFY_MIN_PRIORITY=5` the test is urgent.

## 9. Operations

```bash
# Status / logs
cd /opt/stacks/weather-ntfy
docker compose ps
docker compose logs --tail 100 -f

# Update
git pull
docker compose up -d --build

# Backup (keep encrypted, off the server)
sudo tar -czf weather-ntfy-backup.tgz .env data
```

### Automatic updates

`scripts/update.sh` fetches `main`, fast-forwards the checkout, rebuilds **only** the
`weather-ntfy` compose service with `--no-deps`, waits for `/api/health`, and rolls
back to the previous commit if the build or health check fails. It pins
`COMPOSE_PROJECT_NAME` and never runs `down`, `prune` or touches other stacks.

```bash
./scripts/update.sh --check   # is origin/main newer?
./scripts/update.sh           # apply an update (no-op when current)
./scripts/update.sh --force   # rebuild/restart the current commit
```

Install the timer to check every 6 hours:

```bash
sudo install -m 644 deploy/weather-ntfy-update.service /etc/systemd/system/
sudo install -m 644 deploy/weather-ntfy-update.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now weather-ntfy-update.timer
systemctl list-timers weather-ntfy-update.timer

# Manual run / logs
sudo systemctl start weather-ntfy-update.service
journalctl -u weather-ntfy-update.service -n 100 --no-pager
```

The unit assumes the repo is at `/opt/stacks/weather-ntfy`, the service runs as
`server1`, and the app listens on `172.17.0.1:3102`. Adjust `User`, `WorkingDirectory`
and `HEALTH_URL` in the unit if your setup differs.

Auto-deploying `main` executes whatever is in the repository on your host. Only
enable it for a repo/account you trust, keep branch protection on, and never commit
secrets. A compromised GitHub account would otherwise be able to run code on the
server.

Rotate the ntfy token:

1. Create a new token for `weatherpublisher`.
2. Paste it into the dashboard’s **Access token** field and save (leave the field
   blank to keep the current token).
3. Remove the old token with `ntfy token remove weatherpublisher tk_…`.

Rotate the dashboard password by editing `DASHBOARD_PASS` in `.env`, then
`docker compose up -d`.

## 10. Security checklist

- [ ] `.env` and `data/config.json` are mode `0600`.
- [ ] `.env`, `data/`, and `compose.override.yaml` are **not** committed.
- [ ] Dashboard basic auth is enabled.
- [ ] HTTPS only (reverse proxy or tunnel).
- [ ] ntfy uses `NTFY_AUTH_DEFAULT_ACCESS=deny-all` with scoped users/tokens.
- [ ] Weather app token is write-only; phone user is read-only.
- [ ] `WEATHER_API_TOKEN` is long, random, and only used in Shortcut headers (HTTPS).
- [ ] Topic name is hard to guess (especially if anonymous read is allowed).
- [ ] Tokens/passwords are rotated if exposed in chat or logs.

## 11. Troubleshooting

| Symptom | Fix |
| --- | --- |
| Message in app, no lock-screen popup | Raise `NTFY_MIN_PRIORITY` to `5`; allow notifications; disable Focus; keep app closed. Enable web push for the browser/PWA. |
| iOS only syncs when opened | Set `NTFY_UPSTREAM_BASE_URL=https://ntfy.sh` on the ntfy server and restart it; verify outbound access to ntfy.sh. |
| No messages at all | Check topic spelling, server URL, read permission, and the app’s log status. |
| 401/403 from ntfy | Token/user lacks access; re-run `ntfy access` and check the topic. |
| Web app has no subscribe button | Sidebar → **Subscribed topics → Subscribe to topic**, or open `https://ntfy.example.com/weather`. |
| Weather checks fail | Host needs outbound HTTPS to `api.open-meteo.com`. |
| Cooldown blocks an alert | Expected: each condition has its own 24h cooldown. Use **Send test** or change `WEATHER_COOLDOWN_HOURS`. |
