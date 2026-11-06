import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_CONFIG, normalizeConfig } from './config.js';

const MAX_LOGS = 200;

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export class Store {
  constructor(dir) {
    this.dir = dir;
    this.configPath = path.join(dir, 'config.json');
    this.statePath = path.join(dir, 'state.json');
    this.logPath = path.join(dir, 'logs.json');

    this.config = structuredClone(DEFAULT_CONFIG);
    this.state = {
      lastCheck: null,
      lastCheckTrigger: null,
      nextCheck: null,
      lastWeather: null,
      lastError: null,
      lastResult: null,
      lastSent: {},
    };
    this.logs = [];
  }

  async init() {
    await mkdir(this.dir, { recursive: true });

    const savedConfig = await readJson(this.configPath, null);
    if (savedConfig) this.config = normalizeConfig(savedConfig, DEFAULT_CONFIG);

    const savedState = await readJson(this.statePath, null);
    if (savedState && typeof savedState === 'object') {
      this.state = { ...this.state, ...savedState, lastSent: { ...(savedState.lastSent ?? {}) } };
    }

    const savedLogs = await readJson(this.logPath, []);
    if (Array.isArray(savedLogs)) this.logs = savedLogs.slice(0, MAX_LOGS);
  }

  async writeAtomic(file, data) {
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
    await rename(tmp, file);
  }

  async saveConfig() {
    await this.writeAtomic(this.configPath, this.config);
  }

  async saveState() {
    await this.writeAtomic(this.statePath, this.state);
  }

  async appendLog(entry) {
    const log = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      at: new Date().toISOString(),
      ...entry,
    };
    this.logs.unshift(log);
    if (this.logs.length > MAX_LOGS) this.logs.length = MAX_LOGS;
    await this.writeAtomic(this.logPath, this.logs);
    return log;
  }

  async clearLogs() {
    this.logs = [];
    await this.writeAtomic(this.logPath, this.logs);
  }
}
