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

const PRIVATE_KEYWORDS = [
  'private', 'general aviation', 'Piper', 'Beechcraft', 'Cirrus', 'Cessna',
  'Mooney', 'Gulfstream', 'Helicopter', 'Eurocopter', 'Agusta', 'Pilatus',
  'Sling', 'Gippsland', 'Robinson', 'Diamond', 'Swidnik', 'Zlin', 'SZD',
  'Socata', 'Aerospatiale', 'Aero Boero', 'Hawker Siddeley',
  'Learjet', 'Challenger', 'BD-100', 'BD-700',
  'Global Express', 'Global 5000', 'Global 6000', 'Global 7500',
  'Phenom', 'Praetor', 'Lineage', 'Legacy 4', 'Legacy 5', 'Legacy 6',
  'Tucano', 'C-390', 'EMB-312', 'EMB-314', 'A-29', 'AMX', 'EMB-111',
  'R-99', 'E-99', 'Xingu', 'Ipanema', 'Seneca', 'Navajo', 'Corisco',
  'Mil Mi', 'Mi-8', 'Mi-17', 'Mi-24', 'Mi-26', 'Dassault', 'Raytheon',
  'Pipistrel', 'Tecnam', 'Sikorsky', 'Kavanagh', 'Robin',
];

const ALWAYS_ALLOW = [
  'concorde', 'trident', '748', 'argosy', 'comet',
  'mercure', 's-38', 's-40', 's-42', 's-43',
];

const LOCATION_KEYWORDS = [
  'inflight',
];

const MILITARY_KEYWORDS = [
  'air force', 'army', 'navy', 'naval', 'marine', 'marines', 'military',
  'defence', 'defense', 'luftwaffe', 'armée', 'fuerza aérea', 'aeronautica',
  'royal air', 'coast guard', 'national guard', 'air command', 'air wing',
  'usaf', 'usmc', 'raf ', 'jmsdf', 'plaaf',
  'lockheed martin', 'boeing f-', 'f-35', 'f-22', 'f-16', 'f-15', 'f-14',
  'f-18', 'f/a-18', 'f-4', 'f-86', 'f-100', 'f-104', 'f-105', 'f-111',
  'b-52', 'b-1', 'b-2', 'c-17', 'c-130', 'c-5', 'e-3', 'e-8', 'kc-135',
  'lightning ii', 'raptor', 'fighting falcon', 'hornet', 'tomcat', 'phantom',
  'stratofortress', 'globemaster', 'hercules', 'galaxy', 'warplane', 'warbird',
  'police',
];

const BASE = ((process.env.ROOWUS_BASE || 'https://randoplane-jetphotos-api.kingforpa.workers.dev').toString().trim()).replace(/\/+$/, '');
const DEFAULT_PHOTOS = Number(process.env.JP_PHOTOS || 5);
const CONCURRENCY = Number(process.env.JP_CONCURRENCY || 6);
const CACHE_TTL_SECONDS = Number(process.env.ROOWUS_CACHE_TTL || 3600);
const CACHE_DIR = process.env.ROOWUS_CACHE_DIR || path.resolve(process.cwd(), '.roowus_cache');
const POSTED_HISTORY = path.join(CACHE_DIR, 'posted_photos.json');
const POSTED_REGS = path.join(CACHE_DIR, 'posted_registrations.json');
const HISTORY_CAP = 20000;
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
  const s = v.split(' ')[0].trim();
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
  const when = cleanField(p.year ?? p.taken_at ?? p.photoDate ?? p.uploadedDate ?? p.DateTaken ?? p.DateUploaded);
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

export function isMilitary(img: RoowusImage): boolean {
  const haystack = [img.Airline, img.Aircraft, img.Registration, img.Location]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return MILITARY_KEYWORDS.some(kw => haystack.includes(kw));
}

