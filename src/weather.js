const WMO = {
  0: ['Clear sky', '☀️'],
  1: ['Mainly clear', '🌤️'],
  2: ['Partly cloudy', '⛅'],
  3: ['Overcast', '☁️'],
  45: ['Fog', '🌫️'],
  48: ['Rime fog', '🌫️'],
  51: ['Light drizzle', '🌦️'],
  53: ['Drizzle', '🌦️'],
  55: ['Dense drizzle', '🌧️'],
  56: ['Freezing drizzle', '🌧️'],
  57: ['Heavy freezing drizzle', '🌧️'],
  61: ['Light rain', '🌦️'],
  63: ['Rain', '🌧️'],
  65: ['Heavy rain', '🌧️'],
  66: ['Freezing rain', '🌨️'],
  67: ['Heavy freezing rain', '🌨️'],
  71: ['Light snow', '🌨️'],
  73: ['Snow', '❄️'],
  75: ['Heavy snow', '❄️'],
  77: ['Snow grains', '🌨️'],
  80: ['Light showers', '🌦️'],
  81: ['Showers', '🌧️'],
  82: ['Violent showers', '⛈️'],
  85: ['Snow showers', '🌨️'],
  86: ['Heavy snow showers', '❄️'],
  95: ['Thunderstorm', '⛈️'],
  96: ['Thunderstorm with hail', '⛈️'],
  99: ['Thunderstorm with heavy hail', '⛈️'],
};

export const RAIN_CODES = new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99]);
export const SNOW_CODES = new Set([66, 67, 71, 73, 75, 77, 85, 86]);

export function describeCode(code) {
  const [description, emoji] = WMO[code] ?? ['Unknown conditions', '🌡️'];
  return { description, emoji };
}

export function isRainingNow(current) {
  return RAIN_CODES.has(current.code) && (current.precipitation ?? 0) > 0;
}

const round = (value, digits = 0) => {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

/**
 * Fetches current conditions plus the next few hourly steps from Open-Meteo.
 * No API key required.
 */
export async function fetchWeather(location) {
  const params = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    current:
      'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,rain,showers,snowfall,weather_code,cloud_cover,wind_speed_10m,wind_gusts_10m',
    hourly:
      'temperature_2m,precipitation_probability,precipitation,weather_code,cloud_cover,wind_gusts_10m,is_day',
    forecast_days: '2',
    timezone: 'auto',
  });

  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, {
    signal: AbortSignal.timeout(15_000),
    headers: { 'User-Agent': 'weather-ntfy/1.0' },
  });
  if (!res.ok) {
    throw new Error(`Open-Meteo responded ${res.status} ${res.statusText}`.trim());
  }
  const data = await res.json();

  const c = data.current;
  if (!c) throw new Error('Open-Meteo returned no current conditions');

  const { description, emoji } = describeCode(c.weather_code);
  const current = {
    time: c.time,
    temperature: round(c.temperature_2m, 1),
    apparent: round(c.apparent_temperature, 1),
    humidity: round(c.relative_humidity_2m),
    precipitation: round(c.precipitation, 2),
    rain: round(c.rain, 2),
    showers: round(c.showers, 2),
    snowfall: round(c.snowfall, 2),
    code: c.weather_code,
    description,
    emoji,
    cloudCover: round(c.cloud_cover),
    windSpeed: round(c.wind_speed_10m, 1),
    windGust: round(c.wind_gusts_10m, 1),
    isDay: c.is_day === 1,
  };

  const hourly = data.hourly ?? {};
  const times = hourly.time ?? [];
  const nowKey = String(c.time).slice(0, 13);
  let start = times.findIndex((t) => String(t).slice(0, 13) === nowKey);
  if (start < 0) start = 0;

  const hours = times.slice(start, start + 3).map((time, i) => {
    const idx = start + i;
    return {
      time,
      temperature: round(hourly.temperature_2m?.[idx], 1),
      probability: round(hourly.precipitation_probability?.[idx]),
      precipitation: round(hourly.precipitation?.[idx], 2),
      code: hourly.weather_code?.[idx] ?? null,
      cloudCover: round(hourly.cloud_cover?.[idx]),
      windGust: round(hourly.wind_gusts_10m?.[idx], 1),
      isDay: hourly.is_day?.[idx] === 1,
    };
  });

  const probabilities = hours.map((h) => h.probability ?? 0);
  const window = {
    hours,
    maxProbability: probabilities.length ? Math.max(...probabilities) : 0,
    totalPrecipitation: round(hours.reduce((sum, h) => sum + (h.precipitation ?? 0), 0), 2),
  };

  return {
    fetchedAt: new Date().toISOString(),
    timezone: data.timezone ?? 'auto',
    utcOffsetSeconds: data.utc_offset_seconds ?? 0,
    current,
    window,
  };
}
