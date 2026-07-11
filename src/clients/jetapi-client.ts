const DEFAULT_BASE = 'https://www.jetapi.dev/api';
export async function queryJetApiByRegistration(reg: string, attempts = 3, timeoutMs = 8000): Promise<any | null> {
  const base = (process.env.JETAPI_BASE || DEFAULT_BASE).replace(/\/$/, '');
  const url = `${base}?reg=${encodeURIComponent(reg)}`;
  let lastErr: any;
  for (let i = 0; i < attempts; i++) {
    const controller = new AbortController();
    const signal = controller.signal;
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json, text/plain, */*',
          'User-Agent': 'randoplane-jetapi-client/1.0',
        },
        signal,
      });
      clearTimeout(t);
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        lastErr = new Error(`JetAPI ${res.status} ${res.statusText}${txt ? ` - ${txt.slice(0,200)}` : ''}`);
        if (res.status >= 500) {
          const backoff = 300 * (i + 1);
          await new Promise((r) => setTimeout(r, backoff));
          continue;
        } else {
          return null;
        }
      }
      const json = await res.json().catch(() => null);
      return json;
    } catch (e) {
      clearTimeout(t);
      lastErr = e;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 250 * (i + 1)));
      continue;
    }
  }
  return null;
}