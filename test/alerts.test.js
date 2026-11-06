import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNotification, evaluateAlerts } from '../src/alerts.js';
import { DEFAULT_CONFIG, configFromEnv, normalizeConfig } from '../src/config.js';

function makeConfig(overrides = {}) {
  const config = structuredClone(DEFAULT_CONFIG);
  config.alerts.sunny.enabled = false;
  config.alerts.cloudy.enabled = false;
  config.alerts.snow.enabled = false;
  config.alerts.heat.enabled = false;
  config.alerts.cold.enabled = false;
  return { ...config, ...overrides };
}

function makeWeather(
  { code = 0, precipitation = 0, temp = 24, cloud = 0, gust = 12, isDay = true, snowfall = 0 } = {},
  probabilities = [0, 0, 0],
) {
  return {
    current: {
      time: '2026-11-06T12:00',
      temperature: temp,
      apparent: temp + 1,
      humidity: 60,
      precipitation,
      rain: precipitation,
      showers: 0,
      snowfall,
      code,
      description: 'Test conditions',
      emoji: '🌤️',
      cloudCover: cloud,
      windSpeed: Math.round(gust * 0.6),
      windGust: gust,
      isDay,
    },
    window: {
      hours: probabilities.map((probability, i) => ({
        time: `2026-11-06T${String(12 + i).padStart(2, '0')}:00`,
        probability,
        precipitation: 0,
      })),
      maxProbability: Math.max(...probabilities),
      totalPrecipitation: 0,
    },
  };
}

const ids = (alerts) => alerts.map((a) => a.id);

test('rain fires at 80% but not at 79%', () => {
  const config = makeConfig();
  assert.deepEqual(ids(evaluateAlerts(makeWeather({}, [10, 79, 20]), config)), []);
  assert.deepEqual(ids(evaluateAlerts(makeWeather({}, [10, 80, 20]), config)), ['rain']);
  assert.deepEqual(ids(evaluateAlerts(makeWeather({}, [95, 40, 20]), config)), ['rain']);
});

test('rain alert respects a custom threshold', () => {
  const config = makeConfig();
  config.alerts.rain.threshold = 60;
  assert.deepEqual(ids(evaluateAlerts(makeWeather({}, [40, 59, 10]), config)), []);
  assert.deepEqual(ids(evaluateAlerts(makeWeather({}, [40, 60, 10]), config)), ['rain']);
});

test('active rain counts as 100% even when the hourly forecast is low', () => {
  const config = makeConfig();
  const weather = makeWeather({ code: 61, precipitation: 1.2 }, [5, 10, 5]);
  assert.deepEqual(ids(evaluateAlerts(weather, config)), ['rain']);
});

test('wind fires at the gust limit', () => {
  const config = makeConfig();
  assert.deepEqual(ids(evaluateAlerts(makeWeather({ gust: 39 }), config)), []);
  assert.deepEqual(ids(evaluateAlerts(makeWeather({ gust: 40 }), config)), ['wind']);
});

test('sunny needs daylight and low cloud', () => {
  const config = makeConfig();
  config.alerts.sunny.enabled = true;
  assert.deepEqual(ids(evaluateAlerts(makeWeather({ cloud: 5 }), config)), ['sunny']);
  assert.deepEqual(ids(evaluateAlerts(makeWeather({ cloud: 5, isDay: false }), config)), []);
  assert.deepEqual(ids(evaluateAlerts(makeWeather({ cloud: 40 }), config)), []);
});

test('moody/overcast fires on heavy cloud without rain', () => {
  const config = makeConfig();
  config.alerts.cloudy.enabled = true;
  assert.deepEqual(ids(evaluateAlerts(makeWeather({ cloud: 80 }), config)), ['cloudy']);

  const noRainRule = makeConfig();
  noRainRule.alerts.cloudy.enabled = true;
  noRainRule.alerts.rain.enabled = false;
  assert.deepEqual(ids(evaluateAlerts(makeWeather({ cloud: 80, code: 61, precipitation: 0.5 }), noRainRule)), []);
});

test('snow, heat and cold rules fire on their thresholds', () => {
  const config = makeConfig();
  config.alerts.snow.enabled = true;
  config.alerts.heat.enabled = true;
  config.alerts.cold.enabled = true;

  assert.deepEqual(ids(evaluateAlerts(makeWeather({ code: 73, snowfall: 1, temp: -2 }, [70, 40, 20]), config)), ['snow', 'cold']);
  assert.deepEqual(ids(evaluateAlerts(makeWeather({ temp: 35 }, [0, 0, 0]), config)), ['heat']);
  assert.deepEqual(ids(evaluateAlerts(makeWeather({ temp: 34.9 }, [0, 0, 0]), config)), []);
});

