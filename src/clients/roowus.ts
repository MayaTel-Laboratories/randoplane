import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { pipeline } from 'stream';
import { promisify } from 'util';
const pLimit = require('p-limit');

const streamPipeline = promisify(pipeline);

export type RoowusImage = {
  photoId?: string;
  Image?: string;
  Thumbnail?: string;
  Photographer?: string;
  Link?: string;
  Aircraft?: string;
  Airline?: string;
  DateTaken?: string;
  Location?: string;
};

const BASE = ((process.env.ROOWUS_BASE || 'https://randoplane-jetphotos-api.kingforpa.workers.dev').toString().trim()).replace(/\/+$/, '');
const DEFAULT_PHOTOS = Number(process.env.JP_PHOTOS || 5);
const CONCURRENCY = Number(process.env.JP_CONCURRENCY || 6);
const CACHE_TTL_SECONDS = Number(process.env.ROOWUS_CACHE_TTL || 3600);
const CACHE_DIR = process.env.ROOWUS_CACHE_DIR || path.resolve(process.cwd(), '.roowus_cache');
const POSTED_HISTORY_FILE = path.join(CACHE_DIR, 'posted_history.json');
const POSTED_HISTORY_MAX = Number(process.env.ROOWUS_POSTED_HISTORY_MAX || 50);
const MAX_RANDOM_PAGE = Number(process.env.ROOWUS_MAX_RANDOM_PAGE || 20);

const limit = pLimit(CONCURRENCY);

function ensureCacheDir() {
  try { fs.mkdirSync(CACHE_DIR, { recursive: true }); } catch {}
}
function cacheKey(key: string) {
  return path.join(CACHE_DIR, encodeURIComponent(key) + '.json');
}
function readCache(key: string) {
  try {
    const p = cacheKey(key);
    if (!fs.existsSync(p)) return null;
    const st = fs.statSync(p);
    const age = (Date.now() - st.mtimeMs) / 1000;
    if (age > CACHE_TTL_SECONDS) {
      try { fs.unlinkSync(p); } catch {}
      return null;
    }
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}
function writeCache(key: string, obj: any) {
  try {
    ensureCacheDir();
    fs.writeFileSync(cacheKey(key), JSON.stringify(obj), 'utf8');
  } catch {}
}

function readPostedHistory(): string[] {
  try {
    ensureCacheDir();
    if (!fs.existsSync(POSTED_HISTORY_FILE)) return [];
    const raw = fs.readFileSync(POSTED_HISTORY_FILE, 'utf8');
    return JSON.parse(raw || '[]');
  } catch {
    return [];
  }
}
function writePostedHistory(list: string[]) {
  try {
    ensureCacheDir();
    fs.writeFileSync(POSTED_HISTORY_FILE, JSON.stringify(list.slice(-POSTED_HISTORY_MAX)), 'utf8');
  } catch {}
}
function addToPostedHistory(id: string) {
  if (!id) return;
  const hist = readPostedHistory();
  if (hist[hist.length - 1] === id) return;
  hist.push(id);
  writePostedHistory(hist);
}

async function fetchJson(url: string, opts: RequestInit = {}) {
  const apiKey = process.env.ROOWUS_API_KEY;
  const baseHeaders = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://www.jetphotos.com/',
    ...(opts.headers || {}),
  };
  if (apiKey) baseHeaders['x-api-key'] = apiKey;
  const maxAttempts = Number(process.env.ROOWUS_FETCH_ATTEMPTS || 6);
  const baseDelayMs = Number(process.env.ROOWUS_FETCH_BACKOFF_MS || 1000);
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let res: Response | null = null;
    try {
      res = await fetch(url, { ...opts, headers: baseHeaders });
    } catch (err) {
      if (attempt === maxAttempts) throw new Error(`Roowus fetch failed: ${err && (err as any).message ? (err as any).message : err}`);
      const jitter = Math.floor(Math.random() * 300);
      await new Promise((r) => setTimeout(r, baseDelayMs * attempt + jitter));
      continue;
    }
    if (res.ok) {
      try { return await res.json(); } catch (e) { throw new Error(`Roowus JSON parse error: ${e && (e as any).message ? (e as any).message : e}`); }
    }
    const retryAfter = res.headers.get('retry-after');
    const status = res.status;
    const text = await res.text().catch(() => '');
    if ((status === 429 || status === 403) && attempt < maxAttempts) {
      let waitMs = baseDelayMs * Math.pow(2, attempt - 1);
      if (retryAfter) {
        const ra = parseInt(retryAfter, 10);
        if (!Number.isNaN(ra)) waitMs = Math.max(waitMs, ra * 1000);
      }
      const jitter = Math.floor(Math.random() * 500);
      await new Promise((r) => setTimeout(r, waitMs + jitter));
      continue;
    }
    const err: any = new Error(`Roowus API: ${status} ${res.statusText}${text ? ` - ${text.slice(0,200)}` : ''}`);
    err.status = status;
    throw err;
  }
  throw new Error('Roowus fetch: exhausted retries');
}

