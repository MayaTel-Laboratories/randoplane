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
  const res = await fetch(url, { ...opts, headers: { 'User-Agent': 'randoplane/roowus-adapter/1.0', ...(opts.headers || {}) } });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err: any = new Error(`Roowus API: ${res.status} ${res.statusText}${text ? ` - ${text.slice(0,200)}` : ''}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

function normalizePhoto(p: any): RoowusImage {
  return {
    Image: p.imageUrl || p.image || p.fullUrl || p.urls?.full,
    Thumbnail: p.thumbnailUrl || p.thumb || p.urls?.thumb,
    Photographer: p.photographer || p.photographerName || p.author,
    Link: p.pageUrl || p.url || p.link,
    Aircraft: p.aircraftType || p.model,
    Airline: p.airline,
    DateTaken: p.year || p.taken_at,
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
  const withAttr = res.Images.filter(i => i && i.Photographer && i.Link && i.Image);
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
  const body = res.body;
  if (!body) throw new Error('No response body to download');
  await streamPipeline(body, fs.createWriteStream(outPath));
  return outPath;
}

export function composeCaption(regOrKeyword: string, img: RoowusImage) {
  const parts: string[] = [];
  const aircraft = (img?.Aircraft || '').toString().trim();
  const airline = (img?.Airline || '').toString().trim();
  const photographer = (img?.Photographer || '').toString().trim();
  if (aircraft) parts.push(aircraft);
  parts.push(regOrKeyword);
  if (airline) parts.push(`(${airline})`);
  const main = parts.join(' ');
  const by = photographer ? `Photo: ${photographer}` : '';
  const link = img?.Link ? `\n\nSource: ${img.Link}` : '';
  const captionText = [main, by].filter(Boolean).join(' · ') + link;
  return { text: captionText };
}