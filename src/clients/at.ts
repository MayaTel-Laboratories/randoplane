import * as fs from 'fs';
import { BskyAgent } from '@atproto/api';

type PostOptions = {
  path: string;
  text: string;
  altText?: string;
};

const SERVICE = process.env.BSKY_SERVICE || 'https://bsky.social';
const IDENTIFIER = process.env.BSKY_IDENTIFIER || '';
const PASSWORD = process.env.BSKY_PASSWORD || '';

async function ensureAgent() {
  const agent = new BskyAgent({ service: SERVICE });
  if (process.env.BSKY_SESSION) {
    try {
      const sess = JSON.parse(process.env.BSKY_SESSION);
      if (sess?.handle && (sess?.accessJwt || sess?.refreshJwt)) {
        try { await (agent as any).resumeSession(sess); return agent; } catch {}
      }
    } catch {}
  }
  if (!IDENTIFIER || !PASSWORD) {
    throw new Error('Missing BSKY_IDENTIFIER or BSKY_PASSWORD environment variables for Bluesky posting.');
  }
  await agent.login({ identifier: IDENTIFIER, password: PASSWORD });
  return agent;
}

function guessContentType(filename: string) {
  const l = filename.toLowerCase();
  if (l.endsWith('.png')) return 'image/png';
  if (l.endsWith('.webp')) return 'image/webp';
  if (l.endsWith('.gif')) return 'image/gif';
  return 'image/jpeg';
}

function truncate(o: any, n = 2000) {
  try { return JSON.stringify(o, null, 2).slice(0, n); } catch { return String(o).slice(0, n); }
}

export async function postImage(opts: PostOptions) {
  const agent = await ensureAgent();
  const imageBuffer = fs.readFileSync(opts.path);
  const contentType = guessContentType(opts.path);
  const size = imageBuffer.byteLength;

  let uploadRes: any;
  try {
    uploadRes = await agent.uploadBlob(imageBuffer, { encoding: 'image/*', headers: { 'content-type': contentType } });
  } catch (e1) {
    try {
      uploadRes = await agent.uploadBlob(imageBuffer);
    } catch (e2) {
      console.error('Upload failed (both attempts):', e1, e2);
      throw e2;
    }
  }

  let blobObj: any = undefined;
  if (uploadRes?.data?.blob) blobObj = uploadRes.data.blob;
  else if (uploadRes?.blob) blobObj = uploadRes.blob;
  else {
    let cid: string | undefined = undefined;
    if (uploadRes?.data?.cid) cid = uploadRes.data.cid;
    else if (uploadRes?.cid) cid = uploadRes.cid;
    else if (uploadRes?.blob?.cid) cid = uploadRes.blob.cid;
    else if (uploadRes?.data?.blob?.cid) cid = uploadRes.data.blob.cid;
    if (cid) blobObj = { $type: 'blob', ref: { $link: cid }, mimeType: contentType, size };
  }

  if (!blobObj) {
    const findBlob = (o: any): any => {
      if (!o || typeof o !== 'object') return undefined;
      if (o.$type && o.ref && o.ref.$link) return o;
      if (o.ref && o.ref.$link) return o;
      for (const k of Object.keys(o)) {
        try {
          const v = findBlob(o[k]);
          if (v) return v;
        } catch {}
      }
      return undefined;
    };
    blobObj = findBlob(uploadRes);
  }

  if (!blobObj) {
    console.error('uploadRes (truncated):', truncate(uploadRes));
    throw new Error('Failed to resolve uploaded blob object (no blob found in upload response).');
  }

  if (typeof blobObj.ref === 'string') blobObj = { $type: 'blob', ref: { $link: blobObj.ref }, mimeType: contentType, size };

  const imageEmbed: any = {
    $type: 'app.bsky.embed.images',
    images: [
      {
        alt: opts.altText || '',
        image: blobObj,
      },
    ],
  };

  try {
    console.log('Bluesky uploadRes (truncated):', truncate(uploadRes));
    console.log('Bluesky post payload (truncated):', truncate({ text: opts.text, embed: imageEmbed }));
  } catch {}

  const now = new Date().toISOString();

  await agent.post({
    text: opts.text,
    createdAt: now,
    embed: imageEmbed,
  });
}