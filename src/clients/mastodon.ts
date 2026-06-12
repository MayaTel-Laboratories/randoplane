import * as fs from 'fs';
import * as path from 'path';

const MASTODON_INSTANCE = 'https://tacobelllabs.net';

type PostImageOptions = {
  path: fs.PathLike;
  text: string;
  altText?: string;
};

async function postImage({ path: imagePath, text, altText }: PostImageOptions) {
  const accessToken = process.env.MASTODON_ACCESS_TOKEN;
  if (!accessToken) {
    throw new Error('MASTODON_ACCESS_TOKEN is not set.');
  }

  const fileBuffer = fs.readFileSync(imagePath);
  const fileName = path.basename(imagePath.toString());
  const blob = new Blob([fileBuffer], { type: 'image/jpeg' });

  const formData = new FormData();
  formData.append('file', blob, fileName);
  formData.append('description', altText);

  const mediaResponse = await fetch(`${MASTODON_INSTANCE}/api/v2/media`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    },
    body: formData,
  });

  if (!mediaResponse.ok) {
    const errorText = await mediaResponse.text();
    throw new Error(`Mastodon media upload failed (${mediaResponse.status}): ${errorText}`);
  }

  const mediaData = await mediaResponse.json();
  const mediaId = mediaData.id;

  const statusResponse = await fetch(`${MASTODON_INSTANCE}/api/v1/statuses`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      status: text,
      media_ids: [mediaId],
    }),
  });

  if (!statusResponse.ok) {
    const errorText = await statusResponse.text();
    throw new Error(`Mastodon status post failed (${statusResponse.status}): ${errorText}`);
  }
}

export { postImage };