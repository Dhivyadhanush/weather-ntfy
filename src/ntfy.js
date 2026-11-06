/**
 * Publishes a notification to an ntfy server.
 * Docs: https://docs.ntfy.sh/publish/
 */
export async function sendNtfy(ntfy, payload) {
  const server = String(ntfy.server || 'https://ntfy.sh').replace(/\/+$/, '');
  const topic = String(ntfy.topic || '').trim();

  if (ntfy.dryRun) {
    return {
      ok: true,
      dryRun: true,
      status: null,
      url: topic ? `${server}/${topic}` : `${server}/<no-topic>`,
    };
  }

  if (!topic) {
    return { ok: false, error: 'No ntfy topic configured. Add one in the settings.' };
  }

  const url = `${server}/`;
  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': 'weather-ntfy/1.0',
  };
  if (ntfy.token) headers.Authorization = `Bearer ${ntfy.token}`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({
        topic,
        title: payload.title,
        message: payload.message,
        tags: payload.tags ?? [],
        priority: payload.priority ?? 3,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return {
        ok: false,
        status: res.status,
        url,
        error: `ntfy responded ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`,
      };
    }

    return { ok: true, status: res.status, url };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, url, error: `Could not reach ntfy: ${message}` };
  }
}