function makeAbsoluteJetphotosLink(link?: string) {
  if (!link) return undefined;
  const s = link.toString().trim();
  if (!s) return undefined;
  if (s.startsWith('http://') || s.startsWith('https://')) return s;
  if (s.startsWith('//')) return 'https:' + s;
  if (s.startsWith('/')) return 'https://www.jetphotos.com' + s;
  if (s.startsWith('www.')) return 'https://' + s;
  return s;
}

function normalizePhoto(p: any): RoowusImage {
  const get = (v: any) => {
    if (v === null || v === undefined) return undefined;
    try { return String(v).trim() || undefined; } catch { return undefined; }
  };
  const linkCandidate =
    p.photoPageUrl ??
    p.photoPageURL ??
    p.photo_page_url ??
    p.photoPage ??
    p.photo_page ??
    p.photoUrl ??
    p.photo_url ??
    p.pageUrl ??
    p.pageURL ??
    p.url ??
    p.link ??
    p.pageUrlFull ??
    p.photo_page_url_full;
  return {
    photoId: get(p.photoId ?? p.photo_id ?? p.id),
    Image: get(p.imageUrl ?? p.image ?? p.fullUrl ?? p.urls?.full),
    Thumbnail: get(p.thumbnailUrl ?? p.thumb ?? p.urls?.thumb ?? p.urls?.small),
    Photographer: get(p.photographer ?? p.photographerName ?? p.author),
    Link: makeAbsoluteJetphotosLink(get(linkCandidate)),
    Aircraft: get(p.aircraftType ?? p.model ?? p.aircraft),
    Airline: get(p.airline ?? p.airlineName),
    DateTaken: get(p.year ?? p.taken_at ?? p.photoDate ?? p.uploadedDate),
    Location: get(p.location ?? p.airport ?? p.locationName ?? p.location_full),
  };
}

async function retry<T>(fn: () => Promise<T>, attempts = 3, backoffMs = 300): Promise<T> {
  let last: any;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); } catch (e) { last = e; if (i < attempts - 1) await new Promise(r => setTimeout(r, backoffMs * (i + 1))); }
  }
  throw last;
}

async function fetchPageForQuery(urlBase: URL, page: number) {
  const u = new URL(urlBase.toString());
  u.searchParams.set('page', String(page));
  return await fetchJson(u.toString());
}

export async function fetchForReg(reg: string, photos = DEFAULT_PHOTOS) {
  const key = `reg:${reg}:p:${photos}`;
  const fromCache = readCache(key);
  if (fromCache) return fromCache;

  const baseUrl = new URL(BASE + '/');
  baseUrl.searchParams.set('sort-order', '1');
  baseUrl.searchParams.set('keywords', reg);
  baseUrl.searchParams.set('keywords-type', 'registration');
  baseUrl.searchParams.set('keywords-contain', '0');

  const initial = await fetchJson(baseUrl.toString());
  let pages = initial?.pages ?? initial?.totalPages ?? 1;
  if (!pages || pages < 1) pages = 1;
  const randomPage = Math.max(1, Math.min(pages, 1 + Math.floor(Math.random() * Math.min(pages, MAX_RANDOM_PAGE))));
  const json = randomPage === 1 ? initial : await fetchPageForQuery(baseUrl, randomPage);

  const photosArr = Array.isArray(json.photos) ? json.photos : (json?.data ?? []);
  const result = { Reg: reg, Images: photosArr.slice(0, photos).map(normalizePhoto), raw: json };
  writeCache(key, result);
  return result;
}

