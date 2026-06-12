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
  photoId?: string;
  [k: string]: any;
};
const BASE = process.env.ROOWUS_BASE || 'https://randoplane-jetphotos-api.kingforpa.workers.dev';
const DEFAULT_PHOTOS = Number(process.env.JP_PHOTOS || 5);
const CONCURRENCY = Number(process.env.JP_CONCURRENCY || 6);
const CACHE_TTL_SECONDS = Number(process.env.ROOWUS_CACHE_TTL || 3600);
const CACHE_DIR = process.env.ROOWUS_CACHE_DIR || path.resolve(process.cwd(), '.roowus_cache');
const POSTED_HISTORY = path.join(CACHE_DIR, 'posted_photos.json');
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
function shuffle<T>(arr: T[]) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
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
  const img = get(p.imageUrl ?? p.image ?? p.fullUrl ?? (p.urls && p.urls.full));
  const thumb = get(p.thumbnailUrl ?? p.thumb ?? (p.urls && p.urls.thumb) ?? (p.urls && p.urls.small));
  const photographer = get(p.photographer ?? p.photographerName ?? p.author);
  const aircraft = get(p.aircraftType ?? p.model ?? p.aircraft);
  const airline = get(p.airline ?? p.airlineName);
  const when = get(p.year ?? p.taken_at ?? p.photoDate ?? p.uploadedDate);
  const location = get(p.location ?? p.airport ?? p.locationName ?? p.location_full);
  const photoId = get(p.photoId ?? p.id ?? p.photo_id);
  return {
    photoId,
    Image: img,
    Thumbnail: thumb,
    Photographer: photographer,
    Link: makeAbsoluteJetphotosLink(get(linkCandidate)) || (photoId ? `https://www.jetphotos.com/photo/${photoId}` : undefined),
    Aircraft: aircraft,
    Airline: airline,
    DateTaken: when,
    Location: location,
  };
}
async function retry<T>(fn: () => Promise<T>, attempts = 3, backoffMs = 300): Promise<T> {
  let last: any;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); } catch (e) { last = e; if (i < attempts - 1) await new Promise(r => setTimeout(r, backoffMs * (i + 1))); }
  }
  throw last;
}
async function fetchPhotoDetailsById(photoId: string) {
  const urls = [
    `${BASE}/photo/${encodeURIComponent(photoId)}`,
    `${BASE}/?photoId=${encodeURIComponent(photoId)}`,
    `${BASE}/photo?id=${encodeURIComponent(photoId)}`
  ];
  for (const u of urls) {
    try {
      const j = await retry(() => fetchJson(u));
      if (j && (j.photo || j.photos || j.data)) {
        const cand = j.photo ?? (Array.isArray(j.photos) ? j.photos[0] : j.photos) ?? j.data ?? j;
        if (cand) return cand;
      }
      if (j && typeof j === 'object' && Object.keys(j).length > 0 && (j.thumbnailUrl || j.imageUrl || j.photoPageUrl)) {
        return j;
      }
    } catch {}
  }
  return null;
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
  let imgs = photosArr.slice(0, photos).map(normalizePhoto);
  if (imgs.length > 0 && imgs.every(i => !i.Image && !i.Thumbnail && (!i.Link || i.Link.includes('/photo/')))) {
    const total = Number(json.total ?? json.total_photos ?? photosArr.length) || photosArr.length;
    const maxPages = Math.max(1, Math.min(20, Math.ceil(total / Math.max(1, photos))));
    const randomPage = 1 + Math.floor(Math.random() * maxPages);
    try {
      const url2 = new URL(BASE + '/');
      url2.searchParams.set('page', String(randomPage));
      url2.searchParams.set('sort-order', '1');
      url2.searchParams.set('keywords', keyword);
      url2.searchParams.set('keywords-type', 'aircraft');
      url2.searchParams.set('keywords-contain', '3');
      const j2 = await limit(() => retry(() => fetchJson(url2.toString())));
      const arr2 = Array.isArray(j2.photos) ? j2.photos : (j2?.data ?? []);
      imgs = arr2.slice(0, photos * 2).map(normalizePhoto);
    } catch {}
  }
  imgs = shuffle(imgs);
  const needEnrich = imgs.filter(i => (!i.Image && !i.Thumbnail) && i.photoId).slice(0, photos);
  if (needEnrich.length > 0) {
    await Promise.all(needEnrich.map((entry: any) => limit(async () => {
      try {
        const det = await fetchPhotoDetailsById(String(entry.photoId));
        if (det) {
          const enriched = normalizePhoto(det);
          Object.assign(entry, enriched);
        }
      } catch {}
    })));
  }
  const result = { Reg: keyword, Images: imgs.slice(0, photos).map((x: any) => x), raw: json };
  writeCache(key, result);
  return result;
}
export function chooseUsableImage(res: { Images?: RoowusImage[] } | null) {
  if (!res || !Array.isArray(res.Images) || res.Images.length === 0) return null;
  const posted = (() => {
    try {
      if (!fs.existsSync(POSTED_HISTORY)) return new Set<string>();
      const data = JSON.parse(fs.readFileSync(POSTED_HISTORY, 'utf8') || '[]');
      return new Set<string>(Array.isArray(data) ? data.map(String) : []);
    } catch { return new Set<string>(); }
  })();
  const withAttr = res.Images.filter(i => {
    if (!i) return false;
    const hasImage = !!((i.Image && String(i.Image).trim().length > 0) || (i.Thumbnail && String(i.Thumbnail).trim().length > 0));
    const hasPhot = !!(i.Photographer && String(i.Photographer).trim().length > 0);
    const hasLink = !!(i.Link && String(i.Link).trim().length > 0);
    const notPosted = !(i.photoId && posted.has(String(i.photoId)));
    return hasImage && hasPhot && hasLink && notPosted;
  });
  if (withAttr.length > 0) return withAttr[Math.floor(Math.random() * withAttr.length)];
  const fallback = res.Images.filter(i => {
    if (!i) return false;
    const hasImage = !!((i.Image && String(i.Image).trim().length > 0) || (i.Thumbnail && String(i.Thumbnail).trim().length > 0));
    const hasLink = !!(i.Link && String(i.Link).trim().length > 0);
    const notPosted = !(i.photoId && posted.has(String(i.photoId)));
    return hasImage && hasLink && notPosted;
  });
  if (fallback.length > 0) return fallback[Math.floor(Math.random() * fallback.length)];
  const anyUnposted = res.Images.filter(i => i && !(i.photoId && posted.has(String(i.photoId))));
  if (anyUnposted.length > 0) return anyUnposted[Math.floor(Math.random() * anyUnposted.length)];
  return res.Images[Math.floor(Math.random() * res.Images.length)];
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
  return { text: captionText };
}
export function recordPostedPhoto(photoId: string) {
  try {
    ensureCacheDir();
    let arr: string[] = [];
    if (fs.existsSync(POSTED_HISTORY)) {
      try { arr = JSON.parse(fs.readFileSync(POSTED_HISTORY, 'utf8') || '[]'); } catch { arr = []; }
    }
    if (!arr.includes(String(photoId))) {
      arr.push(String(photoId));
      try { fs.writeFileSync(POSTED_HISTORY, JSON.stringify(arr.slice(-500)), 'utf8'); } catch {}
    }
  } catch {}
}
export function wasPhotoPosted(photoId: string) {
  try {
    if (!fs.existsSync(POSTED_HISTORY)) return false;
    const arr = JSON.parse(fs.readFileSync(POSTED_HISTORY, 'utf8') || '[]');
    return Array.isArray(arr) && arr.includes(String(photoId));
  } catch { return false; }
}