import * as dotenv from 'dotenv';
dotenv.config();
import * as fs from 'fs';
import { postImage as postToBluesky } from './clients/at';
import { postImage as postToMastodon } from './clients/mastodon';
import { fetchForKeyword, chooseUsableImage, downloadImageToTemp, composeCaption } from './clients/roowus';

const DEFAULT_PHOTOS = 5;
const DEFAULT_MANUFACTURERS = ['Boeing', 'Airbus', 'Bombardier', 'Embraer', 'Lockheed', 'McDonnell Douglas'];

function envBool(name: string, fallback = false): boolean {
  const v = (process.env[name] || '').toLowerCase().trim();
  if (!v) return fallback;
  return v === '1' || v === 'true' || v === 'yes';
}

function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
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

async function tryUpgradeThumbnailToFull(thumbUrl: string) {
  if (!thumbUrl) return undefined;
  try {
    const candidate = thumbUrl.replace(/\/\d+\//, '/full/');
    if (!candidate || candidate === thumbUrl) return undefined;
    const resp = await fetch(candidate, { method: 'HEAD' });
    if (resp.ok) return candidate;
  } catch (e) {}
  return undefined;
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
    console.warn('No manufacturers available, exiting runOnce.');
    return;
  }

  let chosenImage: any = null;
  let chosenKeyword = '';
  let lastRaw: any = null;

  for (let attempt = 0; attempt < Math.min(maxAttempts, pool.length); attempt++) {
    const idx = Math.floor(Math.random() * pool.length);
    const keyword = pool.splice(idx, 1)[0];
    const photos = photosBase * (1 + attempt);
    console.log(`Attempt ${attempt + 1}/${maxAttempts}: querying Roowus for "${keyword}" (photos=${photos})`);
    let jp;
    try {
      jp = await fetchForKeyword(keyword, photos);
      lastRaw = jp?.raw;
    } catch (e) {
      console.warn(`Fetch for "${keyword}" failed:`, (e && (e as any).message) ? (e as any).message : e);
      continue;
    }
    const available = Array.isArray(jp?.Images) ? jp.Images.length : 0;
    console.log(`Roowus returned ${available} images for "${keyword}"`);
    try {
      console.log('Normalized sample:', JSON.stringify((jp?.Images || []).slice(0, 2), null, 2));
    } catch {}
    const usable = chooseUsableImage(jp);
    if (usable) {
      chosenImage = usable;
      chosenKeyword = keyword;
      break;
    }
  }

  if (!chosenImage) {
    console.log('No image matched strict filter; trying relaxed fallback (Image+Link or Thumbnail+Link).');
    for (const keyword of manufacturers) {
      try {
        const jp = await fetchForKeyword(keyword, photosBase * 2);
        lastRaw = jp?.raw;
        const candidate = (jp?.Images || []).find((i: any) => i && ( (i.Image && i.Image.trim()) || (i.Thumbnail && i.Thumbnail.trim()) ) && i.Link);
        if (candidate) {
          chosenImage = candidate;
          chosenKeyword = keyword;
          console.log(`Found relaxed candidate for "${keyword}".`);
          break;
        }
      } catch (e) {
        /* ignore */
      }
    }
  }

  if (!chosenImage) {
    console.error(`Roowus API returned no usable images after ${maxAttempts} attempts.`);
    if (lastRaw) {
      try { console.error('Sample Roowus raw response (truncated):', JSON.stringify(lastRaw).slice(0, 2000)); } catch {}
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

  const preferFull = !preferThumb;
  let downloadUrl: string | undefined = undefined;

  if (preferFull) {
    if (chosenImage.Image && String(chosenImage.Image).trim().length > 0) {
      downloadUrl = chosenImage.Image;
    } else if (chosenImage.Thumbnail && String(chosenImage.Thumbnail).trim().length > 0) {
      const upgraded = await tryUpgradeThumbnailToFull(chosenImage.Thumbnail);
      downloadUrl = upgraded || chosenImage.Thumbnail;
    }
  } else {
    downloadUrl = chosenImage.Thumbnail || chosenImage.Image;
  }

  if (!downloadUrl) {
    throw new Error('Selected image has no downloadable URL.');
  }

  console.log('Selected image URL:', downloadUrl);
  const tmpPath = await downloadImageToTemp(downloadUrl, chosenKeyword);
  console.log('Downloaded image to', tmpPath);
  const captionObj = composeCaption(chosenKeyword, chosenImage);
  const altText = buildAltTextFromImage(chosenKeyword, chosenImage);

  if (dryRun) {
    console.log('POST_DRY_RUN=true — skipping actual posts. Payload:');
    console.log('caption:', captionObj.text);
    console.log('altText:', altText);
    console.log('file:', tmpPath);
    try { await fs.promises.unlink(tmpPath); console.log('Removed temp file', tmpPath); } catch (e) { console.warn('Failed to remove temp file', tmpPath, e); }
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
    console.log('Post completed (at least one platform succeeded).');
  } finally {
    try { await fs.promises.unlink(tmpPath); console.log('Removed temp file', tmpPath); } catch (e) { console.warn('Failed to remove temp file', tmpPath, e); }
  }
}

(async () => {
  const maxEmptyRetries = Number(process.env.ROOWUS_EMPTY_RETRY_COUNT || 6);
  const sleepSeconds = Number(process.env.ROOWUS_EMPTY_RETRY_SLEEP || 10);
  for (let attempt = 0; attempt <= maxEmptyRetries; attempt++) {
    try {
      await runOnce();
      process.exit(0);
    } catch (err: any) {
      const msg = (err && err.message) ? err.message : String(err);
      const noImages = msg.includes('No usable Roowus images found') || msg.includes('No manufacturers available');
      if (!noImages) {
        console.error('Fatal:', err);
        process.exit(1);
      }
      if (attempt < maxEmptyRetries) {
        console.warn(`No usable images (attempt ${attempt + 1}/${maxEmptyRetries + 1}), sleeping ${sleepSeconds}s and retrying...`);
        await sleep(sleepSeconds * 1000);
        continue;
      } else {
        console.error('Exhausted empty-result retries, exiting.');
        process.exit(0);
      }
    }
  }
})();