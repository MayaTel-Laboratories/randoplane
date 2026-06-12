import * as fs from 'fs';
import * as path from 'path';

export type JetPhotosImage = {
  Image: string;
  Link: string;
  Thumbnail?: string;
  DateTaken?: string;
  DateUploaded?: string;
  Location?: string;
  Photographer?: string;
  Aircraft?: string;
  Serial?: string;
  Airline?: string;
};

export type JetPhotosResult = {
  Reg: string;
  Images: JetPhotosImage[];
};

async function fetchJson(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} failed: ${res.status}`);
  return await res.json();
}

export async function fetchJetPhotos(reg: string, photos = 3, base = process.env.JETAPI_BASE || 'http://127.0.0.1:4000'): Promise<JetPhotosResult | undefined> {
  const q = `reg=${encodeURIComponent(reg)}&photos=${encodeURIComponent(String(photos))}`;
  const url = `${base.replace(/\/$/, '')}/api?${q}`;
  const json = await fetchJson(url);
  return json?.JetPhotos as JetPhotosResult | undefined;
}

export function chooseBestImage(jp?: JetPhotosResult) : JetPhotosImage | null {
  if (!jp || !Array.isArray(jp.Images) || jp.Images.length === 0) return null;
  const withPhotog = jp.Images.find(i => i.Photographer && i.Link);
  if (withPhotog) return withPhotog;
  return jp.Images[0];
}

export async function downloadImageToTemp(url: string, reg: string, idx = 0) {
  if (!url) throw new Error('empty image URL');
  if (url.startsWith('//')) url = 'https:' + url;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed ${res.status}`);
  const arrayBuffer = await res.arrayBuffer();
  const buf = Buffer.from(arrayBuffer);
  const ext = path.extname(url.split('?')[0]) || '.jpg';
  const tmp = path.join('/tmp', `jetapi_${reg.replace(/[^A-Za-z0-9]/g, '')}_${Date.now()}_${idx}${ext}`);
  await fs.promises.writeFile(tmp, buf);
  return tmp;
}

export function composeCaption(reg: string, img: JetPhotosImage | null) {
  if (!img) {
    return { text: reg, attribution: '' };
  }
  const airline = img.Airline || '';
  const aircraft = img.Aircraft || '';
  const whenWhere = [img.DateTaken, img.Location].filter(Boolean).join(' · ');
  const headlineParts = [];
  if (airline) headlineParts.push(airline);
  if (aircraft) headlineParts.push(aircraft);
  headlineParts.push(reg);
  const headline = headlineParts.join(' · ');
  const attribution = `Photo: ${img.Photographer || 'unknown'} — ${img.Link || ''}`.trim();
  const body = whenWhere ? `${whenWhere}\n\n${attribution}` : attribution;
  return { text: `${headline}\n${body}`, attribution };
}