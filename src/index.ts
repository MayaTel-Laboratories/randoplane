import * as dotenv from 'dotenv';
dotenv.config();
import * as fs from 'fs';
import { postImage as postToBluesky } from './clients/at';
import { postImage as postToMastodon } from './clients/mastodon';
import { downloadImageToTemp, composeCaption, recordPostedPhoto, isMilitary, isPrivate } from './clients/roowus';
import { findImageForPosting } from './clients/jetapi-registration-fetcher';

function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

async function runOnce() {
  const dryRun = (process.env.POST_DRY_RUN || '').toLowerCase().trim();
  const isDryRun = dryRun === '1' || dryRun === 'true' || dryRun === 'yes';

  console.log('trying registration-based lookup via JetAPI...');
  const regResult = await findImageForPosting(Number(process.env.MAX_REG_ATTEMPTS || '12'));
  if (!regResult) {
    console.warn('registration-based lookup found nothing.');
    throw new Error('i got nothing, sorry');
  }

  const chosenKeyword = regResult.reg;
  const chosenImage = {
    Image: regResult.imageUrl,
    Thumbnail: regResult.imageUrl,
    Photographer: regResult.info?.photographer || '',
    Link: regResult.info?.link || '',
    Registration: regResult.reg,
    photoId: regResult.info?.id || regResult.reg,
    _jetapi_raw: regResult.info?.raw,
  };
  const lastRaw = regResult.info?.raw;

  if (!chosenImage) {
    if (lastRaw) {
      try { console.error('sample raw response (truncated):', JSON.stringify(lastRaw).slice(0, 2000)); } catch {}
    }
    const msg = 'i got nothing, sorry';
    console.warn(msg);
    throw new Error(msg);
  }

  if (!chosenImage.Photographer || !chosenImage.Link) {
    const missing = [
      !chosenImage.Photographer ? 'Photographer' : null,
      !chosenImage.Link ? 'Link' : null,
    ].filter(Boolean).join(', ');
    console.warn(`selected image for "${chosenKeyword}" is missing metadata: ${missing} — not posting.`);
    return;
  }

  let downloadUrl: string | undefined = undefined;
  if (chosenImage.Image && String(chosenImage.Image).trim().length > 0) {
    downloadUrl = chosenImage.Image;
  } else if (chosenImage.Thumbnail && String(chosenImage.Thumbnail).trim().length > 0) {
    try {
      const candidate = chosenImage.Thumbnail.replace(/\/\d+\//, '/full/');
      if (candidate && candidate !== chosenImage.Thumbnail) {
        const resp = await fetch(candidate, { method: 'HEAD' });
        if (resp.ok) downloadUrl = candidate;
      }
    } catch (e) {}
    if (!downloadUrl) downloadUrl = chosenImage.Thumbnail;
  }

  if (!downloadUrl) throw new Error('no downloadable URL, somehow?');

  console.log('your image is:', downloadUrl);
  const tmpPath = await downloadImageToTemp(downloadUrl, chosenKeyword);
  console.log('your image is stored at:', tmpPath);
  const captionObj = composeCaption(chosenKeyword, chosenImage);

  if (isDryRun) {
    console.log('dry run. payload:');
    console.log('caption:', captionObj.text);
    console.log('file:', tmpPath);
    try { await fs.promises.unlink(tmpPath); } catch (e) {}
    return;
  }

  try {
    const postOptions = { path: tmpPath, text: captionObj.text, link: chosenImage.Link };
    const results = await Promise.allSettled([postToBluesky(postOptions), postToMastodon(postOptions)]);

    const blueskyResult = results[0];
    if (blueskyResult && blueskyResult.status === 'fulfilled') {
      try {
        if (chosenImage?.photoId) {
          recordPostedPhoto(chosenImage.photoId);
          console.log('recorded photo id:', chosenImage.photoId);
        } else {
          console.log('no photo id on chosen image; skipping writing it down...');
        }
      } catch (e) {
        console.warn('failed to record posted photo:', e);
      }
    }

    const failures = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    if (failures.length > 0) {
      failures.forEach((f) => console.error('failed:', (f as any).reason));
      if (failures.length === results.length) throw new Error('all platforms failed!');
    }
    console.log('posted!');
  } finally {
    try { await fs.promises.unlink(tmpPath); console.log('removed temp file', tmpPath); } catch (e) {}
  }
}

(async () => {
  for (let attempt = 0; attempt <= 3; attempt++) {
    try {
      await runOnce();
      process.exit(0);
    } catch (err: any) {
      const msg = (err && err.message) ? err.message : String(err);
      const noImages = msg.includes('i got nothing, sorry');
      if (!noImages) {
        console.error('fatal:', err);
        process.exit(1);
      }
      if (attempt < 3) {
        console.warn(`no usable images (attempt ${attempt + 1}/4), sleeping 10s and retrying...`);
        await sleep(10000);
        continue;
      } else {
        console.error('no more retries. run the workflow again?');
        process.exit(0);
      }
    }
  }
})();