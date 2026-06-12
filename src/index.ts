import * as dotenv from 'dotenv';
dotenv.config();
if (process.env.JETAPI_BASE && !process.env.ROOWUS_BASE) process.env.ROOWUS_BASE = process.env.JETAPI_BASE;
import { postImage as postToBluesky } from './clients/at';
import { postImage as postToMastodon } from './clients/mastodon';
import { fetchForReg, fetchForKeyword, chooseUsableImage } from './clients/roowus';
import { downloadImageToTemp, composeCaption } from './clients/jetapi';
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
  const photos = Number(process.env.JETAPI_PHOTOS || DEFAULT_PHOTOS) || DEFAULT_PHOTOS;
  const overrideSingle = (process.env.MANUFACTURER || '').trim();
  const envList = (process.env.MANUFACTURERS || '').trim();
  const manufacturers = overrideSingle
    ? [overrideSingle]
    : envList
    ? envList.split(',').map((s) => s.trim()).filter(Boolean)
    : DEFAULT_MANUFACTURERS;
  const keyword = pickRandom(manufacturers);
  console.log('Selected manufacturer keyword:', keyword);
  const base = process.env.ROOWUS_BASE || process.env.JETAPI_BASE || 'https://jp.rewis.workers.dev';
  console.log(`Querying Roowus API at ${base} for keyword="${keyword}" photos=${photos}`);
  const jp = await fetchForKeyword(keyword, photos);
  const chosenImage = chooseUsableImage(jp);
  if (!chosenImage) {
    throw new Error(`Roowus API returned no usable images for keyword "${keyword}"`);
  }
  if (!chosenImage.Photographer || !chosenImage.Link) {
    throw new Error('Refusing to post image without Photographer and Link metadata.');
  }
  const downloadUrl = preferThumb ? (chosenImage.Thumbnail || chosenImage.Image) : (chosenImage.Image || chosenImage.Thumbnail);
  if (!downloadUrl) {
    throw new Error('Selected image has no downloadable URL.');
  }
  console.log('Selected image URL:', downloadUrl);
  const tmpPath = await downloadImageToTemp(downloadUrl, keyword);
  console.log('Downloaded image to', tmpPath);
  const captionObj = composeCaption(keyword, chosenImage);
  const altText = buildAltTextFromImage(keyword, chosenImage);
  if (dryRun) {
    console.log('POST_DRY_RUN=true — skipping actual posts. Payload:');
    console.log('caption:', captionObj.text);
    console.log('altText:', altText);
    console.log('file:', tmpPath);
    try {
      await fs.promises.unlink(tmpPath);
      console.log('Removed temp file', tmpPath);
    } catch (e) {
      console.warn('Failed to remove temp file', tmpPath, e);
    }
    return;
  }
  try {
    const postOptions = { path: tmpPath, text: captionObj.text, altText };
    console.log('Posting to platforms...');
    const results = await Promise.allSettled([postToBluesky(postOptions), postToMastodon(postOptions)]);
    const failures = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    if (failures.length > 0) {
      failures.forEach((f) => console.error('failed:', f.reason));
      if (failures.length === results.length) {
        throw new Error('All platforms failed.');
      }
    }
    console.log('Post completed (at least one platform succeeded).');
  } finally {
    try {
      await fs.promises.unlink(tmpPath);
      console.log('Removed temp file', tmpPath);
    } catch (e) {
      console.warn('Failed to remove temp file', tmpPath, e);
    }
  }
}

runOnce()
  .then(() => {
    console.log('Done.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
  });