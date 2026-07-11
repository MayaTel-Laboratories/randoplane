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
      console.log(`jetapi: fetching ${url} (attempt ${i + 1}/${attempts})`);
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json, text/plain, */*',
          'User-Agent': 'randoplane-jetapi-client/1.0',
        },
        signal,
      });
      clearTimeout(t);
      console.log(`jetapi: status ${res.status} ${res.statusText} for ${reg}`);
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        console.warn(`jetapi: non-ok response for ${reg}: ${res.status} ${res.statusText} - ${String(txt).slice(0,200)}`);
        lastErr = new Error(`JetAPI ${res.status} ${res.statusText}`);
        if (res.status >= 500) {
          const backoff = 300 * (i + 1);
          await new Promise((r) => setTimeout(r, backoff));
          continue;
        } else {
          return null;
        }
      }
      const text = await res.text().catch(() => '');
      const snippet = String(text).slice(0, 400);
      let json: any = null;
      try { json = text ? JSON.parse(text) : null; } catch (e) { json = text; }
      console.log(`jetapi: response snippet for ${reg}: ${snippet.replace(/\n/g, ' ')}`);
      return json;
    } catch (e) {
      clearTimeout(t);
      lastErr = e;
      console.warn(`jetapi: fetch error for ${reg}: ${(e && (e as any).message) || e}`);
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 250 * (i + 1)));
      continue;
    }
  }
  console.error(`jetapi: giving up for ${reg}. lastErr:`, lastErr && lastErr.message ? lastErr.message : lastErr);
  return null;
}