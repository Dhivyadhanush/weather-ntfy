import { isRainingNow, SNOW_CODES } from './weather.js';

const fmt = (value) => (value === null || value === undefined ? '?' : value);

/**
 * Evaluates every enabled rule once per check.
 * Each returned alert has a stable id used for the cooldown bookkeeping.
 */
export function evaluateAlerts(weather, config) {
  const { current, window } = weather;
  const alerts = config.alerts;
  const raining = isRainingNow(current);
  const probabilities = [window.maxProbability, raining ? 100 : 0];
  const rainChance = Math.max(...probabilities);
  const snowy = SNOW_CODES.has(current.code) || (current.snowfall ?? 0) > 0;
  const windGust = current.windGust ?? current.windSpeed ?? 0;
  const out = [];

  if (alerts.rain.enabled && rainChance >= alerts.rain.threshold) {
    const mm = window.totalPrecipitation;
    out.push({
      id: 'rain',
      emoji: '🌧️',
      tag: 'umbrella',
      priority: 4,
      title: "I guess it's raining",
      detail: `${Math.round(rainChance)}% chance in the next 3 hours${mm > 0 ? ` · about ${mm} mm` : ''}. The sky means business — grab an umbrella.`,
    });
  }

  if (alerts.snow.enabled && snowy && rainChance >= 40) {
    out.push({
      id: 'snow',
      emoji: '❄️',
      tag: 'snowflake',
      priority: 4,
      title: "it's snowing out there",
      detail: `${current.description} · ${fmt(current.temperature)}°C. Bundle up before you step outside.`,
    });
  }

  if (alerts.wind.enabled && windGust >= alerts.wind.gustKmh) {
    out.push({
      id: 'wind',
      emoji: '💨',
      tag: 'wind_face',
      priority: 3,
      title: 'hold onto your hat',
      detail: `Gusts up to ${Math.round(windGust)} km/h. Secure anything that might fly.`,
    });
  }

  const clearSkies = (current.cloudCover ?? 100) <= 20 && rainChance < 20 && !raining && !snowy;
  if (alerts.sunny.enabled && current.isDay && clearSkies) {
    out.push({
      id: 'sunny',
      emoji: '☀️',
      tag: 'sunny',
      priority: 2,
      title: 'the sun is showing off',
      detail: `${current.description} · ${fmt(current.temperature)}°C · cloud cover ${fmt(current.cloudCover)}%. Go touch some grass.`,
    });
  }

  const overcast = (current.cloudCover ?? 0) >= 75 && !raining && !snowy;
  if (alerts.cloudy.enabled && overcast) {
    out.push({
      id: 'cloudy',
      emoji: '☁️',
      tag: 'cloud',
      priority: 2,
      title: 'the sky is brooding',
      detail: `${current.description} · ${fmt(current.temperature)}°C · cloud cover ${fmt(current.cloudCover)}%. No sun, just mood.`,
    });
  }

  if (alerts.heat.enabled && (current.temperature ?? -Infinity) >= alerts.heat.tempC) {
    out.push({
      id: 'heat',
      emoji: '🥵',
      tag: 'thermometer',
      priority: 4,
      title: "it's dangerously hot",
      detail: `${fmt(current.temperature)}°C, feels like ${fmt(current.apparent)}°C. Hydrate and stay in the shade.`,
    });
  }

  if (alerts.cold.enabled && (current.temperature ?? Infinity) <= alerts.cold.tempC) {
    out.push({
      id: 'cold',
      emoji: '🥶',
      tag: 'snowflake',
      priority: 4,
      title: "it's freezing out there",
      detail: `${fmt(current.temperature)}°C, feels like ${fmt(current.apparent)}°C. Layer up.`,
    });
  }

  const minPriority = Number(config.ntfy.minPriority) || 0;
  return out
    .sort((a, b) => b.priority - a.priority)
    .map((alert) => ({ ...alert, priority: Math.max(alert.priority, minPriority) }));
}

/** Builds one combined ntfy message from every alert that is past its cooldown. */
export function buildNotification(freshAlerts, weather, config) {
  const primary = freshAlerts[0];
  const { current, window } = weather;
  const name = (config.profile?.name ?? 'there').trim() || 'there';
  const isSingle = freshAlerts.length === 1;

  const title = isSingle
    ? `${primary.emoji} Hey ${name} — ${primary.title}.`
    : `${primary.emoji} Hey ${name} — the sky has plans for you.`;

  const lines = isSingle
    ? [primary.detail]
    : freshAlerts.map((a) => `• ${a.emoji} ${a.title} — ${a.detail}`);
  lines.push('');
  lines.push(
    `Now: ${current.description}, ${fmt(current.temperature)}°C (feels ${fmt(current.apparent)}°C)`,
  );
  lines.push(
    `Wind ${fmt(current.windSpeed)} km/h · gusts ${fmt(current.windGust)} km/h · cloud ${fmt(current.cloudCover)}% · rain ${Math.round(window.maxProbability)}%`,
  );
  lines.push(`📍 ${config.location.name}`);
  lines.push(`🕒 ${String(current.time).replace('T', ' ')}`);

  const tags = [...new Set(freshAlerts.map((a) => a.tag))].slice(0, 4);

  return {
    title,
    message: lines.join('\n'),
    tags,
    priority: Math.max(...freshAlerts.map((a) => a.priority)),
    alertIds: freshAlerts.map((a) => a.id),
  };
}
