import { fetchWeather } from './weather.js';
import { buildNotification, evaluateAlerts } from './alerts.js';
import { sendNtfy } from './ntfy.js';

export class Monitor {
  constructor(store) {
    this.store = store;
    this.timer = null;
    this.busy = false;
    this.running = false;
  }

  get config() {
    return this.store.config;
  }

  get status() {
    return {
      running: this.running,
      busy: this.busy,
      nextCheck: this.store.state.nextCheck,
    };
  }

  /** Restarts the polling loop (used on boot and whenever config changes). */
  restart({ runSoon = true } = {}) {
    this.stop();
    if (!this.config.schedule.enabled) {
      this.store.state.nextCheck = null;
      return;
    }
    this.running = true;
    this.scheduleNext(runSoon ? 750 : this.intervalMs);
  }

  intervalMs() {
    return Math.max(1, this.config.schedule.intervalMinutes) * 60_000;
  }

  scheduleNext(delayMs) {
    clearTimeout(this.timer);
    const delay = Math.max(0, delayMs);
    this.store.state.nextCheck = new Date(Date.now() + delay).toISOString();
    this.timer = setTimeout(() => {
      this.tick();
    }, delay);
    this.timer.unref?.();
  }

  async tick() {
    try {
      await this.runCheck('schedule');
    } finally {
      if (this.config.schedule.enabled) {
        this.running = true;
        this.scheduleNext(this.intervalMs());
      } else {
        this.running = false;
        this.store.state.nextCheck = null;
      }
    }
  }

  stop() {
    clearTimeout(this.timer);
    this.timer = null;
    this.running = false;
    this.store.state.nextCheck = null;
  }

  isFresh(alertId, now, cooldownMs) {
    const last = this.store.state.lastSent?.[alertId];
    if (!last) return true;
    const lastMs = Date.parse(last);
    if (!Number.isFinite(lastMs)) return true;
    return now.getTime() - lastMs >= cooldownMs;
  }

  /**
   * One full cycle: fetch weather -> evaluate -> notify fresh alerts -> persist.
   * Returns a small result object that the HTTP API can hand back to the UI.
   */
  async runCheck(trigger = 'manual') {
    if (this.busy) return { ok: false, busy: true, message: 'A check is already running.' };
    this.busy = true;

    const now = new Date();
    const cooldownMs = this.config.schedule.cooldownHours * 3_600_000;

    try {
      const weather = await fetchWeather(this.config.location);
      weather.location = this.config.location.name;

      const alerts = evaluateAlerts(weather, this.config);
      const fresh = alerts.filter((a) => this.isFresh(a.id, now, cooldownMs));
      const inCooldown = alerts.filter((a) => !fresh.includes(a));

      const result = {
        ok: true,
        checkedAt: now.toISOString(),
        trigger,
        location: this.config.location.name,
        current: weather.current,
        triggered: alerts.map((a) => a.id),
        inCooldown: inCooldown.map((a) => a.id),
        sent: false,
        dryRun: this.config.ntfy.dryRun,
        delivery: null,
        message: '',
      };

      this.store.state.lastWeather = weather;
      this.store.state.lastCheck = now.toISOString();
      this.store.state.lastCheckTrigger = trigger;
      this.store.state.lastError = null;
      this.store.state.lastResult = {
        checkedAt: result.checkedAt,
        trigger,
        triggered: result.triggered,
        inCooldown: result.inCooldown,
        sent: result.sent,
        dryRun: result.dryRun,
        message: '',
      };

      if (fresh.length === 0) {
        result.message = alerts.length
          ? `Conditions matched (${alerts.map((a) => a.id).join(', ')}), but they are still inside the ${this.config.schedule.cooldownHours}h cooldown.`
          : 'No alert conditions met.';
        if (trigger === 'manual') {
          await this.store.appendLog({
            kind: 'info',
            title: 'Manual check — nothing sent',
            message: result.message,
            trigger,
          });
        }
      } else if (!this.config.ntfy.dryRun && !this.config.ntfy.topic) {
        const message = 'No ntfy topic configured. Add a topic in the settings to start receiving alerts.';
        const changed = this.store.state.lastError !== message;
        this.store.state.lastError = message;
        result.message = message;
        if (changed) {
          await this.store.appendLog({
            kind: 'error',
            title: 'Notification skipped — missing topic',
            message,
            alerts: fresh.map((a) => a.id),
            trigger,
          });
        }
      } else {
        const note = buildNotification(fresh, weather, this.config);
        const delivery = await sendNtfy(this.config.ntfy, note);
        result.delivery = delivery;
        result.sent = delivery.ok;
        result.message = delivery.dryRun
          ? 'Dry run: the notification was composed but not delivered.'
          : delivery.ok
            ? 'Notification sent to ntfy.'
            : delivery.error;

        if (delivery.ok) {
          if (!delivery.dryRun) {
            for (const alert of fresh) {
              this.store.state.lastSent[alert.id] = now.toISOString();
            }
          }
          await this.store.appendLog({
            kind: 'sent',
            title: `${delivery.dryRun ? '[Dry run] ' : ''}${note.title}`,
            message: note.message,
            alerts: note.alertIds,
            delivery,
            trigger,
          });
        } else {
          this.store.state.lastError = delivery.error ?? 'Notification failed';
          await this.store.appendLog({
            kind: 'error',
            title: 'Notification failed',
            message: this.store.state.lastError,
            alerts: note.alertIds,
            delivery,
            trigger,
          });
        }
      }

      this.store.state.lastResult = {
        ...this.store.state.lastResult,
        sent: result.sent,
        dryRun: result.dryRun,
        message: result.message,
      };

      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.store.state.lastError = message;
      this.store.state.lastCheck = now.toISOString();
      this.store.state.lastCheckTrigger = trigger;
      this.store.state.lastResult = {
        checkedAt: now.toISOString(),
        trigger,
        triggered: [],
        inCooldown: [],
        sent: false,
        error: message,
      };
      await this.store.appendLog({
        kind: 'error',
        title: 'Weather check failed',
        message,
        trigger,
      });
      return { ok: false, checkedAt: now.toISOString(), trigger, error: message };
    } finally {
      this.busy = false;
      this.store.state.nextCheck = this.config.schedule.enabled
        ? new Date(Date.now() + this.intervalMs()).toISOString()
        : null;
      await this.store.saveState().catch(() => {});
    }
  }

  async sendTest() {
    const name = (this.config.profile?.name ?? 'there').trim() || 'there';
    const payload = {
      title: `🛠️ Hey ${name} — test incoming!`,
      message: [
        'If this pops up on your lock screen, your weather alerts are alive. 🌩️',
        '',
        `Location: ${this.config.location.name}`,
        `Interval: every ${this.config.schedule.intervalMinutes} min`,
        `Cooldown: ${this.config.schedule.cooldownHours}h per condition`,
        `Time: ${new Date().toISOString()}`,
      ].join('\n'),
      tags: ['test_tube'],
      priority: 3,
    };

    const delivery = await sendNtfy(this.config.ntfy, payload);
    await this.store.appendLog({
      kind: 'test',
      title: `${delivery.dryRun ? '[Dry run] ' : ''}${payload.title}`,
      message: delivery.ok
        ? delivery.dryRun
          ? 'Test composed but not delivered (dry run is on).'
          : 'Test notification delivered.'
        : delivery.error,
      delivery,
      trigger: 'test',
    });
    return { ok: delivery.ok, dryRun: Boolean(delivery.dryRun), delivery };
  }
}
