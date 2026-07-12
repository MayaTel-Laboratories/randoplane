import { queryJetApiByRegistration } from './jetapi-client';
import { wasPhotoPosted } from './roowus';
type FoundResult = {
  reg: string;
  imageUrl: string;
  info: {
    photographer?: string | null;
    link?: string | null;
    id?: string | null;
    raw?: any;
    aircraft?: string | null;
    airline?: string | null;
    location?: string | null;
    registration?: string | null;
    date?: string | null;
  };
};
function randInt(min: number, max: number) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function pick<T>(arr: T[]) { return arr[Math.floor(Math.random() * arr.length)]; }

const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const DIGITS = '0123456789';

type RegFormat = {
  country: string;
  prefixes: string[];
  suffixMin: number;
  suffixMax: number;
  suffixCharset: typeof ALPHA | typeof ALNUM | typeof DIGITS;
};

const REG_FORMATS: RegFormat[] = [
  { country: 'USA', prefixes: ['N'], suffixMin: 3, suffixMax: 5, suffixCharset: ALNUM },
  { country: 'USA (pre-1950)', prefixes: ['NC'], suffixMin: 3, suffixMax: 5, suffixCharset: ALNUM },
  { country: 'Canada', prefixes: ['C-F', 'C-G'], suffixMin: 3, suffixMax: 3, suffixCharset: ALPHA },
  { country: 'Mexico', prefixes: ['XA-', 'XB-', 'XC-'], suffixMin: 3, suffixMax: 3, suffixCharset: ALNUM },
  { country: 'Cuba', prefixes: ['CU-'], suffixMin: 3, suffixMax: 3, suffixCharset: ALNUM },
  { country: 'Jamaica', prefixes: ['6Y-'], suffixMin: 3, suffixMax: 3, suffixCharset: ALPHA },
  { country: 'Bahamas', prefixes: ['C6-'], suffixMin: 3, suffixMax: 3, suffixCharset: ALPHA },
  { country: 'Panama', prefixes: ['HP-'], suffixMin: 3, suffixMax: 4, suffixCharset: ALNUM },
  { country: 'Costa Rica', prefixes: ['TI-'], suffixMin: 3, suffixMax: 4, suffixCharset: ALNUM },
  { country: 'Guatemala', prefixes: ['TG-'], suffixMin: 3, suffixMax: 4, suffixCharset: ALNUM },
  { country: 'Dominican Republic', prefixes: ['HI-'], suffixMin: 3, suffixMax: 4, suffixCharset: ALNUM },
  { country: 'Trinidad and Tobago', prefixes: ['9Y-'], suffixMin: 3, suffixMax: 3, suffixCharset: ALPHA },
  { country: 'Brazil', prefixes: ['PR-', 'PP-', 'PT-', 'PU-'], suffixMin: 3, suffixMax: 3, suffixCharset: ALPHA },
  { country: 'Argentina', prefixes: ['LV-'], suffixMin: 3, suffixMax: 3, suffixCharset: ALNUM },
  { country: 'Chile', prefixes: ['CC-'], suffixMin: 3, suffixMax: 3, suffixCharset: ALPHA },
  { country: 'Colombia', prefixes: ['HK-'], suffixMin: 3, suffixMax: 4, suffixCharset: ALNUM },
  { country: 'Peru', prefixes: ['OB-'], suffixMin: 3, suffixMax: 4, suffixCharset: ALNUM },
  { country: 'Venezuela', prefixes: ['YV-'], suffixMin: 3, suffixMax: 4, suffixCharset: ALNUM },
  { country: 'Ecuador', prefixes: ['HC-'], suffixMin: 3, suffixMax: 4, suffixCharset: ALNUM },
  { country: 'Bolivia', prefixes: ['CP-'], suffixMin: 3, suffixMax: 4, suffixCharset: ALNUM },
  { country: 'Uruguay', prefixes: ['CX-'], suffixMin: 3, suffixMax: 3, suffixCharset: ALPHA },
  { country: 'Paraguay', prefixes: ['ZP-'], suffixMin: 3, suffixMax: 4, suffixCharset: ALNUM },
  { country: 'Guyana', prefixes: ['8R-'], suffixMin: 3, suffixMax: 3, suffixCharset: ALPHA },
  { country: 'United Kingdom', prefixes: ['G-'], suffixMin: 4, suffixMax: 4, suffixCharset: ALNUM },
  { country: 'Germany', prefixes: ['D-'], suffixMin: 3, suffixMax: 4, suffixCharset: ALPHA },
  { country: 'East Germany', prefixes: ['DDR-'], suffixMin: 3, suffixMax: 3, suffixCharset: ALPHA },
  { country: 'France', prefixes: ['F-'], suffixMin: 4, suffixMax: 4, suffixCharset: ALPHA },
  { country: 'Italy', prefixes: ['I-'], suffixMin: 3, suffixMax: 4, suffixCharset: ALPHA },
  { country: 'Austria', prefixes: ['OE-'], suffixMin: 3, suffixMax: 3, suffixCharset: ALPHA },
  { country: 'Netherlands', prefixes: ['PH-'], suffixMin: 3, suffixMax: 3, suffixCharset: ALPHA },
  { country: 'Spain', prefixes: ['EC-'], suffixMin: 3, suffixMax: 3, suffixCharset: ALNUM },
  { country: 'Portugal', prefixes: ['CS-'], suffixMin: 3, suffixMax: 3, suffixCharset: ALPHA },
  { country: 'Switzerland', prefixes: ['HB-'], suffixMin: 3, suffixMax: 3, suffixCharset: ALPHA },
  { country: 'Belgium', prefixes: ['OO-'], suffixMin: 3, suffixMax: 3, suffixCharset: ALPHA },
  { country: 'Ireland', prefixes: ['EI-'], suffixMin: 3, suffixMax: 3, suffixCharset: ALPHA },
  { country: 'Sweden', prefixes: ['SE-'], suffixMin: 3, suffixMax: 3, suffixCharset: ALPHA },
  { country: 'Norway', prefixes: ['LN-'], suffixMin: 3, suffixMax: 3, suffixCharset: ALPHA },
  { country: 'Denmark', prefixes: ['OY-'], suffixMin: 3, suffixMax: 3, suffixCharset: ALPHA },
  { country: 'Finland', prefixes: ['OH-'], suffixMin: 3, suffixMax: 3, suffixCharset: ALNUM },
  { country: 'Iceland', prefixes: ['TF-'], suffixMin: 3, suffixMax: 3, suffixCharset: ALPHA },
  { country: 'Poland', prefixes: ['SP-'], suffixMin: 3, suffixMax: 3, suffixCharset: ALPHA },
  { country: 'Czech Republic', prefixes: ['OK-'], suffixMin: 3, suffixMax: 3, suffixCharset: ALPHA },
  { country: 'Hungary', prefixes: ['HA-'], suffixMin: 4, suffixMax: 4, suffixCharset: DIGITS },
  { country: 'Greece', prefixes: ['SX-'], suffixMin: 3, suffixMax: 3, suffixCharset: ALPHA },
  { country: 'Turkey', prefixes: ['TC-'], suffixMin: 3, suffixMax: 3, suffixCharset: ALPHA },
  { country: 'Russia', prefixes: ['RA-'], suffixMin: 5, suffixMax: 5, suffixCharset: DIGITS },
  { country: 'Soviet Union', prefixes: ['CCCP-'], suffixMin: 5, suffixMax: 5, suffixCharset: DIGITS },
  { country: 'Ukraine', prefixes: ['UR-'], suffixMin: 5, suffixMax: 5, suffixCharset: ALNUM },
  { country: 'Romania', prefixes: ['YR-'], suffixMin: 3, suffixMax: 3, suffixCharset: ALNUM },
  { country: 'Croatia', prefixes: ['9A-'], suffixMin: 3, suffixMax: 3, suffixCharset: ALPHA },
  { country: 'Saudi Arabia', prefixes: ['HZ-'], suffixMin: 3, suffixMax: 3, suffixCharset: ALNUM },
  { country: 'Qatar', prefixes: ['A7-'], suffixMin: 3, suffixMax: 3, suffixCharset: ALPHA },
  { country: 'Kuwait', prefixes: ['9K-'], suffixMin: 3, suffixMax: 3, suffixCharset: ALPHA },
  { country: 'Bahrain', prefixes: ['A9C-'], suffixMin: 2, suffixMax: 2, suffixCharset: ALPHA },
  { country: 'Jordan', prefixes: ['JY-'], suffixMin: 3, suffixMax: 3, suffixCharset: ALPHA },
  { country: 'Lebanon', prefixes: ['OD-'], suffixMin: 3, suffixMax: 3, suffixCharset: ALPHA },
  { country: 'Oman', prefixes: ['A4O-'], suffixMin: 2, suffixMax: 2, suffixCharset: ALPHA },
  { country: 'Iran', prefixes: ['EP-'], suffixMin: 3, suffixMax: 3, suffixCharset: ALPHA },
  { country: 'Iraq', prefixes: ['YI-'], suffixMin: 3, suffixMax: 3, suffixCharset: ALPHA },
  { country: 'Japan', prefixes: ['JA'], suffixMin: 3, suffixMax: 4, suffixCharset: ALNUM },
  { country: 'China', prefixes: ['B-'], suffixMin: 4, suffixMax: 4, suffixCharset: DIGITS },
  { country: 'Taiwan', prefixes: ['B-'], suffixMin: 5, suffixMax: 5, suffixCharset: DIGITS },
  { country: 'Hong Kong', prefixes: ['B-H'], suffixMin: 2, suffixMax: 2, suffixCharset: ALPHA },
  { country: 'Macau', prefixes: ['B-M'], suffixMin: 2, suffixMax: 2, suffixCharset: ALPHA },
  { country: 'South Korea', prefixes: ['HL'], suffixMin: 4, suffixMax: 4, suffixCharset: DIGITS },
  { country: 'North Korea', prefixes: ['P-'], suffixMin: 3, suffixMax: 3, suffixCharset: DIGITS },
  { country: 'Thailand', prefixes: ['HS-'], suffixMin: 3, suffixMax: 4, suffixCharset: ALNUM },
  { country: 'Vietnam', prefixes: ['VN-A'], suffixMin: 3, suffixMax: 3, suffixCharset: DIGITS },
  { country: 'Laos', prefixes: ['RDPL-'], suffixMin: 2, suffixMax: 2, suffixCharset: DIGITS },
  { country: 'Cambodia', prefixes: ['XU-'], suffixMin: 3, suffixMax: 3, suffixCharset: ALNUM },
  { country: 'Myanmar', prefixes: ['XY-'], suffixMin: 3, suffixMax: 3, suffixCharset: ALNUM },
  { country: 'Philippines', prefixes: ['RP-C'], suffixMin: 4, suffixMax: 4, suffixCharset: DIGITS },
  { country: 'Indonesia', prefixes: ['PK-'], suffixMin: 3, suffixMax: 3, suffixCharset: ALPHA },
  { country: 'Malaysia', prefixes: ['9M-'], suffixMin: 3, suffixMax: 3, suffixCharset: ALPHA },
  { country: 'Singapore', prefixes: ['9V-'], suffixMin: 3, suffixMax: 3, suffixCharset: ALPHA },
  { country: 'Brunei', prefixes: ['V8-'], suffixMin: 3, suffixMax: 3, suffixCharset: ALPHA },
  { country: 'India', prefixes: ['VT-'], suffixMin: 3, suffixMax: 3, suffixCharset: ALPHA },
  { country: 'Pakistan', prefixes: ['AP-'], suffixMin: 3, suffixMax: 3, suffixCharset: ALPHA },
  { country: 'Bangladesh', prefixes: ['S2-'], suffixMin: 3, suffixMax: 4, suffixCharset: ALNUM },
  { country: 'Sri Lanka', prefixes: ['4R-'], suffixMin: 3, suffixMax: 3, suffixCharset: ALPHA },
  { country: 'Nepal', prefixes: ['9N-'], suffixMin: 3, suffixMax: 3, suffixCharset: ALPHA },
  { country: 'Mongolia', prefixes: ['JU-'], suffixMin: 4, suffixMax: 4, suffixCharset: ALNUM },
  { country: 'Kazakhstan', prefixes: ['UP-'], suffixMin: 5, suffixMax: 5, suffixCharset: DIGITS },
  { country: 'Afghanistan', prefixes: ['YA-'], suffixMin: 3, suffixMax: 3, suffixCharset: ALPHA },
  { country: 'South Africa', prefixes: ['ZS-'], suffixMin: 3, suffixMax: 3, suffixCharset: ALPHA },
  { country: 'Nigeria', prefixes: ['5N-'], suffixMin: 3, suffixMax: 3, suffixCharset: ALPHA },
  { country: 'Kenya', prefixes: ['5Y-'], suffixMin: 3, suffixMax: 3, suffixCharset: ALPHA },
  { country: 'Egypt', prefixes: ['SU-'], suffixMin: 3, suffixMax: 3, suffixCharset: ALPHA },
  { country: 'Morocco', prefixes: ['CN-'], suffixMin: 3, suffixMax: 3, suffixCharset: ALPHA },
  { country: 'Algeria', prefixes: ['7T-'], suffixMin: 3, suffixMax: 3, suffixCharset: ALPHA },
  { country: 'Tunisia', prefixes: ['TS-'], suffixMin: 3, suffixMax: 3, suffixCharset: ALPHA },
  { country: 'Libya', prefixes: ['5A-'], suffixMin: 3, suffixMax: 3, suffixCharset: ALPHA },
  { country: 'Ethiopia', prefixes: ['ET-'], suffixMin: 3, suffixMax: 3, suffixCharset: ALPHA },
  { country: 'Ghana', prefixes: ['9G-'], suffixMin: 3, suffixMax: 3, suffixCharset: ALPHA },
  { country: 'Tanzania', prefixes: ['5H-'], suffixMin: 3, suffixMax: 3, suffixCharset: ALPHA },
  { country: 'Uganda', prefixes: ['5X-'], suffixMin: 3, suffixMax: 3, suffixCharset: ALPHA },
  { country: 'Zimbabwe', prefixes: ['Z-'], suffixMin: 3, suffixMax: 3, suffixCharset: ALPHA },
  { country: 'Zambia', prefixes: ['9J-'], suffixMin: 3, suffixMax: 3, suffixCharset: ALPHA },
  { country: 'Botswana', prefixes: ['A2-'], suffixMin: 3, suffixMax: 3, suffixCharset: ALPHA },
  { country: 'Namibia', prefixes: ['V5-'], suffixMin: 3, suffixMax: 3, suffixCharset: ALPHA },
  { country: 'Angola', prefixes: ['D2-'], suffixMin: 3, suffixMax: 3, suffixCharset: ALPHA },
  { country: 'Mozambique', prefixes: ['C9-'], suffixMin: 3, suffixMax: 3, suffixCharset: ALPHA },
  { country: 'Senegal', prefixes: ['6V-', '6W-'], suffixMin: 3, suffixMax: 3, suffixCharset: ALPHA },
  { country: 'Ivory Coast', prefixes: ['TU-'], suffixMin: 3, suffixMax: 3, suffixCharset: ALPHA },
  { country: 'Cameroon', prefixes: ['TJ-'], suffixMin: 3, suffixMax: 3, suffixCharset: ALPHA },
  { country: 'DR Congo', prefixes: ['9Q-'], suffixMin: 3, suffixMax: 3, suffixCharset: ALPHA },
  { country: 'Sudan', prefixes: ['ST-'], suffixMin: 3, suffixMax: 3, suffixCharset: ALPHA },
  { country: 'Rwanda', prefixes: ['9XR-'], suffixMin: 2, suffixMax: 2, suffixCharset: ALPHA },
  { country: 'Mauritius', prefixes: ['3B-'], suffixMin: 3, suffixMax: 3, suffixCharset: ALPHA },
  { country: 'Madagascar', prefixes: ['5R-'], suffixMin: 3, suffixMax: 3, suffixCharset: ALPHA },
  { country: 'Malawi', prefixes: ['7Q-'], suffixMin: 3, suffixMax: 3, suffixCharset: ALPHA },
  { country: 'Australia', prefixes: ['VH-'], suffixMin: 3, suffixMax: 3, suffixCharset: ALPHA },
  { country: 'New Zealand', prefixes: ['ZK-'], suffixMin: 3, suffixMax: 3, suffixCharset: ALPHA },
];

