import * as fs from 'fs';
import { BskyAgent, AppBskyEmbedImages } from '@atproto/api';

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
        // restore session if available
        // @ts-ignore - restoreSession may exist on agent
        await (agent as any).resumeSession(sess);
        return agent;
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

  const uploadRes = await agent.uploadBlob(imageBuffer, { encoding: 'image/*', headers: { 'content-type': contentType } }).catch(async (e) => {
    // try without extra headers if API rejects the header shape
    return agent.uploadBlob(imageBuffer);
  });

  const cid = (uploadRes as any)?.blob?.ref || (uploadRes as any)?.data?.cid || (uploadRes as any)?.cid || (uploadRes as any)?.blob?.cid;
  if (!cid) {
    // some versions return the blob cid differently
    const maybe = (uploadRes as any);
    if (maybe && typeof maybe === 'object') {
      const keys = Object.keys(maybe);
      const v = keys.map(k => (maybe as any)[k]).find((x: any) => x && x.cid);
      if (v) {
        // @ts-ignore
        cid = v.cid;
      }
    }
  }
  if (!cid) {
    throw new Error('Failed to upload image to Bluesky (no CID returned).');
  }

  const imageEmbed: AppBskyEmbedImages.Record = {
    $type: 'app.bsky.embed.images',
    images: [
      {
        alt: opts.altText || '',
        image: { cid },
      } as any,
    ],
  } as any;

  const now = new Date().toISOString();

  // Create the post
  await agent.post({
    text: opts.text,
    createdAt: now,
    embed: imageEmbed as any,
  });
}

function guessContentType(filename: string) {
  const l = filename.toLowerCase();
  if (l.endsWith('.png')) return 'image/png';
  if (l.endsWith('.webp')) return 'image/webp';
  if (l.endsWith('.gif')) return 'image/gif';
  return 'image/jpeg';
}