function fold(s: any): string {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function isPrivate(img: RoowusImage): boolean {
  const haystack = fold([img.Airline, img.Aircraft].filter(Boolean).join(' '));
  if (ALWAYS_ALLOW.some(kw => haystack.includes(fold(kw)))) return false;
  if (PRIVATE_KEYWORDS.some(kw => haystack.includes(fold(kw)))) return true;
  const loc = fold(img.Location);
  return LOCATION_KEYWORDS.some(kw => loc.includes(fold(kw)));
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
    const notPrivate = !isPrivate(i);
    return hasImage && hasPhot && hasLink && notPosted && notMilitary && notPrivate;
  });
  if (withAttr.length > 0) return withAttr[Math.floor(Math.random() * withAttr.length)];
  const fallback = res.Images.filter(i => {
    if (!i) return false;
    const hasImage = !!((i.Image && String(i.Image).trim().length > 0) || (i.Thumbnail && String(i.Thumbnail).trim().length > 0));
    const hasLink = !!(i.Link && String(i.Link).trim().length > 0);
    const notPosted = !(i.photoId && posted.has(String(i.photoId)));
    const notMilitary = !isMilitary(i);
    const notPrivate = !isPrivate(i);
    return hasImage && hasLink && notPosted && notMilitary && notPrivate;
  });
  if (fallback.length > 0) return fallback[Math.floor(Math.random() * fallback.length)];
  const anyUnposted = res.Images.filter(i => i && !(i.photoId && posted.has(String(i.photoId))) && !isMilitary(i) && !isPrivate(i));
  if (anyUnposted.length > 0) return anyUnposted[Math.floor(Math.random() * anyUnposted.length)];

  const anyNonMilitaryNonPrivate = res.Images.filter(i => i && !isMilitary(i) && !isPrivate(i));
  if (anyNonMilitaryNonPrivate.length > 0) return anyNonMilitaryNonPrivate[Math.floor(Math.random() * anyNonMilitaryNonPrivate.length)];

  return null;
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

