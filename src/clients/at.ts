import * as fs from 'fs';
import { BskyAgent } from '@atproto/api';
import * as sizeOf from 'buffer-image-size';

const BSKY_MAX_BYTES = 1900000;

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

async function compressToLimit(buffer: Buffer, contentType: string): Promise<{ buffer: Buffer; contentType: string }> {
  if (buffer.byteLength <= BSKY_MAX_BYTES) return { buffer, contentType };

  let sharp: any;
  try {
    sharp = (eval('require') as NodeRequire)('sharp');
  } catch {
    throw new Error(`Image is ${buffer.byteLength} bytes, exceeds Bluesky's 2MB limit, and sharp is not available to compress it.`);
  }

  console.log(`Image is ${buffer.byteLength} bytes, compressing to fit under ${BSKY_MAX_BYTES} bytes...`);

  let quality = 82;
  let result = buffer;
  let resultType = 'image/jpeg';

  while (quality >= 40) {
    const compressed = await sharp(buffer).jpeg({ quality }).toBuffer();
    if (compressed.byteLength <= BSKY_MAX_BYTES) {
      result = compressed;
      console.log(`Compressed to ${compressed.byteLength} bytes at quality ${quality}.`);
      break;
    }
    quality -= 10;
  }

  if (result.byteLength > BSKY_MAX_BYTES) {
    const compressed = await sharp(buffer).resize({ width: 2048 }).jpeg({ quality: 75 }).toBuffer();
    if (compressed.byteLength <= BSKY_MAX_BYTES) {
      result = compressed;
      resultType = 'image/jpeg';
      console.log(`Compressed with resize to ${compressed.byteLength} bytes.`);
    } else {
      throw new Error(`Could not compress image to under ${BSKY_MAX_BYTES} bytes (got ${compressed.byteLength}).`);
    }
  }

  return { buffer: result, contentType: resultType };
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

  let imageBuffer = fs.readFileSync(opts.path);
  let contentType = guessContentType(opts.path);
  const dimensions = sizeOf(imageBuffer);

  const compressed = await compressToLimit(imageBuffer, contentType);
  imageBuffer = compressed.buffer;
  contentType = compressed.contentType;

  let uploadRes: Awaited<ReturnType<typeof agent.uploadBlob>>;
  try {
    uploadRes = await agent.uploadBlob(imageBuffer as unknown as Uint8Array, { encoding: contentType });
  } catch {
    uploadRes = await agent.uploadBlob(imageBuffer as unknown as Uint8Array);
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