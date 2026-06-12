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
      if (sess?.handle && sess?.refreshJwt && sess?.accessJwt) {
        // resumeSession exists on some agent builds; use any to avoid type errors
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

  // Upload blob (use any because versions differ)
  const uploadRes: any = await agent.uploadBlob(imageBuffer, { encoding: 'image/*', headers: { 'content-type': contentType } }).catch(async (e) => {
    // fallback to a call without extra headers if the first form is rejected
    try { return await agent.uploadBlob(imageBuffer); } catch (err) { throw err; }
  });

  // Resolve CID from a few common shapes
  let cid: string | undefined = undefined;
  if (!cid) cid = uploadRes?.cid;
  if (!cid) cid = uploadRes?.data?.cid;
  if (!cid) cid = uploadRes?.blob?.ref;
  if (!cid) cid = uploadRes?.data?.blob?.ref;
  if (!cid) cid = uploadRes?.blob?.cid;
  if (!cid) cid = uploadRes?.data?.blob?.cid;
  if (!cid) {
    // last resort: scan nested objects
    const maybe = uploadRes;
    if (maybe && typeof maybe === 'object') {
      const found = (function findCid(o: any): string | undefined {
        if (!o || typeof o !== 'object') return undefined;
        if (typeof o.cid === 'string') return o.cid;
        if (typeof o.ref === 'string') return o.ref;
        for (const k of Object.keys(o)) {
          try {
            const v = findCid(o[k]);
            if (v) return v;
          } catch {}
        }
        return undefined;
      })(maybe);
      cid = found;
    }
  }

  if (!cid) {
    throw new Error('Failed to upload image to Bluesky (no CID returned).');
  }

  // Build image embed object (use any to avoid type mismatches)
  const imageEmbed: any = {
    $type: 'app.bsky.embed.images',
    images: [
      {
        alt: opts.altText || '',
        image: { cid },
      },
    ],
  };

  const now = new Date().toISOString();

  // Post the status with image embed, sending text exactly as provided
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