function buildFromFormat(fmt: RegFormat): string {
  const prefix = pick(fmt.prefixes);
  const len = randInt(fmt.suffixMin, fmt.suffixMax);
  let suffix = '';
  for (let i = 0; i < len; i++) suffix += fmt.suffixCharset.charAt(Math.floor(Math.random() * fmt.suffixCharset.length));
  return prefix + suffix;
}

function getField(obj: any, keys: string[]) {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const k of keys) {
    const v = obj[k];
    if (v === null || v === undefined) continue;
    const s = String(v).trim();
    if (s.length > 0) return s;
  }
  return undefined;
}
function isValidRegistration(candidate?: string | null): boolean {
  if (!candidate) return false;
  const s = candidate.trim();
  const patterns = [
    /^N[0-9A-Z]{1,5}$/i,
    /^G-?[0-9A-Z]{1,4}$/i,
    /^OE-?[A-Z]{3}$/i,
    /^C-[FG][A-Z]{3}$/i,
    /^[A-Z]{1,2}-[A-Z0-9]{3,4}$/i,
    /^[A-Z]{1,2}[A-Z0-9]{3,4}$/i,
    /^[0-9A-Z]{1,4}-[A-Z0-9]{2,5}$/i
  ];
  return patterns.some(rx => rx.test(s));
}
function tryExtractImagesFromJson(json: any): Array<{ url: string; photographer?: string; link?: string; id?: string; raw?: any }> {
  if (!json) return [];
  const candidates: any[] = [];
  if (Array.isArray(json.photos)) candidates.push(...json.photos);
  if (Array.isArray(json.Images)) candidates.push(...json.Images);
  if (Array.isArray(json.images)) candidates.push(...json.images);
  if (Array.isArray(json.data)) candidates.push(...json.data);
  if (Array.isArray(json.results)) candidates.push(...json.results);
  if (json.JetPhotos && Array.isArray(json.JetPhotos.Images)) candidates.push(...json.JetPhotos.Images);
  if (json.JetPhotos && Array.isArray((json.JetPhotos as any).photos)) candidates.push(...(json.JetPhotos as any).photos);
  if (json.JetPhotos && typeof json.JetPhotos === 'object' && !Array.isArray(json.JetPhotos)) {
    const jp = json.JetPhotos;
    if (Array.isArray(jp.Images)) candidates.push(...jp.Images);
    if (Array.isArray((jp as any).photos)) candidates.push(...(jp as any).photos);
  }
  if (json.image || json.url || json.photo) candidates.push(json);
  function walk(obj: any) {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) { for (const el of obj) walk(el); return; }
    const keys = Object.keys(obj);
    const hasUrl = keys.some(k => /^(image|img|url|photo|src)/i.test(k));
    if (hasUrl) candidates.push(obj);
    else { for (const k of keys) { try { walk(obj[k]); } catch {} } }
  }
  if (candidates.length === 0) walk(json);
  const out: Array<{ url: string; photographer?: string; link?: string; id?: string; raw?: any }> = [];
  for (const c of candidates) {
    if (!c || typeof c !== 'object') continue;
    const urlCandidates = [
      c.image, c.Image, c.url, c.Url, c.photo, c.photo_url, c.imageUrl, c.fullUrl,
      (c.urls && c.urls.full), (c.urls && c.urls.large), (c.urls && c.urls.original), (c.urls && c.urls.fullsize),
      c.Thumbnail, c.thumbnail, c.thumb
    ];
    const url = (urlCandidates.find(Boolean) || '')?.toString?.().trim();
    if (!url) continue;
    const photographer = getField(c, ['photographer', 'Photographer', 'author', 'photographerName', 'PhotographerName', 'by']);
    const link = getField(c, ['link', 'Link', 'pageUrl', 'pageURL', 'photoPageUrl', 'photoPage']);
    const id = getField(c, ['photoId', 'PhotoId', 'id', 'photo_id']);
    if (!/^https?:\/\//i.test(url)) continue;
    out.push({ url, photographer: photographer || undefined, link: link || undefined, id: id || undefined, raw: c });
  }
  const seen = new Set<string>();
  return out.filter(o => { if (!o.url) return false; if (seen.has(o.url)) return false; seen.add(o.url); return true; });
}
export async function findImageForPosting(maxAttempts = Number(process.env.MAX_REG_ATTEMPTS || '50')): Promise<FoundResult | null> {
  const attempts = Math.max(1, Math.min(200, maxAttempts || 12));
  const lockedFormat = pick(REG_FORMATS);
  console.log(`jetapi: locked onto ${lockedFormat.country} (${lockedFormat.prefixes.join('/')}) for this attempt cycle`);
  for (let i = 0; i < attempts; i++) {
    const gen = buildFromFormat(lockedFormat);
    console.log(`jetapi: trying generated reg (${i + 1}/${attempts}): ${gen}`);
    try {
      const json = await queryJetApiByRegistration(gen, 3, 8000);
      if (!json) { console.log(`jetapi: no json for ${gen}`); await new Promise(r => setTimeout(r, 200 + Math.floor(Math.random() * 300))); continue; }
      const imgs = tryExtractImagesFromJson(json);
      console.log(`jetapi: extracted ${imgs.length} image candidates for ${gen}`);
      if (imgs.length > 0) {
        const first = imgs[Math.floor(Math.random() * imgs.length)];
        const raw = first.raw || json;
        const aircraft = getField(raw, ['Aircraft', 'aircraft', 'AircraftType', 'Model', 'model']);
        const location = getField(raw, ['Location', 'location', 'locationName', 'LocationName', 'Airport']);
        const registrationFromData = getField(raw, ['Registration', 'Reg', 'registration', 'reg', 'tailNumber', 'tail_number']);
        const date = getField(raw, ['DateTaken', 'DateUploaded', 'date', 'Taken', 'uploadedDate']);
        const photographer = first.photographer || getField(raw, ['Photographer', 'photographer']);
        const link = first.link || getField(raw, ['Link', 'link', 'pageUrl', 'photoPageUrl']);
        const id = first.id || getField(raw, ['photoId', 'PhotoId', 'id', 'photo_id']);
        const derivedId = id || (link ? (link.match(/\/photo\/(\d+)/) || [])[1] : undefined);
        if (derivedId && wasPhotoPosted(derivedId)) {
          console.log(`jetapi: ${gen} matched photo ${derivedId}, but it's already been posted before — skipping.`);
          continue;
        }
        const airline = getField(raw, ['Airline', 'airline', 'Operator', 'operator']);
        const registration = isValidRegistration(registrationFromData) ? registrationFromData : null;
        return {
          reg: registration || '',
          imageUrl: first.url,
          info: {
            photographer: photographer || null,
            link: link || null,
            id: derivedId || null,
            raw: raw,
            aircraft: aircraft || null,
            airline: airline || null,
            location: location || null,
            registration: registration || null,
            date: date || null
          }
        };
      }
    } catch (e) {
      console.warn('jetapi: unexpected error during reg attempt', e && (e as any).message ? (e as any).message : e);
    }
    await new Promise((r) => setTimeout(r, 250 + Math.floor(Math.random() * 400)));
  }
  return null;
}