const ICAO_PREFIX_TO_COUNTRY: Record<string, string> = {
  // North America
  K: 'USA', PA: 'Alaska, USA', PH: 'Hawaii, USA', PG: 'Guam, USA',
  TJ: 'Puerto Rico, USA', TI: 'US Virgin Islands, USA',
  C: 'Canada', MM: 'Mexico',
  // Central America / Caribbean
  MG: 'Guatemala', MH: 'Honduras', MN: 'Nicaragua', MP: 'Panama', MR: 'Costa Rica',
  MS: 'El Salvador', MU: 'Cuba', MD: 'Dominican Republic', MB: 'Turks and Caicos',
  MK: 'Jamaica', MY: 'Bahamas', MZ: 'Belize', TG: 'Grenada', TT: 'Trinidad and Tobago',
  TB: 'Barbados', TD: 'Dominica', TL: 'Saint Lucia', TV: 'Saint Vincent and the Grenadines',
  TK: 'Saint Kitts and Nevis', TA: 'Antigua and Barbuda', TF: 'Guadeloupe / Martinique',
  // South America
  SA: 'Argentina', SB: 'Brazil', SC: 'Chile', SE: 'Ecuador', SG: 'Paraguay',
  SK: 'Colombia', SL: 'Bolivia', SM: 'Suriname', SO: 'French Guiana', SP: 'Peru',
  SU: 'Uruguay', SV: 'Venezuela', SY: 'Guyana',
  // Europe
  EG: 'United Kingdom', EI: 'Ireland', EF: 'Finland', EK: 'Denmark', EN: 'Norway',
  ES: 'Sweden', ED: 'Germany', ET: 'Germany', EH: 'Netherlands', EB: 'Belgium',
  EL: 'Luxembourg', LF: 'France', LE: 'Spain', GC: 'Canary Islands, Spain',
  LP: 'Portugal', LI: 'Italy', LM: 'Malta', LS: 'Switzerland', LO: 'Austria',
  EP: 'Poland', LK: 'Czech Republic', LZ: 'Slovakia', LH: 'Hungary', LR: 'Romania',
  LB: 'Bulgaria', LD: 'Croatia', LJ: 'Slovenia', LQ: 'Bosnia and Herzegovina',
  LW: 'North Macedonia', LY: 'Serbia', BK: 'Kosovo', LA: 'Albania', LG: 'Greece',
  LT: 'Turkey', LC: 'Cyprus', UK: 'Ukraine', UM: 'Belarus', BI: 'Iceland',
  EV: 'Latvia', EY: 'Lithuania', EE: 'Estonia', UG: 'Georgia', UD: 'Armenia',
  UB: 'Azerbaijan', ML: 'Moldova', LN: 'Monaco', U: 'Russia',
  // Middle East
  OT: 'Qatar', OB: 'Bahrain', OK: 'Kuwait', OO: 'Oman', OM: 'United Arab Emirates',
  OE: 'Saudi Arabia', OJ: 'Jordan', OL: 'Lebanon', OS: 'Syria', OI: 'Iran',
  OR: 'Iraq', OY: 'Yemen', LL: 'Israel', OP: 'Pakistan', OA: 'Afghanistan',
  // Africa
  FA: 'South Africa', FB: 'Botswana', FC: 'Republic of the Congo', FD: 'Eswatini',
  FE: 'Central African Republic', FG: 'Equatorial Guinea', FH: 'Saint Helena',
  FI: 'Mauritius', FJ: 'British Indian Ocean Territory', FK: 'Cameroon',
  FL: 'Zambia', FM: 'Madagascar', FN: 'Angola', FO: 'Gabon',
  FP: 'Sao Tome and Principe', FQ: 'Mozambique', FS: 'Seychelles', FT: 'Chad',
  FV: 'Zimbabwe', FW: 'Malawi', FX: 'Lesotho', FY: 'Namibia',
  FZ: 'Democratic Republic of the Congo', DA: 'Algeria', DB: 'Benin',
  DF: 'Burkina Faso', DG: 'Ghana', DI: 'Ivory Coast', DN: 'Nigeria', DR: 'Niger',
  DT: 'Tunisia', DX: 'Togo', GA: 'Mali', GB: 'Gambia', GF: 'Sierra Leone',
  GG: 'Guinea-Bissau', GL: 'Liberia', GM: 'Morocco', GO: 'Senegal',
  GQ: 'Mauritania', GS: 'Western Sahara', GU: 'Guinea', GV: 'Cape Verde',
  HA: 'Ethiopia', HB: 'Burundi', HC: 'Somalia', HD: 'Djibouti', HE: 'Egypt',
  HH: 'Eritrea', HK: 'Kenya', HL: 'Libya', HR: 'Rwanda', HS: 'Sudan',
  HT: 'Tanzania', HU: 'Uganda',
  // Asia
  RJ: 'Japan', RO: 'Japan', RK: 'South Korea', ZK: 'North Korea', Z: 'China',
  RC: 'Taiwan', VH: 'Hong Kong', VM: 'Macau', VT: 'Thailand', VD: 'Cambodia',
  VL: 'Laos', VV: 'Vietnam', VY: 'Myanmar', WM: 'Malaysia', WB: 'Malaysia',
  WS: 'Singapore', WI: 'Indonesia', WA: 'Indonesia', WQ: 'Indonesia',
  WR: 'Indonesia', RP: 'Philippines', VE: 'India', VA: 'India', VI: 'India',
  VO: 'India', VN: 'Nepal', VG: 'Bangladesh', VC: 'Sri Lanka', VQ: 'Bhutan',
  VR: 'Maldives', UA: 'Kazakhstan', UT: 'Central Asia',
  // Oceania
  Y: 'Australia', NZ: 'New Zealand', NF: 'Fiji', NG: 'Kiribati',
  NC: 'Cook Islands', NS: 'Samoa', NT: 'French Polynesia', NV: 'Vanuatu',
  AN: 'Nauru', AY: 'Papua New Guinea', PT: 'Micronesia', PK: 'Marshall Islands',
};
// Match longest prefix first so e.g. "VT" (Thailand) beats a stray single-letter
// fallback, and "ZK" (North Korea) beats the generic "Z" (China) entry.
const ICAO_PREFIXES_BY_LENGTH = Object.keys(ICAO_PREFIX_TO_COUNTRY).sort((a, b) => b.length - a.length);

function icaoPrefixToCountry(prefix: string): string | undefined {
  if (!prefix) return undefined;
  const p = prefix.toUpperCase();
  for (const key of ICAO_PREFIXES_BY_LENGTH) {
    if (p.startsWith(key)) return ICAO_PREFIX_TO_COUNTRY[key];
  }
  return undefined;
}

