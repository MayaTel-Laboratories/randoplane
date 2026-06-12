import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { pipeline } from 'stream';
import { promisify } from 'util';
const pLimit = require('p-limit');

const streamPipeline = promisify(pipeline);

export type RoowusImage = {
  Image?: string;
  Thumbnail?: string;
  Photographer?: string;
  Link?: string;
  Aircraft?: string;
  Airline?: string;
  DateTaken?: string;
  Location?: string;
};

const BASE = process.env.ROOWUS_BASE || 'https://jp.rewis.workers.dev';
const DEFAULT_PHOTOS = Number(process.env.JP_PHOTOS || 5);
const CONCURRENCY = Number(process.env.JP_CONCURRENCY || 6);
const CACHE_TTL_SECONDS = Number(process.env.ROOWUS_CACHE_TTL || 3600);
const CACHE_DIR = process.env.ROOWUS_CACHE_DIR || path.resolve(process.cwd(), '.roowus_cache');

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

async function fetchJson(url: string, opts: RequestInit = {}) {
  const baseHeaders = { 'User-Agent': 'randoplane/roowus-adapter/1.0', ...(opts.headers || {}) };
  const res1 = await fetch(url, { ...opts, headers: baseHeaders });
  if (res1.ok) return res1.json();
  const text1 = await res1.text().catch(() => '');
  if (res1.status !== 403) {
    const err: any = new Error(`Roowus API: ${res1.status} ${res1.statusText}${text1 ? ` - ${text1.slice(0,200)}` : ''}`);
    err.status = res1.status;
    throw err;
  }
  try {
    const browserHeaders = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://www.jetphotos.com/',
      'Sec-Fetch-Site': 'same-site',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Dest': 'document',
      ...baseHeaders,
    };
    const res2 = await fetch(url, { ...opts, headers: browserHeaders });
    if (res2.ok) return res2.json();
    const text2 = await res2.text().catch(() => '');
    const err2: any = new Error(`Roowus API (retry): ${res2.status} ${res2.statusText}${text2 ? ` - ${text2.slice(0,200)}` : ''}`);
    err2.status = res2.status;
    throw err2;
  } catch (e) {
    const err: any = new Error(`Roowus API: initial 403, retry failed: ${e && (e as any).message ? (e as any).message : e}`);
    err.status = 403;
    throw err;
  }
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

export async function fetchForReg(reg: string, photos = DEFAULT_PHOTOS) {
  const key = `reg:${reg}:p:${photos}`;
  const fromCache = readCache(key);
  if (fromCache) return fromCache;
  const url = new URL(BASE + '/');
  url.searchParams.set('page', '1');
  url.searchParams.set('sort-order', '1');
  url.searchParams.set('keywords', reg);
  url.searchParams.set('keywords-type', 'registration');
  url.searchParams.set('keywords-contain', '0');
  const json = await limit(() => retry(() => fetchJson(url.toString())));
  const photosArr = Array.isArray(json.photos) ? json.photos : (json?.data ?? []);
  const result = { Reg: reg, Images: photosArr.slice(0, photos).map(normalizePhoto), raw: json };
  writeCache(key, result);
  return result;
}

export async function fetchForKeyword(keyword: string, photos = DEFAULT_PHOTOS) {
  const key = `kw:${keyword}:p:${photos}`;
  const fromCache = readCache(key);
  if (fromCache) return fromCache;
  const url = new URL(BASE + '/');
  url.searchParams.set('page', '1');
  url.searchParams.set('sort-order', '1');
  url.searchParams.set('keywords', keyword);
  url.searchParams.set('keywords-type', 'aircraft');
  url.searchParams.set('keywords-contain', '3');
  const json = await limit(() => retry(() => fetchJson(url.toString())));
  const photosArr = Array.isArray(json.photos) ? json.photos : (json?.data ?? []);
  const result = { Reg: keyword, Images: photosArr.slice(0, photos).map(normalizePhoto), raw: json };
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
  const photographer = (img?.Photographer || '').toString().trim();
  const when = (img?.DateTaken || '').toString().trim();
  const location = (img?.Location || '').toString().trim();
  const parts: string[] = [];
  if (aircraft) parts.push(aircraft);
  if (airline) parts.push(`operated by ${airline}`);
  if (location) parts.push(`at ${location}`);
  if (when) parts.push(`on ${when}`);
  const main = parts.join(', ');
  const photoBy = photographer ? `Photo by ${photographer} on JetPhotos.` : `Photo on JetPhotos.`;
  const link = img?.Link ? `${img.Link}` : '';
  const captionText = link ? `${main}. ${photoBy}\n${link}` : `${main}. ${photoBy}`;
  return { text: captionText };
}