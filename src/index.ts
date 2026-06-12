import * as dotenv from 'dotenv';
dotenv.config();
if (process.env.JETAPI_BASE && !process.env.ROOWUS_BASE) process.env.ROOWUS_BASE = process.env.JETAPI_BASE;
import { postImage as postToBluesky } from './clients/at';
import { postImage as postToMastodon } from './clients/mastodon';
import { fetchForReg, fetchForKeyword, chooseUsableImage, downloadImageToTemp, composeCaption } from './clients/roowus';
import * as fs from 'fs';

const DEFAULT_PHOTOS = 5;
const DEFAULT_MANUFACTURERS = ['Boeing', 'Airbus', 'Bombardier', 'Embraer', 'Lockheed', 'McDonnell Douglas'];

function envBool(name: string, fallback = false): boolean {
  const v = (process.env[name] || '').toLowerCase().trim();
  if (!v) return fallback;
  return v === '1' || v === 'true' || v === 'yes';
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function safeTrim(s?: string | null) {
  return (s || '').toString().trim();
}

function buildAltTextFromImage(regOrKeyword: string, img: any) {
  if (!img) return `Photo of aircraft (${regOrKeyword}).`;
  const aircraft = safeTrim(img.Aircraft);
  const airline = safeTrim(img.Airline);
  const photographer = safeTrim(img.Photographer);
  const when = safeTrim(img.DateTaken);
  const parts: string[] = [];
  if (aircraft) parts.push(aircraft);
  parts.push(regOrKeyword);
  if (airline) parts.push(`(${airline})`);
  const main = parts.join(' ');
  const by = photographer ? `Photo: ${photographer}` : '';
  const whenPart = when ? when : '';
  const alt = [main, whenPart, by].filter(Boolean).join(' · ');
  return alt.length > 2000 ? alt.slice(0, 1997) + '…' : alt;
}

async function runOnce() {
  const dryRun = envBool('POST_DRY_RUN', false);
  const preferThumb = envBool('JETAPI_USE_THUMBNAIL', true);
  const photosBase = Number(process.env.JETAPI_PHOTOS || DEFAULT_PHOTOS) || DEFAULT_PHOTOS;
  const maxAttempts = Number(process.env.ROOWUS_ATTEMPTS || 5);
  const allowMissingMeta = envBool('ALLOW_MISSING_PHOTO_METADATA', false);
  const failOnNoImage = envBool('FAIL_ON_NO_IMAGE', false);
  const overrideSingle = (process.env.MANUFACTURER || '').trim();
  const envList = (process.env.MANUFACTURERS || '').trim();
  const manufacturers = overrideSingle
    ? [overrideSingle]
    : envList
    ? envList.split(',').map((s) => s.trim()).filter(Boolean)
    : DEFAULT_MANUFACTURERS;
  const pool = manufacturers.slice();
  if (pool.length === 0) {
    if (failOnNoImage) throw new Error('No manufacturers available');
    return;
  }
  let chosenImage: any = null;
  let chosenKeyword = '';
  let lastRaw: any = null;
  for (let attempt = 0; attempt < Math.min(maxAttempts, pool.length); attempt++) {
    const idx = Math.floor(Math.random() * pool.length);
    const keyword = pool.splice(idx, 1)[0];
    const photos = photosBase * (1 + attempt);
    try {
      const jp = await fetchForKeyword(keyword, photos);
      lastRaw = jp?.raw;
      const available = Array.isArray(jp?.Images) ? jp.Images.length : 0;
      const usable = chooseUsableImage(jp);
      if (usable) {
        chosenImage = usable;
        chosenKeyword = keyword;
        break;
      }
    } catch (e) {
      continue;
    }
  }
  if (!chosenImage) {
    for (const keyword of manufacturers) {
      try {
        const jp = await fetchForKeyword(keyword, photosBase * 2);
        lastRaw = jp?.raw;
        const candidate = (jp?.Images || []).find((i: any) => i && i.Image && i.Link);
        if (candidate) {
          chosenImage = candidate;
          chosenKeyword = keyword;
          break;
        }
      } catch (e) {
        continue;
      }
    }
  }
  if (!chosenImage) {
    if (lastRaw) {
      try {
        console.error('Sample Roowus raw response (truncated):', JSON.stringify(lastRaw).slice(0, 2000));
      } catch {}
    }
    const msg = 'No usable Roowus images found. Increase JETAPI_PHOTOS, add more MANUFACTURERS, or run locally.';
    if (failOnNoImage) throw new Error(msg);
    console.warn(msg);
    return;
  }
  if ((!chosenImage.Photographer || !chosenImage.Link) && !allowMissingMeta) {
    const missing = [
      !chosenImage.Photographer ? 'Photographer' : null,
      !chosenImage.Link ? 'Link' : null,
    ].filter(Boolean).join(', ');
    const s = `Selected image for "${chosenKeyword}" is missing metadata: ${missing}`;
    if (dryRun) {
      console.log('POST_DRY_RUN=true — selected image missing metadata:', s);
      return;
    }
    if (failOnNoImage) {
      throw new Error(`Refusing to post: ${s}`);
    }
    console.warn(s + ' — not posting (set ALLOW_MISSING_PHOTO_METADATA=true to override).');
    return;
  }
  const downloadUrl = preferThumb ? (chosenImage.Thumbnail || chosenImage.Image) : (chosenImage.Image || chosenImage.Thumbnail);
  if (!downloadUrl) {
    throw new Error('Selected image has no downloadable URL.');
  }
  const tmpPath = await downloadImageToTemp(downloadUrl, chosenKeyword);
  const captionObj = composeCaption(chosenKeyword, chosenImage);
  const altText = buildAltTextFromImage(chosenKeyword, chosenImage);
  if (dryRun) {
    console.log('POST_DRY_RUN=true — skipping actual posts. Payload:');
    console.log('caption:', captionObj.text);
    console.log('altText:', altText);
    console.log('file:', tmpPath);
    try {
      await fs.promises.unlink(tmpPath);
    } catch (e) {}
    return;
  }
  try {
    const postOptions = { path: tmpPath, text: captionObj.text, altText };
    const results = await Promise.allSettled([postToBluesky(postOptions), postToMastodon(postOptions)]);
    const failures = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    if (failures.length > 0) {
      failures.forEach((f) => console.error('failed:', (f as any).reason));
      if (failures.length === results.length) {
        throw new Error('All platforms failed.');
      }
    }
  } finally {
    try {
      await fs.promises.unlink(tmpPath);
    } catch (e) {}
  }
}

runOnce()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
  });