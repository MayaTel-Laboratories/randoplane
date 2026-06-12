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

export async function postImage(opts: PostOptions) {
  const agent = await ensureAgent();
  const imageBuffer = fs.readFileSync(opts.path);
  const contentType = guessContentType(opts.path);
  const size = imageBuffer.byteLength;

  const uploadRes: any = await agent.uploadBlob(imageBuffer, { encoding: 'image/*', headers: { 'content-type': contentType } }).catch(async (e) => {
    try { return await agent.uploadBlob(imageBuffer); } catch (err) { throw err; }
  });

  let cid: string | undefined = undefined;
  if (!cid) cid = uploadRes?.cid;
  if (!cid) cid = uploadRes?.data?.cid;
  if (!cid) cid = uploadRes?.blob?.ref;
  if (!cid) cid = uploadRes?.data?.blob?.ref;
  if (!cid) cid = uploadRes?.blob?.cid;
  if (!cid) cid = uploadRes?.data?.blob?.cid;
  if (!cid) {
    const maybe = uploadRes;
    if (maybe && typeof maybe === 'object') {
      const findCid = (o: any): string | undefined => {
        if (!o || typeof o !== 'object') return undefined;
        if (typeof o === 'string' && /^[a-z0-9]{10,}/i.test(o)) return o;
        if (typeof o.cid === 'string') return o.cid;
        if (typeof o.ref === 'string') return o.ref;
        for (const k of Object.keys(o)) {
          try {
            const v = findCid(o[k]);
            if (v) return v;
          } catch {}
        }
        return undefined;
      };
      cid = findCid(maybe);
    }
  }

  if (!cid) {
    console.error('uploadRes (truncated) for debugging:', JSON.stringify(uploadRes, null, 2).slice(0, 2000));
    throw new Error('Failed to upload image to Bluesky (no CID returned).');
  }

  const imageEmbed: any = {
    $type: 'app.bsky.embed.images',
    images: [
      {
        alt: opts.altText || '',
        // The AT Protocol expects a blob value here. Use the $link shorthand referencing the CID.
        image: { $link: cid },
      },
    ],
  };

  const now = new Date().toISOString();

  await agent.post({
    text: opts.text,
    createdAt: now,
    embed: imageEmbed,
  });
}

function guessContentType(filename: string) {
  const l = filename.toLowerCase();
  if (l.endsWith('.png')) return 'image/png';
  if (l.endsWith('.webp')) return 'image/webp';
  if (l.endsWith('.gif')) return 'image/gif';
  return 'image/jpeg';
}