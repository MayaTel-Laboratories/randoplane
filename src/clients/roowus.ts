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
  Registration?: string;
  DateTaken?: string;
  Location?: string;
  photoId?: string;
  [k: string]: any;
};

const MILITARY_KEYWORDS = [
  'air force', 'army', 'navy', 'naval', 'marine', 'marines', 'military',
  'defence', 'defense', 'luftwaffe', 'armée', 'fuerza aérea', 'aeronautica',
  'royal air', 'coast guard', 'national guard', 'air command', 'air wing',
  'usaf', 'usmc', 'raf ', 'jmsdf', 'plaaf',
];

const BASE = ((process.env.ROOWUS_BASE || 'https://randoplane-jetphotos-api.kingforpa.workers.dev').toString().trim()).replace(/\/+$/, '');
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
  const browserHeaders = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://www.jetphotos.com/',
    ...(opts.headers || {}),
  };
  let res;
  try {
    res = await fetch(url, { ...opts, headers: browserHeaders });
  } catch (e) {
    throw new Error(`Roowus fetch failed: ${e && (e as any).message ? (e as any).message : e}`);
  }
  if (res.ok) return res.json();
  const text = await res.text().catch(() => '');
  console.error('fetchJson failure', { url, status: res.status, statusText: res.statusText, bodySnippet: (text || '').slice(0, 500) });
  const err: any = new Error(`Roowus API: ${res.status} ${res.statusText}${text ? ` - ${text.slice(0, 200)}` : ''}`);
  err.status = res.status;
  throw err;
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

function cleanField(v: any): string | undefined {
  if (v === null || v === undefined) return undefined;
  try {
    const s = String(v).split(/[\n\r]/)[0].trim();
    return s || undefined;
  } catch { return undefined; }
}

function cleanRegistration(v: string | undefined): string | undefined {
  if (!v) return undefined;
  const s = v.split(' ')[0].trim().toLowerCase();
  if (!s || s === 'photos' || s === 'unknown' || s === 'n/a') return undefined;
  return v.split(' ')[0].trim();
}

function normalizePhoto(p: any): RoowusImage {
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
  const img = cleanField(p.imageUrl ?? p.image ?? p.fullUrl ?? (p.urls && p.urls.full));
  const thumb = cleanField(p.thumbnailUrl ?? p.thumb ?? (p.urls && p.urls.thumb) ?? (p.urls && p.urls.small));
  const photographer = cleanField(p.photographer ?? p.photographerName ?? p.author);
  const rawAircraft = cleanField(p.aircraftType ?? p.model ?? p.aircraft);
  const aircraft = rawAircraft ? rawAircraft
    .replace('AerospatialeBritish Aircraft Corporation', 'Aerospatiale / British Aircraft Corporation')
    .replace('AérospatialeBritish Aircraft Corporation', 'Aérospatiale / British Aircraft Corporation')
    .replace('McDonnellDouglas', 'McDonnell Douglas')
    : undefined;
  const airline = cleanField(p.airline ?? p.airlineName);
  const registration = cleanRegistration(cleanField(p.registration ?? p.reg ?? p.tailNumber ?? p.tail_number));
  const when = cleanField(p.year ?? p.taken_at ?? p.photoDate ?? p.uploadedDate);
  const location = cleanField(p.location ?? p.airport ?? p.locationName ?? p.location_full);
  const photoId = cleanField(p.photoId ?? p.id ?? p.photo_id);
  return {
    photoId,
    Image: img,
    Thumbnail: thumb,
    Photographer: photographer,
    Link: makeAbsoluteJetphotosLink(cleanField(linkCandidate)) || (photoId ? `https://www.jetphotos.com/photo/${photoId}` : undefined),
    Aircraft: aircraft,
    Airline: airline,
    Registration: registration,
    DateTaken: when,
    Location: location,
  };
}

function isMilitary(img: RoowusImage): boolean {
  const haystack = [img.Airline, img.Aircraft, img.Registration, img.Location]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return MILITARY_KEYWORDS.some(kw => haystack.includes(kw));
}

async function retry<T>(fn: () => Promise<T>, attempts = 3, backoffMs = 300): Promise<T> {
  let last: any;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); } catch (e) { last = e; if (i < attempts - 1) await new Promise(r => setTimeout(r, backoffMs * (i + 1))); }
  }
  throw last;
}

function randomSortOrder(): number {
  return Math.floor(Math.random() * 3);
}

function randomPage(max: number): number {
  return 1 + Math.floor(Math.random() * max);
}

export type SearchParams = {
  manufacturer?: string;
  airline?: string;
  year?: string;
};

export async function fetchForKeyword(params: SearchParams, photos = DEFAULT_PHOTOS, page?: number, sortOrder?: number) {
  const resolvedPage = page ?? randomPage(3);
  const resolvedSort = sortOrder ?? randomSortOrder();
  const cacheId = JSON.stringify(params) + `:p:${photos}`;
  const key = `kw:${cacheId}`;
  const fromCache = readCache(key);
  if (fromCache) return fromCache;

  const url = new URL(BASE + '/');
  url.searchParams.set('page', String(resolvedPage));
  url.searchParams.set('sort-order', String(resolvedSort));

  if (params.manufacturer) {
    url.searchParams.set('keywords', params.manufacturer);
    url.searchParams.set('keywords-type', 'aircraft');
    url.searchParams.set('keywords-contain', '3');
  }
  if (params.airline) {
    url.searchParams.set('airline', params.airline);
  }
  if (params.year) {
    url.searchParams.set('year', params.year);
  }

  const json = await limit(() => retry(() => fetchJson(url.toString())));
  const photosArr = Array.isArray(json.photos) ? json.photos : (json?.data ?? []);
  let imgs = photosArr.slice(0, photos).map(normalizePhoto);
  imgs = shuffle(imgs);

  const label = [params.manufacturer, params.airline, params.year].filter(Boolean).join(' / ');
  const result = { Reg: label, Images: imgs, raw: json };
  writeCache(key, result);
  return result;
}