export async function fetchForKeyword(keyword: string, photos = DEFAULT_PHOTOS) {
  const key = `kw:${keyword}:p:${photos}`;
  const fromCache = readCache(key);
  if (fromCache) return fromCache;

  const baseUrl = new URL(BASE + '/');
  baseUrl.searchParams.set('sort-order', '1');
  baseUrl.searchParams.set('keywords', keyword);
  baseUrl.searchParams.set('keywords-type', 'aircraft');
  baseUrl.searchParams.set('keywords-contain', '3');

  const initial = await fetchJson(baseUrl.toString());
  let pages = initial?.pages ?? initial?.totalPages ?? 1;
  if (!pages || pages < 1) pages = 1;
  const randomPage = Math.max(1, Math.min(pages, 1 + Math.floor(Math.random() * Math.min(pages, MAX_RANDOM_PAGE))));
  const json = randomPage === 1 ? initial : await fetchPageForQuery(baseUrl, randomPage);

  const photosArr = Array.isArray(json.photos) ? json.photos : (json?.data ?? []);
  const normalized = photosArr.map(normalizePhoto);
  const posted = new Set(readPostedHistory());
  const filtered = normalized.filter(p => !(p.photoId && posted.has(p.photoId)));
  const candidatePool = filtered.length > 0 ? filtered : normalized;
  const selected: any[] = [];
  const pool = candidatePool.slice();
  while (selected.length < photos && pool.length > 0) {
    const idx = Math.floor(Math.random() * pool.length);
    selected.push(pool.splice(idx, 1)[0]);
  }

  const result = { Reg: keyword, Images: selected.map(normalizePhoto), raw: json };
  writeCache(key, result);
  return result;
}

export function chooseUsableImage(res: { Images?: RoowusImage[] } | null) {
  if (!res || !Array.isArray(res.Images) || res.Images.length === 0) return null;
  const withAttr = res.Images.filter(i => {
    if (!i) return false;
    const hasImage = !!((i.Image && String(i.Image).trim().length > 0) || (i.Thumbnail && String(i.Thumbnail).trim().length > 0));
    const hasPhot = !!(i.Photographer && String(i.Photographer).trim().length > 0);
    const hasLink = !!(i.Link && String(i.Link).trim().length > 0);
    return hasImage && hasPhot && hasLink;
  });
  if (withAttr.length === 0) return null;
  return withAttr[Math.floor(Math.random() * withAttr.length)];
}

function sanitizeFilename(s: string) {
  return s.replace(/[^a-z0-9._-]/gi, '-').replace(/-+/g, '-').slice(0, 200);
}

export async function downloadImageToTemp(url: string, hint = 'image'): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': 'randoplane-downloader/1.0' } });
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  let ext = '.jpg';
  if (contentType.includes('png')) ext = '.png';
  else if (contentType.includes('webp')) ext = '.webp';
  else if (contentType.includes('gif')) ext = '.gif';
  else if (contentType.includes('jpeg')) ext = '.jpg';
  const filename = `randoplane-${sanitizeFilename(hint)}-${Date.now()}${ext}`;
  const outPath = path.join(os.tmpdir(), filename);
  const body: any = res.body;
  if (!body) throw new Error('No response body to download');
  await streamPipeline(body, fs.createWriteStream(outPath));
  return outPath;
}

export function composeCaption(regOrKeyword: string, img: RoowusImage) {
  const aircraft = (img?.Aircraft || '').toString().trim();
  const airline = (img?.Airline || '').toString().trim();
  let location = (img?.Location || '').toString().trim();
  if (location) {
    if (location.includes(' - ')) location = location.split(' - ')[0].trim();
    location = location.replace(/\s*\(.*\)$/, '').trim();
  }
  const when = (img?.DateTaken || '').toString().trim();
  const photographer = (img?.Photographer || '').toString().trim();
  const parts: string[] = [];
  if (aircraft) parts.push(aircraft);
  if (airline) parts.push(`operated by ${airline}`);
  if (location) parts.push(`at ${location}`);
  if (when) parts.push(`on ${when}`);
  const main = parts.join(', ');
  const photoBy = photographer ? `Photo by ${photographer} on JetPhotos:` : `Photo on JetPhotos:`;
  const link = img?.Link ? String(img.Link).trim() : '';
  const captionText = link ? `${main}.\n\n${photoBy}\n${link}` : `${main}. ${photoBy}`;
  return { text: captionText, link };
}

export function recordPostedPhoto(photoId?: string) {
  if (!photoId) return;
  addToPostedHistory(photoId);
}