function parseLocation(location: string): { name: string; country: string } {
  const raw = location.trim();
  const normalised = raw.replace(/ – /g, ' - ');
  const dashParts = normalised.split(' - ').map(s => s.trim()).filter(Boolean);
  const namePart = dashParts[0] || '';
  const commaIdx = namePart.indexOf(',');
  const name = commaIdx !== -1 ? namePart.slice(0, commaIdx).trim() : namePart;
  let country = '';
  if (dashParts.length >= 2) {
    const afterFirst = dashParts[1].trim();
    const codeCandidate = afterFirst.replace(/\s+/g, '').toUpperCase();
    if (/^[A-Z]{3,4}$/.test(codeCandidate)) {
      const mapped = icaoPrefixToCountry(codeCandidate);
      if (mapped) {
        country = mapped;
      } else {
        country = ''; // prefer not to show raw code if we can't map it
      }
    } else {
      const commaInAfter = afterFirst.indexOf(',');
      const candidate = commaInAfter !== -1 ? afterFirst.slice(commaInAfter + 1).trim() : afterFirst;
      if (candidate.toLowerCase() === 'usa' || candidate.toLowerCase() === 'united states') {
        const state = dashParts.length >= 3 ? dashParts[2].trim() : '';
        country = state ? `${state}, USA` : 'USA';
      } else {
        country = candidate;
      }
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
  const airline = (img?.Airline || '').toString().trim();
  const rawLocation = (img?.Location || '').toString().trim();
  const parsedLocation = rawLocation ? parseLocation(rawLocation) : null;
  const location = parsedLocation
    ? parsedLocation.country
      ? `${parsedLocation.name} (${parsedLocation.country})`
      : parsedLocation.name
    : '';
  const whenRaw = (img?.DateTaken || img?.DateUploaded || '').toString().trim();
  let when = whenRaw;
  let year = '';
  let month = '';
  let day = '';
  if (whenRaw) {
    if (/^\d{4}(-\d{2}(-\d{2})?)?$/.test(whenRaw)) {
      const parts = whenRaw.split('-');
      year = parts[0] || '';
      month = parts[1] || '00';
      day = parts[2] || '00';
    } else {
      const parsed = Date.parse(whenRaw);
      if (!isNaN(parsed)) {
        const d = new Date(parsed);
        year = String(d.getFullYear());
        month = String(d.getMonth() + 1).padStart(2, '0');
        day = String(d.getDate()).padStart(2, '0');
      } else {
        const m = whenRaw.match(/(\d{4})/);
        if (m) { year = m[1]; month = '00'; day = '00'; }
      }
    }
  }
  const photographer = (img?.Photographer || '').toString().trim();
  const subjectWord = aircraft || regOrKeyword || 'NA';
  const article = aOrAn(subjectWord || '');
  let main = `${article} ${subjectWord}`;
  if (airline) main += `, operated by ${airline}`;
  if (location) main += `, at ${location}`;
  if (when) {
    if (year && month === '00') {
      main += `, on an unknown date in ${year}`;
    } else if (year && month && day && month !== '00' && day !== '00') {
      try {
        const dateObj = new Date(`${year}-${month}-${day}T12:00:00`);
        const formatted = new Intl.DateTimeFormat('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }).format(dateObj);
        main += `, on ${formatted}`;
      } catch {
        // fallback to raw when string
        main += `, on ${when}`;
      }
    } else {
      main += `, on ${when}`;
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
      try { fs.writeFileSync(POSTED_HISTORY, JSON.stringify(arr.slice(-HISTORY_CAP)), 'utf8'); } catch {}
    }
  } catch {}
}

function normalizeReg(reg: string): string {
  return String(reg || '').trim().toUpperCase().replace(/\s+/g, '');
}

function readList(file: string): string[] {
  try {
    if (!fs.existsSync(file)) return [];
    const arr = JSON.parse(fs.readFileSync(file, 'utf8') || '[]');
    return Array.isArray(arr) ? arr.map(String) : [];
  } catch { return []; }
}

export function recordPostedRegistration(reg: string) {
  const key = normalizeReg(reg);
  if (!key) return;
  try {
    ensureCacheDir();
    const arr = readList(POSTED_REGS);
    if (!arr.includes(key)) {
      arr.push(key);
      try { fs.writeFileSync(POSTED_REGS, JSON.stringify(arr.slice(-HISTORY_CAP)), 'utf8'); } catch {}
    }
  } catch {}
}

export function wasRegistrationPosted(reg: string): boolean {
  const key = normalizeReg(reg);
  if (!key) return false;
  return readList(POSTED_REGS).includes(key);
}

export function postedRegistrationCount(): number {
  return readList(POSTED_REGS).length;
}

export function wasPhotoPosted(photoId: string) {
  try {
    if (!fs.existsSync(POSTED_HISTORY)) return false;
    const arr = JSON.parse(fs.readFileSync(POSTED_HISTORY, 'utf8') || '[]');
    return Array.isArray(arr) && arr.includes(String(photoId));
  } catch { return false; }
}