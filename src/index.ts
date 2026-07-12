import * as dotenv from 'dotenv';
dotenv.config();
import * as fs from 'fs';
import { postImage as postToBluesky } from './clients/at';
import { postImage as postToMastodon } from './clients/mastodon';
import { downloadImageToTemp, composeCaption, recordPostedPhoto, isMilitary, isPrivate } from './clients/roowus';
import { findImageForPosting, findImageForRegistration } from './clients/jetapi-registration-fetcher';
function sleep(ms: number) { return new Promise((res) => setTimeout(res, ms)); }
async function runOnce() {
  const dryRun = (process.env.POST_DRY_RUN || '').toLowerCase().trim();
  const isDryRun = dryRun === '1' || dryRun === 'true' || dryRun === 'yes';
  const forcedReg = (process.env.FORCE_REGISTRATION || '').trim();
  let regResult;
  if (forcedReg) {
    console.log(`FORCE_REGISTRATION set — skipping random search, looking up ${forcedReg} directly...`);
    regResult = await findImageForRegistration(forcedReg);
    if (!regResult) {
      throw new Error(`FORCE_REGISTRATION=${forcedReg} found nothing on JetAPI (wrong registration, no photo on file, or it was already posted before). Not retrying, since the same lookup would just fail again.`);
    }
  } else {
    console.log('trying registration-based lookup via JetAPI...');
    regResult = await findImageForPosting(Number(process.env.MAX_REG_ATTEMPTS || '12'));
    if (!regResult) {
      console.warn('registration-based lookup found nothing.');
      throw new Error('i got nothing, sorry');
    }
  }
  const chosenKeyword = regResult.info?.registration || regResult.reg || '';
  const chosenImage: any = {
    Image: regResult.imageUrl,
    Thumbnail: regResult.imageUrl,
    Photographer: regResult.info?.photographer || '',
    Link: regResult.info?.link || '',
    Registration: regResult.info?.registration || '',
    Airline: regResult.info?.airline || '',
    Aircraft: regResult.info?.aircraft || '',
    Location: regResult.info?.location || '',
    DateTaken: regResult.info?.date || '',
    photoId: regResult.info?.id || undefined,
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
  if (isMilitary(chosenImage) || isPrivate(chosenImage)) {
    if (forcedReg) {
      throw new Error(`FORCE_REGISTRATION=${forcedReg} matched a military or private aircraft, which the bot won't post. Pick a different registration.`);
    }
    console.warn('selected image appears military/private; skipping.');
    throw new Error('i got nothing, sorry');
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
    console.log('posting to Bluesky and Mastodon...');
    const postOptions = { path: tmpPath, text: captionObj.text, link: chosenImage.Link };
    const results = await Promise.allSettled([postToBluesky(postOptions), postToMastodon(postOptions)]);
    const blueskyResult = results[0];
    const mastodonResult = results[1];
    if (blueskyResult && blueskyResult.status === 'fulfilled') {
      try {
        if (chosenImage?.photoId) {
          recordPostedPhoto(chosenImage.photoId);
          console.log('recorded photo id:', chosenImage.photoId);
        } else {
          console.log('no explicit photo id returned; not recording.');
        }
      } catch (e) {
        console.warn('failed to record posted photo:', e);
      }
    } else {
      if (blueskyResult && blueskyResult.status === 'rejected') {
        console.error('Bluesky post failed:', (blueskyResult as PromiseRejectedResult).reason);
      } else {
        console.warn('Bluesky post did not return a result.');
      }
    }
    if (mastodonResult && mastodonResult.status === 'rejected') {
      console.error('Mastodon post failed:', (mastodonResult as PromiseRejectedResult).reason);
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
  let attempt = 0;
  while (true) {
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
      attempt++;
      console.warn(`no usable images (attempt ${attempt}), sleeping 10s and retrying...`);
      await sleep(10000);
      continue;
    }
  }
})();