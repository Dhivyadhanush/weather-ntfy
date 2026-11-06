export const DEFAULT_CONFIG = {
  location: {
    name: 'Pune, Maharashtra, India',
    latitude: 18.5204,
    longitude: 73.8567,
    timezone: 'auto',
  },
  ntfy: {
    server: 'https://ntfy.sh',
    topic: '',
    token: '',
    dryRun: true,
  },
  alerts: {
    rain: { enabled: true, threshold: 80 },
    snow: { enabled: true },
    wind: { enabled: true, gustKmh: 40 },
    sunny: { enabled: true },
    cloudy: { enabled: true },
    heat: { enabled: false, tempC: 35 },
    cold: { enabled: false, tempC: 2 },
  },
  schedule: {
    enabled: true,
    intervalMinutes: 5,
    cooldownHours: 24,
  },
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function num(value, fallback, min, max) {
  const n = typeof value === 'number' ? value : Number.parseFloat(value);
  if (!Number.isFinite(n)) return fallback;
  return clamp(n, min, max);
}

function bool(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

function str(value, fallback, maxLength = 300) {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  return trimmed.slice(0, maxLength);
}

function cleanTopic(value) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/^\/+/, '').replace(/\s+/g, '-').slice(0, 64);
}

function cleanServer(value, fallback) {
  const server = str(value, fallback, 300).replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(server)) return fallback;
  return server;
}

/**
 * Merges an untrusted config payload onto the current config, clamping every
 * numeric value and falling back to sane defaults for anything invalid.
 */
export function normalizeConfig(input, prev = DEFAULT_CONFIG) {
  const base = structuredClone(prev);
  const src = input && typeof input === 'object' ? input : {};

  if (src.location && typeof src.location === 'object') {
    const loc = src.location;
    base.location = {
      name: str(loc.name, base.location.name, 120),
      latitude: num(loc.latitude, base.location.latitude, -90, 90),
      longitude: num(loc.longitude, base.location.longitude, -180, 180),
      timezone: 'auto',
    };
  }

  if (src.ntfy && typeof src.ntfy === 'object') {
    const n = src.ntfy;
    base.ntfy = {
      server: cleanServer(n.server, base.ntfy.server),
      topic: cleanTopic(n.topic ?? base.ntfy.topic),
      token: typeof n.token === 'string' ? n.token.trim().slice(0, 500) : base.ntfy.token,
      dryRun: bool(n.dryRun, base.ntfy.dryRun),
    };
  }

  if (src.alerts && typeof src.alerts === 'object') {
    const a = src.alerts;
    if (a.rain) {
      base.alerts.rain = {
        enabled: bool(a.rain.enabled, base.alerts.rain.enabled),
        threshold: num(a.rain.threshold, base.alerts.rain.threshold, 1, 100),
      };
    }
    if (a.snow) {
      base.alerts.snow = { enabled: bool(a.snow.enabled, base.alerts.snow.enabled) };
    }
    if (a.wind) {
      base.alerts.wind = {
        enabled: bool(a.wind.enabled, base.alerts.wind.enabled),
        gustKmh: num(a.wind.gustKmh, base.alerts.wind.gustKmh, 5, 200),
      };
    }
    if (a.sunny) {
      base.alerts.sunny = { enabled: bool(a.sunny.enabled, base.alerts.sunny.enabled) };
    }
    if (a.cloudy) {
      base.alerts.cloudy = { enabled: bool(a.cloudy.enabled, base.alerts.cloudy.enabled) };
    }
    if (a.heat) {
      base.alerts.heat = {
        enabled: bool(a.heat.enabled, base.alerts.heat.enabled),
        tempC: num(a.heat.tempC, base.alerts.heat.tempC, 10, 60),
      };
    }
    if (a.cold) {
      base.alerts.cold = {
        enabled: bool(a.cold.enabled, base.alerts.cold.enabled),
        tempC: num(a.cold.tempC, base.alerts.cold.tempC, -50, 30),
      };
    }
  }

  if (src.schedule && typeof src.schedule === 'object') {
    const s = src.schedule;
    base.schedule = {
      enabled: bool(s.enabled, base.schedule.enabled),
      intervalMinutes: Math.round(num(s.intervalMinutes, base.schedule.intervalMinutes, 1, 1440)),
      cooldownHours: num(s.cooldownHours, base.schedule.cooldownHours, 1, 168),
    };
  }

  return base;
}
