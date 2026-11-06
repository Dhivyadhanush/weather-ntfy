const $ = (id) => document.getElementById(id);

const ALERT_LABELS = {
  rain: '🌧️ Rain',
  wind: '💨 Wind',
  sunny: '☀️ Sunny',
  cloudy: '☁️ Overcast',
  snow: '❄️ Snow',
  heat: '🥵 Heat',
  cold: '🥶 Cold',
};

let snapshot = null;
let pendingLocation = null;
let formReady = false;
let busy = false;

/* ------------------------------------------------------------------ utils */

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function toast(message, kind = '') {
  const el = $('toast');
  el.textContent = message;
  el.className = `toast show ${kind}`.trim();
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    el.className = 'toast';
  }, 4200);
}

function relative(iso) {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return '—';
  const abs = Math.abs(ms);
  const future = ms < 0;
  const mins = Math.round(abs / 60_000);
  if (mins < 1) return future ? 'in seconds' : 'just now';
  if (mins < 60) return future ? `in ${mins}m` : `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  if (hours < 24) return future ? `in ${hours}h ${rem}m` : `${hours}h ${rem}m ago`;
  const days = Math.floor(hours / 24);
  return future ? `in ${days}d` : `${days}d ago`;
}

function clock(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function temp(value) {
  return value === null || value === undefined ? '—' : `${value}°`;
}

/* ---------------------------------------------------------------- loading */

async function load() {
  try {
    const data = await api('/api/bootstrap');
    snapshot = data;
    renderStatus();
    renderWeather();
    renderLogs();
    renderLastSent();
    if (!formReady) {
      renderForm(data.config);
      formReady = true;
    }
    updateSubscribeHint();
    $('serverClock').textContent = `checked ${clock(data.meta.serverTime)}`;
  } catch (err) {
    toast(err.message, 'bad');
    $('runState').className = 'pill pill-error';
    $('runState').textContent = 'Disconnected';
  }
}

/* ----------------------------------------------------------------- status */

function renderStatus() {
  if (!snapshot) return;
  const { state } = snapshot;
  const pill = $('runState');
  const error = state.lastError;

  if (error) {
    pill.className = 'pill pill-error';
    pill.innerHTML = '<i></i>';
    pill.append(error.length > 46 ? `${error.slice(0, 46)}…` : error);
  } else if (state.running) {
    pill.className = 'pill pill-live';
    pill.innerHTML = '<i></i>';
    pill.append('Watching the weather');
  } else {
    pill.className = 'pill pill-paused';
    pill.innerHTML = '<i></i>';
    pill.append('Monitoring paused');
  }

  updateCountdown();
}

function updateCountdown() {
  const el = $('nextCheck');
  if (!snapshot) return;
  const { state } = snapshot;
  if (!state.running) {
    el.textContent = 'no scheduled checks';
    return;
  }
  if (!state.nextCheck) {
    el.textContent = 'checking…';
    return;
  }
  const diff = new Date(state.nextCheck).getTime() - Date.now();
  if (diff <= 0) {
    el.textContent = 'checking…';
    return;
  }
  const secs = Math.ceil(diff / 1000);
  const mins = Math.floor(secs / 60);
  const rest = secs % 60;
  el.textContent = mins > 0 ? `next check in ${mins}m ${String(rest).padStart(2, '0')}s` : `next check in ${rest}s`;
}

/* ---------------------------------------------------------------- weather */

function renderWeather() {
  if (!snapshot) return;
  const weather = snapshot.state.lastWeather;
  const cfg = snapshot.config;

  if (!weather) {
    $('weatherDesc').textContent = snapshot.state.lastError ?? 'Waiting for the first check…';
    return;
  }

  const c = weather.current;
  $('weatherEmoji').textContent = c.emoji ?? '🌡️';
  $('temp').textContent = c.temperature ?? '—';
  $('weatherDesc').textContent = `${c.description}${c.isDay === false ? ' · night' : ''}`;
  $('weatherLocation').textContent = `${cfg.location.name} · ${cfg.location.latitude.toFixed(3)}, ${cfg.location.longitude.toFixed(3)}`;
  $('weatherUpdated').textContent = weather.fetchedAt ? `updated ${relative(weather.fetchedAt)}` : '—';

  $('statFeels').textContent = temp(c.apparent);
  $('statHumidity').textContent = c.humidity == null ? '—' : `${c.humidity}%`;
  $('statWind').textContent = c.windSpeed == null ? '—' : `${c.windSpeed} km/h`;
  $('statCloud').textContent = c.cloudCover == null ? '—' : `${c.cloudCover}%`;

  const peak = weather.window?.maxProbability ?? 0;
  $('rainPeak').textContent = `${Math.round(peak)}%`;
  $('rainPeak').style.color = peak >= cfg.alerts.rain.threshold ? '#f472b6' : '';

  renderRainBars(weather.window?.hours ?? [], cfg.alerts.rain.threshold);
  renderAlertSummary();
}

function renderRainBars(hours, threshold) {
  const wrap = $('rainBars');
  wrap.textContent = '';
  if (!hours.length) {
    for (let i = 0; i < 3; i += 1) {
      const ph = document.createElement('div');
      ph.className = 'rain-hour';
      ph.textContent = '—';
      wrap.append(ph);
    }
    return;
  }

  for (const hour of hours) {
    const holder = document.createElement('div');
    holder.className = 'rain-hour';

    const top = document.createElement('b');
    const label = String(hour.time).slice(11, 16);
    top.textContent = `${label} · ${Math.round(hour.probability ?? 0)}%`;

    const track = document.createElement('div');
    track.className = 'rain-track';
    const fill = document.createElement('div');
    fill.className = `rain-fill${(hour.probability ?? 0) >= threshold ? ' high' : ''}`;
    fill.style.width = `${Math.max(3, Math.min(100, hour.probability ?? 0))}%`;
    track.append(fill);

    holder.append(top, track);
    wrap.append(holder);
  }
}

function renderAlertSummary() {
  const el = $('alertSummary');
  const { state, config } = snapshot;
  const result = state.lastResult;

  if (state.lastError && !state.lastWeather) {
    el.className = 'alert-summary';
    el.textContent = `⚠️ ${state.lastError}`;
    return;
  }

  if (!result) {
    el.className = 'alert-summary';
    el.textContent = 'No check has completed yet.';
    return;
  }

  if (result.error) {
    el.className = 'alert-summary';
    el.textContent = `Last check failed: ${result.error}`;
    return;
  }

  const triggered = result.triggered ?? [];
  if (!triggered.length) {
    el.className = 'alert-summary';
    el.textContent = `All clear · checked ${relative(result.checkedAt)} · rain threshold ${config.alerts.rain.threshold}%`;
    return;
  }

  const names = triggered.map((id) => ALERT_LABELS[id]?.split(' ')[0] ?? id).join(' ');
  const cooldown = result.inCooldown?.length
    ? ` (${result.inCooldown.join(', ')} still cooling down)`
    : '';
  const sent = result.sent
    ? result.dryRun
      ? ' · dry run composed'
      : ' · sent to ntfy'
    : ' · not sent';
  el.className = 'alert-summary alerting';
  el.textContent = `${names} triggered${cooldown}${sent}`;
}

/* -------------------------------------------------------------- last sent */

function renderLastSent() {
  if (!snapshot) return;
  const wrap = $('lastSent');
  wrap.textContent = '';
  const { lastSent } = snapshot.state;
  const entries = Object.entries(lastSent ?? {});

  if (!entries.length) {
    const span = document.createElement('span');
    span.className = 'micro';
    span.textContent = 'Nothing sent yet';
    wrap.append(span);
    return;
  }

  entries
    .sort((a, b) => new Date(b[1]) - new Date(a[1]))
    .forEach(([id, at]) => {
      const chip = document.createElement('span');
      chip.className = 'chip hot';
      chip.textContent = `${ALERT_LABELS[id]?.split(' ')[0] ?? id} · ${relative(at)}`;
      chip.title = `Sent ${clock(at)}`;
      wrap.append(chip);
    });
}

/* ------------------------------------------------------------------- form */

function renderForm(cfg) {
  $('rainEnabled').checked = cfg.alerts.rain.enabled;
  $('rainThreshold').value = cfg.alerts.rain.threshold;
  $('windEnabled').checked = cfg.alerts.wind.enabled;
  $('windGust').value = cfg.alerts.wind.gustKmh;
  $('sunnyEnabled').checked = cfg.alerts.sunny.enabled;
  $('cloudyEnabled').checked = cfg.alerts.cloudy.enabled;
  $('snowEnabled').checked = cfg.alerts.snow.enabled;
  $('heatEnabled').checked = cfg.alerts.heat.enabled;
  $('heatTemp').value = cfg.alerts.heat.tempC;
  $('coldEnabled').checked = cfg.alerts.cold.enabled;
  $('coldTemp').value = cfg.alerts.cold.tempC;

  $('ntfyServer').value = cfg.ntfy.server;
  $('ntfyTopic').value = cfg.ntfy.topic;
  $('ntfyToken').value = cfg.ntfy.token;
  $('interval').value = cfg.schedule.intervalMinutes;
  $('cooldown').value = cfg.schedule.cooldownHours;
  $('monitorEnabled').checked = cfg.schedule.enabled;
  $('dryRun').checked = cfg.ntfy.dryRun;

  renderLocation();
}

function renderLocation() {
  const cfg = snapshot?.config;
  const loc = pendingLocation ?? cfg?.location;
  if (!loc) return;
  $('selectedLocationName').textContent = loc.name;
  $('selectedCoords').textContent = `${Number(loc.latitude).toFixed(3)}, ${Number(loc.longitude).toFixed(3)}`;
  if (!pendingLocation && cfg) {
    $('locationSearch').placeholder = cfg.location.name;
  }
  updateSubscribeHint();
}

function readForm() {
  const cfg = structuredClone(snapshot.config);
  if (pendingLocation) cfg.location = { ...pendingLocation, timezone: 'auto' };

  cfg.ntfy.server = $('ntfyServer').value.trim();
  cfg.ntfy.topic = $('ntfyTopic').value.trim();
  cfg.ntfy.token = $('ntfyToken').value.trim();
  cfg.ntfy.dryRun = $('dryRun').checked;

  cfg.alerts.rain.enabled = $('rainEnabled').checked;
  cfg.alerts.rain.threshold = Number($('rainThreshold').value);
  cfg.alerts.wind.enabled = $('windEnabled').checked;
  cfg.alerts.wind.gustKmh = Number($('windGust').value);
  cfg.alerts.sunny.enabled = $('sunnyEnabled').checked;
  cfg.alerts.cloudy.enabled = $('cloudyEnabled').checked;
  cfg.alerts.snow.enabled = $('snowEnabled').checked;
  cfg.alerts.heat.enabled = $('heatEnabled').checked;
  cfg.alerts.heat.tempC = Number($('heatTemp').value);
  cfg.alerts.cold.enabled = $('coldEnabled').checked;
  cfg.alerts.cold.tempC = Number($('coldTemp').value);

  cfg.schedule.enabled = $('monitorEnabled').checked;
  cfg.schedule.intervalMinutes = Number($('interval').value);
  cfg.schedule.cooldownHours = Number($('cooldown').value);

  return cfg;
}

function updateSubscribeHint() {
  const el = $('topicSubscribe');
  el.textContent = '';
  const server = $('ntfyServer').value.trim() || 'https://ntfy.sh';
  const topic = $('ntfyTopic').value.trim();
  const dryRun = $('dryRun').checked;

  if (topic) {
    el.append('Open ');
    const link = document.createElement('a');
    link.href = `${server.replace(/\/+$/, '')}/${encodeURIComponent(topic)}`;
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.textContent = `${server.replace(/^https?:\/\//, '')}/${topic}`;
    el.append(link, '.');
  } else {
    el.append('Pick any unique topic name, then subscribe to it in the app.');
  }

  if (dryRun) {
    el.append(' ');
    const warn = document.createElement('strong');
    warn.style.color = '#fbbf24';
    warn.textContent = 'Dry run is on — alerts are logged but not delivered.';
    el.append(warn);
  }
}

/* ------------------------------------------------------------------- logs */

function renderLogs() {
  if (!snapshot) return;
  const wrap = $('logList');
  wrap.textContent = '';
  const logs = snapshot.logs ?? [];
  $('logCount').textContent = `${logs.length} event${logs.length === 1 ? '' : 's'}`;

  if (!logs.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'Nothing here yet. The watcher logs sends, tests and errors.';
    wrap.append(empty);
    return;
  }

  for (const log of logs) {
    const item = document.createElement('div');
    item.className = `log-item ${log.kind ?? ''}`;

    const icon = document.createElement('div');
    icon.className = 'log-icon';
    icon.textContent =
      log.kind === 'sent'
        ? log.delivery?.dryRun
          ? '🧪'
          : '↗'
        : log.kind === 'error'
          ? '⚠'
          : log.kind === 'test'
            ? '🛠'
            : '·';

    const body = document.createElement('div');
    body.className = 'log-body';

    const title = document.createElement('div');
    title.className = 'log-title';
    title.textContent = log.title ?? 'Event';

    const text = document.createElement('div');
    text.className = 'log-text';
    text.textContent = log.message ?? '';

    const meta = document.createElement('div');
    meta.className = 'log-meta';
    const bits = [clock(log.at)];
    if (log.trigger) bits.push(log.trigger);
    if (log.delivery?.dryRun) bits.push('dry run');
    else if (log.delivery?.status) bits.push(`ntfy ${log.delivery.status}`);
    else if (log.delivery?.error) bits.push('delivery failed');
    meta.textContent = bits.join(' · ');

    body.append(title, text, meta);
    item.append(icon, body);
    wrap.append(item);
  }
}

/* --------------------------------------------------------------- actions */

async function saveSettings(event) {
  event.preventDefault();
  if (busy) return;
  busy = true;
  $('saveBtn').disabled = true;
  try {
    const data = await api('/api/config', {
      method: 'PUT',
      body: JSON.stringify(readForm()),
    });
    snapshot = data;
    pendingLocation = null;
    renderForm(data.config);
    renderStatus();
    renderWeather();
    renderLogs();
    renderLastSent();
    toast('Settings saved. Fresh check starting…', 'good');
    setTimeout(load, 2500);
  } catch (err) {
    toast(err.message, 'bad');
  } finally {
    busy = false;
    $('saveBtn').disabled = false;
  }
}

async function checkNow() {
  if (busy) return;
  busy = true;
  const btn = $('checkNow');
  btn.disabled = true;
  btn.textContent = 'Checking…';
  try {
    const result = await api('/api/check', { method: 'POST' });
    if (!result.ok) {
      toast(result.error ?? result.message ?? 'Check failed', 'bad');
    } else if (result.sent) {
      toast(result.dryRun ? 'Dry run: alert composed (not delivered).' : 'Alert sent to ntfy.', 'good');
    } else {
      toast(result.message || 'No alert sent.', '');
    }
    await load();
  } catch (err) {
    toast(err.message, 'bad');
  } finally {
    busy = false;
    btn.disabled = false;
    btn.textContent = 'Check now';
  }
}

async function sendTest() {
  if (busy) return;
  busy = true;
  const btn = $('testBtn');
  btn.disabled = true;
  try {
    const result = await api('/api/test', { method: 'POST' });
    if (result.ok) {
      toast(result.dryRun ? 'Dry run: test not delivered.' : 'Test notification delivered 🎉', 'good');
    } else {
      toast(result.delivery?.error ?? 'Test failed', 'bad');
    }
    if (result.snapshot) {
      snapshot = result.snapshot;
      renderLogs();
      renderLastSent();
      renderStatus();
    }
  } catch (err) {
    toast(err.message, 'bad');
  } finally {
    busy = false;
    btn.disabled = false;
  }
}

async function clearLogs() {
  try {
    await api('/api/logs', { method: 'DELETE' });
    await load();
    toast('Activity log cleared.');
  } catch (err) {
    toast(err.message, 'bad');
  }
}

async function searchLocation() {
  const q = $('locationSearch').value.trim();
  if (q.length < 2) {
    toast('Type at least 2 characters to search.');
    return;
  }
  const btn = $('searchBtn');
  btn.disabled = true;
  btn.textContent = '…';
  try {
    const data = await api(`/api/geocode?q=${encodeURIComponent(q)}`);
    renderSearchResults(data.results ?? []);
  } catch (err) {
    toast(err.message, 'bad');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Search';
  }
}

function renderSearchResults(results) {
  const wrap = $('searchResults');
  wrap.textContent = '';
  if (!results.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.style.padding = '12px 13px';
    empty.textContent = 'No places found. Try a different spelling.';
    wrap.append(empty);
    wrap.hidden = false;
    return;
  }

  for (const result of results) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = result.name;
    if (result.admin1 || result.country) {
      const sub = document.createElement('span');
      sub.textContent = [result.admin1, result.country].filter(Boolean).join(' · ');
      btn.append(sub);
    }
    btn.addEventListener('click', () => {
      pendingLocation = {
        name: result.name,
        latitude: result.latitude,
        longitude: result.longitude,
      };
      $('locationSearch').value = '';
      wrap.hidden = true;
      renderLocation();
      toast(`Location set to ${result.name}. Press “Save settings” to apply.`);
    });
    wrap.append(btn);
  }
  wrap.hidden = false;
}

/* ------------------------------------------------------------------- boot */

$('configForm').addEventListener('submit', saveSettings);
$('checkNow').addEventListener('click', checkNow);
$('testBtn').addEventListener('click', sendTest);
$('clearLogs').addEventListener('click', clearLogs);
$('searchBtn').addEventListener('click', searchLocation);
$('locationSearch').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    searchLocation();
  }
});
['ntfyServer', 'ntfyTopic', 'dryRun'].forEach((id) => {
  $(id).addEventListener('input', updateSubscribeHint);
  $(id).addEventListener('change', updateSubscribeHint);
});

document.addEventListener('click', (event) => {
  const results = $('searchResults');
  if (!results.hidden && !results.contains(event.target) && event.target !== $('locationSearch') && event.target !== $('searchBtn')) {
    results.hidden = true;
  }
});

setInterval(updateCountdown, 1000);
setInterval(load, 20_000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) load();
});

load();