export async function fetchForReg(reg: string, photos = DEFAULT_PHOTOS) {
  const key = `reg:${reg}:p:${photos}`;
  const fromCache = readCache(key);
  if (fromCache) return fromCache;

  const url = new URL(BASE + '/');
  url.searchParams.set('page', '1');
  url.searchParams.set('sort-order', String(randomSortOrder()));
  url.searchParams.set('keywords', reg);
  url.searchParams.set('keywords-type', 'registration');
  url.searchParams.set('keywords-contain', '0');

  const json = await limit(() => retry(() => fetchJson(url.toString())));
  const photosArr = Array.isArray(json.photos) ? json.photos : (json?.data ?? []);
  const result = { Reg: reg, Images: photosArr.slice(0, photos).map(normalizePhoto), raw: json };
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
    const notMilitary = !isMilitary(i);
    return hasImage && hasPhot && hasLink && notPosted && notMilitary;
  });
  if (withAttr.length > 0) return withAttr[Math.floor(Math.random() * withAttr.length)];
  const fallback = res.Images.filter(i => {
    if (!i) return false;
    const hasImage = !!((i.Image && String(i.Image).trim().length > 0) || (i.Thumbnail && String(i.Thumbnail).trim().length > 0));
    const hasLink = !!(i.Link && String(i.Link).trim().length > 0);
    const notPosted = !(i.photoId && posted.has(String(i.photoId)));
    const notMilitary = !isMilitary(i);
    return hasImage && hasLink && notPosted && notMilitary;
  });
  if (fallback.length > 0) return fallback[Math.floor(Math.random() * fallback.length)];
  const anyUnposted = res.Images.filter(i => i && !(i.photoId && posted.has(String(i.photoId))) && !isMilitary(i));
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

function parseLocation(location: string): { name: string; country: string } {
  const raw = location.trim();

  const normalised = raw.replace(/ – /g, ' - ');
  const dashParts = normalised.split(' - ');
  const namePart = dashParts[0].trim();

  const commaIdx = namePart.indexOf(',');
  const name = commaIdx !== -1 ? namePart.slice(0, commaIdx).trim() : namePart;

  let country = '';
  if (dashParts.length >= 2) {
    const afterFirst = dashParts[1].trim();
    const commaInAfter = afterFirst.indexOf(',');
    const candidate = commaInAfter !== -1 ? afterFirst.slice(commaInAfter + 1).trim() : afterFirst;
    if (candidate.toLowerCase() === 'usa' || candidate.toLowerCase() === 'united states') {
      const state = dashParts.length >= 3 ? dashParts[2].trim() : '';
      country = state ? `${state}, USA` : 'USA';
    } else {
      country = candidate;
    }
  }

  if (!country && dashParts.length === 1) {
    const commaIdx2 = raw.indexOf(',');
    if (commaIdx2 !== -1) {
      country = raw.slice(commaIdx2 + 1).trim();
    }
  }

  return { name, country };
}

function aOrAn(word: string): string {
  const first = word.trim()[0]?.toLowerCase();
  return first && 'aeiou'.includes(first) ? 'An' : 'A';
}

export function composeCaption(regOrKeyword: string, img: RoowusImage) {
  const aircraft = (img?.Aircraft || '').toString().trim();
  const registration = (img?.Registration || '').toString().trim();
  const airline = (img?.Airline || '').toString().trim();
  const rawLocation = (img?.Location || '').toString().trim();
  const parsedLocation = rawLocation ? parseLocation(rawLocation) : null;
  const location = parsedLocation
    ? parsedLocation.country
      ? `${parsedLocation.name} (${parsedLocation.country})`
      : parsedLocation.name
    : '';
  const when = (img?.DateTaken || '').toString().trim();
  const photographer = (img?.Photographer || '').toString().trim();

  const subjectWord = aircraft || regOrKeyword;
  const article = aOrAn(subjectWord);

  let main = `${article} ${subjectWord}`;
  if (registration) {
    main += `, registered ${registration}`;
  } else {
    main += `, with an unknown registration`;
  }
  if (airline) main += ` and operated by ${airline}`;
  if (location) main += `, at ${location}`;
  if (when) {
    const parts = when.split('-');
    const year = parts[0] || '';
    const month = parts[1] || '00';
    const day = parts[2] || '00';
    if (month === '00') {
      main += `, on an unknown date in ${year}`;
    } else if (day === '00') {
      const monthName = new Intl.DateTimeFormat('en-US', { month: 'long' }).format(new Date(`${year}-${month}-15T12:00:00`));
      main += `, in ${monthName} ${year}`;
    } else {
      const dateObj = new Date(`${year}-${month}-${day}T12:00:00`);
      const formatted = new Intl.DateTimeFormat('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }).format(dateObj);
      main += `, on ${formatted}`;
    }
  }

  const photoBy = photographer ? `Photo by ${photographer} on JetPhotos:` : `Photo on JetPhotos:`;
  const link = img?.Link ? String(img.Link).trim() : '';
  const captionText = link ? `${main}.\n\n${photoBy}\n${link}.` : `${main}. ${photoBy}`;
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