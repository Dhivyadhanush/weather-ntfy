export const DEFAULT_CONFIG = {
  location: {
    name: 'Pune, Maharashtra, India',
    latitude: 18.5204,
    longitude: 73.8567,
    timezone: 'auto',
  },
  profile: {
    name: 'there',
  },
  ntfy: {
    server: 'https://ntfy.sh',
    topic: '',
    token: '',
    dryRun: true,
    minPriority: 0,
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

  if (!base.profile) base.profile = { name: 'there' };
  if (src.profile && typeof src.profile === 'object') {
    base.profile = { name: str(src.profile.name, base.profile.name, 40) };
  }

  if (src.ntfy && typeof src.ntfy === 'object') {
    const n = src.ntfy;
    base.ntfy = {
      server: cleanServer(n.server, base.ntfy.server),
      topic: cleanTopic(n.topic ?? base.ntfy.topic),
      token: typeof n.token === 'string' ? n.token.trim().slice(0, 500) : base.ntfy.token,
      dryRun: bool(n.dryRun, base.ntfy.dryRun),
      minPriority: Math.round(num(n.minPriority, base.ntfy.minPriority, 0, 5)),
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

function envBool(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return !['0', 'false', 'no', 'off'].includes(String(value).trim().toLowerCase());
}

/** True when a Docker/CI environment supplies initial settings. */
export function hasEnvConfig(env = process.env) {
  return Boolean(
    env.NTFY_URL ||
      env.NTFY_SERVER ||
      env.NTFY_TOPIC ||
      env.NTFY_TOKEN ||
      env.WEATHER_LOCATION_NAME ||
      env.WEATHER_LAT ||
      env.WEATHER_LON,
  );
}

/**
 * Builds the initial config from environment variables. Used only on first boot,
 * before data/config.json exists; afterwards the dashboard owns the config.
 */
export function configFromEnv(env = process.env, base = DEFAULT_CONFIG) {
  const config = structuredClone(base);

  const server = env.NTFY_URL ?? env.NTFY_SERVER;
  if (server) config.ntfy.server = server;
  if (env.NTFY_TOPIC) config.ntfy.topic = env.NTFY_TOPIC;
  if (env.NTFY_TOKEN) config.ntfy.token = env.NTFY_TOKEN;
  config.ntfy.dryRun = envBool(env.NTFY_DRY_RUN, config.ntfy.dryRun);
  if (env.NTFY_MIN_PRIORITY) config.ntfy.minPriority = Number(env.NTFY_MIN_PRIORITY);

  if (env.WEATHER_LOCATION_NAME) config.location.name = env.WEATHER_LOCATION_NAME;
  if (env.WEATHER_LAT !== undefined && env.WEATHER_LAT !== '') {
    config.location.latitude = Number(env.WEATHER_LAT);
  }
  if (env.WEATHER_LON !== undefined && env.WEATHER_LON !== '') {
    config.location.longitude = Number(env.WEATHER_LON);
  }
  if (env.WEATHER_NAME) config.profile.name = env.WEATHER_NAME;

  if (env.WEATHER_INTERVAL_MINUTES) {
    config.schedule.intervalMinutes = Number(env.WEATHER_INTERVAL_MINUTES);
  }
  if (env.WEATHER_COOLDOWN_HOURS) {
    config.schedule.cooldownHours = Number(env.WEATHER_COOLDOWN_HOURS);
  }
  if (env.WEATHER_RAIN_THRESHOLD) {
    config.alerts.rain.threshold = Number(env.WEATHER_RAIN_THRESHOLD);
  }

  return normalizeConfig(config, base);
}
