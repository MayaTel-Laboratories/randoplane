import { queryJetApiByRegistration } from './jetapi-client';
type FoundResult = {
  reg: string;
  imageUrl: string;
  info: {
    photographer?: string | null;
    link?: string | null;
    id?: string | null;
    raw?: any;
    aircraft?: string | null;
    location?: string | null;
    registration?: string | null;
    date?: string | null;
  };
};
function randInt(min: number, max: number) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function pick<T>(arr: T[]) { return arr[Math.floor(Math.random() * arr.length)]; }
function genUS(): string { const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'; const len = randInt(1, 5); let s = 'N'; for (let i = 0; i < len; i++) s += chars.charAt(Math.floor(Math.random() * chars.length)); return s; }
function genUK(): string { const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'; let s = 'G-'; for (let i = 0; i < 4; i++) s += chars.charAt(Math.floor(Math.random() * chars.length)); return s; }
function genCA(): string { const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'; const prefix = Math.random() < 0.5 ? 'C-F' : 'C-G'; let s = prefix; for (let i = 0; i < 3; i++) s += letters.charAt(Math.floor(Math.random() * letters.length)); return s; }
function genAU(): string { const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'; let s = 'VH-'; for (let i = 0; i < 3; i++) s += letters.charAt(Math.floor(Math.random() * letters.length)); return s; }
function genDE(): string { const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'; let len = randInt(3, 4); let s = 'D-'; for (let i = 0; i < len; i++) s += letters.charAt(Math.floor(Math.random() * letters.length)); return s; }
function genFR(): string { const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'; let s = 'F-'; for (let i = 0; i < 4; i++) s += letters.charAt(Math.floor(Math.random() * letters.length)); return s; }
function genIT(): string { const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'; let s = 'I-'; for (let i = 0; i < randInt(3,4); i++) s += letters.charAt(Math.floor(Math.random() * letters.length)); return s; }
function genAT(): string { const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'; let s = 'OE-'; for (let i = 0; i < 3; i++) s += letters.charAt(Math.floor(Math.random() * letters.length)); return s; }
function genBR(): string { const prefixes = ['PR-', 'PP-', 'PT-', 'PU-']; const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'; const prefix = pick(prefixes); let s = prefix; for (let i = 0; i < 3; i++) s += letters.charAt(Math.floor(Math.random() * letters.length)); return s; }
function genJP(): string { const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'; let s = 'JA'; for (let i = 0; i < randInt(3,4); i++) s += chars.charAt(Math.floor(Math.random() * chars.length)); return s; }
function genNL(): string { const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'; let s = 'PH-'; for (let i = 0; i < 3; i++) s += letters.charAt(Math.floor(Math.random() * letters.length)); return s; }
const generators: Array<() => string> = [ genUS, genUS, genUS, genUS, genUK, genUK, genDE, genFR, genCA, genAU, genIT, genAT, genBR, genJP, genNL ];
function genRegistrationForAttempt(): string { return pick(generators)(); }
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
    /^[A-Z]{1,2}[A-Z0-9]{3,4}$/i
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
export async function findImageForPosting(maxAttempts = Number(process.env.MAX_REG_ATTEMPTS || '12')): Promise<FoundResult | null> {
  const attempts = Math.max(1, Math.min(200, maxAttempts || 12));
  for (let i = 0; i < attempts; i++) {
    const gen = genRegistrationForAttempt();
    console.log(`jetapi: trying generated reg (${i + 1}/${attempts}): ${gen}`);
    try {
      const json = await queryJetApiByRegistration(gen, 3, 8000);
      if (!json) { console.log(`jetapi: no json for ${gen}`); await new Promise(r => setTimeout(r, 200 + Math.floor(Math.random() * 300))); continue; }
      const imgs = tryExtractImagesFromJson(json);
      console.log(`jetapi: extracted ${imgs.length} image candidates for ${gen}`);
      if (imgs.length > 0) {
        const first = imgs[0];
        const raw = first.raw || json;
        const aircraft = getField(raw, ['Aircraft', 'aircraft', 'AircraftType', 'Model', 'model']);
        const location = getField(raw, ['Location', 'location', 'locationName', 'LocationName', 'Airport']);
        const registrationFromData = getField(raw, ['Registration', 'Reg', 'registration', 'reg', 'tailNumber', 'tail_number']);
        const date = getField(raw, ['DateTaken', 'DateUploaded', 'date', 'Taken', 'uploadedDate']);
        const photographer = first.photographer || getField(raw, ['Photographer', 'photographer']);
        const link = first.link || getField(raw, ['Link', 'link', 'pageUrl', 'photoPageUrl']);
        const id = first.id || getField(raw, ['photoId', 'PhotoId', 'id', 'photo_id']);
        const registration = isValidRegistration(registrationFromData) ? registrationFromData : null;
        return {
          reg: registration || '',
          imageUrl: first.url,
          info: {
            photographer: photographer || null,
            link: link || null,
            id: id || null,
            raw: raw,
            aircraft: aircraft || null,
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