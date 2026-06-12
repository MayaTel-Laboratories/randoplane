import * as fs from 'fs';
import { BskyAgent } from '@atproto/api';
import sizeOf from 'buffer-image-size';

type PostOptions = {
  path: string;
  text: string;
  altText?: string;
  link?: string;
};

const SERVICE    = process.env.BSKY_SERVICE    || 'https://bsky.social';
const IDENTIFIER = process.env.BSKY_IDENTIFIER || '';
const PASSWORD   = process.env.BSKY_PASSWORD   || '';

async function ensureAgent(): Promise<BskyAgent> {
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
    throw new Error('Missing BSKY_IDENTIFIER or BSKY_PASSWORD environment variables.');
  }
  await agent.login({ identifier: IDENTIFIER, password: PASSWORD });
  return agent;
}

function guessContentType(filename: string): string {
  const l = filename.toLowerCase();
  if (l.endsWith('.png'))  return 'image/png';
  if (l.endsWith('.webp')) return 'image/webp';
  if (l.endsWith('.gif'))  return 'image/gif';
  return 'image/jpeg';
}

function truncatePostText(text: string, link?: string): string {
  const LIMIT = 295;
  if (Buffer.byteLength(text, 'utf8') <= LIMIT) return text;

  if (link && text.includes(link)) {
    const withoutLink = text.slice(0, text.lastIndexOf(link)).trimEnd();
    if (Buffer.byteLength(withoutLink, 'utf8') <= LIMIT) return withoutLink;
    text = withoutLink;
  }

  const buf = Buffer.from(text, 'utf8').slice(0, LIMIT - 1);
  return buf.toString('utf8').replace(/\uFFFD$/, '') + '…';
}

export async function postImage(opts: PostOptions): Promise<void> {
  const agent = await ensureAgent();

  const imageBuffer = fs.readFileSync(opts.path);
  const contentType = guessContentType(opts.path);
  const dimensions = sizeOf(imageBuffer);

  let uploadRes: Awaited<ReturnType<typeof agent.uploadBlob>>;
  try {
    uploadRes = await agent.uploadBlob(imageBuffer, { encoding: contentType });
  } catch {
    uploadRes = await agent.uploadBlob(imageBuffer);
  }

  const imageEntry: Record<string, unknown> = {
    alt:   opts.altText || '',
    image: uploadRes.data.blob,
    aspectRatio: {
      width:  dimensions.width,
      height: dimensions.height,
    },
  };

  const postText = truncatePostText(opts.text, opts.link);

  const record: Record<string, unknown> = {
    $type:     'app.bsky.feed.post',
    text:      postText,
    createdAt: new Date().toISOString(),
    embed: {
      $type:  'app.bsky.embed.images',
      images: [imageEntry],
    },
  };

  if (opts.link && opts.link.trim().length > 0) {
    const url     = opts.link.trim();
    const textBuf = Buffer.from(postText, 'utf8');
    const urlBuf  = Buffer.from(url, 'utf8');
    const idx     = textBuf.indexOf(urlBuf);
    if (idx !== -1) {
      record.facets = [
        {
          index:    { byteStart: idx, byteEnd: idx + urlBuf.length },
          features: [{ $type: 'app.bsky.richtext.facet#link', uri: url }],
        },
      ];
    }
  }

  await agent.post(record);
}