test('combined notification keeps every alert and the highest priority', () => {
  const config = makeConfig();
  const weather = makeWeather({ gust: 55 }, [85, 90, 80]);
  const alerts = evaluateAlerts(weather, config);
  const note = buildNotification(alerts, weather, config);

  assert.deepEqual(note.alertIds, ['rain', 'wind']);
  assert.equal(note.priority, 4);
  assert.match(note.title, /Hey there/);
  assert.match(note.title, /the sky has plans/);
  assert.match(note.message, /I guess it's raining/);
  assert.match(note.message, /hold onto your hat/);
  assert.match(note.message, new RegExp(config.location.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('single alert uses the configured name in a dramatic headline', () => {
  const config = makeConfig();
  config.profile.name = 'Alex';
  const weather = makeWeather({}, [90, 80, 70]);
  const alerts = evaluateAlerts(weather, config);
  const note = buildNotification(alerts, weather, config);

  assert.deepEqual(note.alertIds, ['rain']);
  assert.match(note.title, /Hey Alex/);
  assert.match(note.title, /I guess it's raining/);
  assert.match(note.message, /grab an umbrella/);
});

test('minimum priority raises every alert', () => {
  const config = makeConfig();
  config.ntfy.minPriority = 5;
  config.alerts.sunny.enabled = true;

  const weather = makeWeather({ cloud: 5 });
  const alerts = evaluateAlerts(weather, config);

  assert.deepEqual(alerts.map((a) => a.id), ['sunny']);
  assert.equal(alerts[0].priority, 5);

  const note = buildNotification(alerts, weather, config);
  assert.equal(note.priority, 5);
});

test('environment variables seed the first-run config', () => {
  const config = configFromEnv({
    NTFY_URL: 'http://ntfy:80',
    NTFY_TOPIC: 'weather',
    NTFY_TOKEN: 'tk_testvalue',
    NTFY_DRY_RUN: 'false',
    NTFY_MIN_PRIORITY: '5',
    WEATHER_LOCATION_NAME: 'Chennai, Tamil Nadu, India',
    WEATHER_LAT: '13.0878',
    WEATHER_LON: '80.2785',
    WEATHER_NAME: 'Alex',
    WEATHER_INTERVAL_MINUTES: '10',
    WEATHER_COOLDOWN_HOURS: '12',
    WEATHER_RAIN_THRESHOLD: '70',
  });

  assert.equal(config.ntfy.server, 'http://ntfy:80');
  assert.equal(config.ntfy.topic, 'weather');
  assert.equal(config.ntfy.token, 'tk_testvalue');
  assert.equal(config.ntfy.dryRun, false);
  assert.equal(config.ntfy.minPriority, 5);
  assert.equal(config.location.name, 'Chennai, Tamil Nadu, India');
  assert.equal(config.location.latitude, 13.0878);
  assert.equal(config.location.longitude, 80.2785);
  assert.equal(config.profile.name, 'Alex');
  assert.equal(config.schedule.intervalMinutes, 10);
  assert.equal(config.schedule.cooldownHours, 12);
  assert.equal(config.alerts.rain.threshold, 70);
});

test('config normalization clamps thresholds and ignores a bad server URL', () => {
  const config = normalizeConfig(
    {
      ntfy: { server: 'ftp://example.com', topic: '/my topic', dryRun: 'false' },
      alerts: { rain: { threshold: 250 }, wind: { gustKmh: -5 } },
      schedule: { intervalMinutes: 0, cooldownHours: 999 },
      location: { name: 'Test', latitude: 200, longitude: -999 },
    },
    DEFAULT_CONFIG,
  );

  assert.equal(config.ntfy.server, 'https://ntfy.sh');
  assert.equal(config.ntfy.topic, 'my-topic');
  assert.equal(config.ntfy.dryRun, false);
  assert.equal(config.alerts.rain.threshold, 100);
  assert.equal(config.alerts.wind.gustKmh, 5);
  assert.equal(config.schedule.intervalMinutes, 1);
  assert.equal(config.schedule.cooldownHours, 168);
  assert.equal(config.location.latitude, 90);
  assert.equal(config.location.longitude, -180);
});
