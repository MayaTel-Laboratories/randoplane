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

  let blobRefObj: any = undefined;
  if (uploadRes?.data?.blob?.ref) blobRefObj = uploadRes.data.blob.ref;
  else if (uploadRes?.blob?.ref) blobRefObj = uploadRes.blob.ref;
  else if (uploadRes?.data?.cid) blobRefObj = { $link: uploadRes.data.cid };
  else if (uploadRes?.cid) blobRefObj = { $link: uploadRes.cid };
  else if (uploadRes?.blob?.cid) blobRefObj = { $link: uploadRes.blob.cid };
  else if (uploadRes?.data?.blob?.cid) blobRefObj = { $link: uploadRes.data.blob.cid };

  if (typeof blobRefObj === 'string') blobRefObj = { $link: blobRefObj };

  if (!blobRefObj) {
    const findRef = (o: any): any => {
      if (!o || typeof o !== 'object') return undefined;
      if (o.$link && typeof o.$link === 'string') return { $link: o.$link };
      if (o.ref && typeof o.ref === 'object' && o.ref.$link) return o.ref;
      for (const k of Object.keys(o)) {
        try {
          const v = findRef(o[k]);
          if (v) return v;
        } catch {}
      }
      return undefined;
    };
    blobRefObj = findRef(uploadRes);
  }

  if (!blobRefObj) {
    console.error('uploadRes (truncated) for debugging:', truncate(uploadRes));
    throw new Error('Failed to resolve blob reference (no CID or ref found in upload response).');
  }

  const imageEmbed: any = {
    $type: 'app.bsky.embed.images',
    images: [
      {
        alt: opts.altText || '',
        image: blobRefObj,
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