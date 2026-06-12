import * as dotenv from 'dotenv';
dotenv.config();
import * as fs from 'fs';
import { postImage as postToBluesky } from './clients/at';
import { postImage as postToMastodon } from './clients/mastodon';
import { fetchForKeyword, chooseUsableImage, downloadImageToTemp, composeCaption, recordPostedPhoto } from './clients/roowus';

const MANUFACTURERS = [
  'Aerospatiale', 'Airbus', 'Antonov', 'BAC', 'BAe', 'Boeing', 'Bombardier',
  'COMAC', 'Convair', 'De Havilland', 'De Havilland Canada', 'Dornier',
  'Douglas', 'Embraer', 'Fairchild', 'Fokker', 'Ford', 'Harbin',
  'Hawker Siddeley', 'Ilyushin', 'Lockheed', 'Martin', 'McDonnell Douglas',
  'NAMC', 'SAAB', 'Tupolev', 'Vickers',
];

const AIRLINES = [
  'Aer Lingus', 'Aeroflot', 'Aeromexico',
  'Air Afrique', 'Air Algerie', 'Air Berlin', 'Air California',
  'Air Canada', 'Air China', 'Air Europe', 'Air Florida',
  'Air France', 'Air India', 'Air Inter', 'Air Jamaica',
  'Air Lanka', 'Air Malta', 'Air Mauritius', 'Air Midwest',
  'Air New England', 'Air New Zealand', 'Air Niugini', 'Air Pacific',
  'Air Portugal', 'Air Seychelles', 'Air Tran Airways', 'Air Wisconsin',
  'Air Zimbabwe', 'Alaska Airlines', 'Alitalia', 'All Nippon Airways',
  'Allegheny Airlines', 'Aloha Airlines', 'Aloha Air Cargo',
  'America West Airlines', 'American Airlines', 'American Eagle Airlines',
  'American Flyers Airline', 'American Trans Air', 'Ansett Australia',
  'Ariana Afghan Airlines', 'Arrow Air', 'Aspen Airways',
  'Atlantic Southeast Airlines', 'Atlas Air', 'Austrian Airlines',
  'Avianca', 'Aviateca', 'Avjet Corporation',
  'Balkan Bulgarian Airlines', 'Braniff International Airways',
  'British Airways', 'British Caledonian', 'British Midland',
  'British Overseas Airways Corporation', 'Business Express Airlines',
  'Canadian Airlines', 'Canadian Pacific Air Lines', 'Capital Airlines',
  'Capitol Air', 'Caribbean Atlantic Airlines', 'Cathay Pacific',
  'Chautauqua Airlines', 'China Airlines', 'China Eastern', 'China Southern',
  'Coastal Airways', 'Colgan Air', 'Comair', 'Condor',
  'Continental Airlines', 'Continental Express', 'Cruzeiro do Sul',
  'CSA Czechoslovak Airlines', 'Cyprus Airways',
  'Delta Air Lines', 'DHL Airways',
  'Eastern Air Lines', 'EasyJet', 'Egyptair',
  'Empire Airlines', 'Ethiopian Airlines', 'Evergreen International Airlines',
  'Executive Airlines', 'Finnair', 'Florida West Airlines',
  'Flying Tiger Line', 'Frontier Airlines', 'Frontier Horizon',
  'Garuda Indonesia', 'Gemini Air Cargo', 'Grand Airways',
  'Gulf Air', 'Hapag-Lloyd', 'Hawaiian Airlines',
  'Horizon Air', 'Hughes Airwest', 'Iberia', 'Icelandair',
  'Iran Air', 'Iraqi Airways', 'Japan Airlines', 'Japan Air System',
  'JAT Yugoslav Airlines', 'Jet Airways', 'JetBlue Airways',
  'Kenya Airways', 'KLM', 'Korean Air', 'Kuwait Airways',
  'LACSA', 'Lake Central Airlines', 'LAN Chile', 'LATAM Airlines',
  'Libyan Arab Airlines', 'Lloyd Aereo Boliviano', 'LOT Polish Airlines',
  'Lufthansa', 'Mackey International Airlines',
  'Malev Hungarian Airlines', 'Malaysian Airline System',
  'Markair', 'Mesa Air', 'Mexicana', 'Midway Airlines',
  'Midwest Airlines', 'Midwest Express Airlines', 'Middle East Airlines',
  'Mohawk Airlines', 'Muse Air',
  'National Airlines', 'National Jet America', 'New York Air',
  'Nigerian Airways', 'North Central Airlines',
  'Northeast Airlines', 'Northern Air Cargo', 'Northwest Airlines',
  'Olympic Airways', 'Ozark Air Lines',
  'Pacific Southwest Airlines', 'Pakistan International Airlines',
  'Pan Am', 'Pan American World Airways',
  'Peoples Express Airlines', 'Philippine Airlines', 'Piedmont Airlines',
  'Precision Airlines', 'PSA', 'Qantas',
  'Reeve Aleutian Airways', 'Republic Airlines', 'Rich International Airways',
  'Royal Air Maroc', 'Royal Jordanian', 'Ryanair', 'Sabena',
  'Saudi Arabian Airlines', 'Scandinavian Airlines', 'Singapore Airlines',
  'SkyWest Airlines', 'South African Airways', 'Southeast Airlines',
  'Southern Air Transport', 'Southwest Airlines',
  'Spirit Airlines', 'Sun Country Airlines', 'Sunjet International',
  'Sunworld International Airlines', 'Swissair', 'Syrian Arab Airlines',
  'TAAG Angola Airlines', 'TAM Airlines', 'TAP Air Portugal',
  'Texas Air Corporation', 'Texas International Airlines',
  'Thai Airways', 'Tower Air', 'Trans Air',
  'Trans International Airlines', 'Trans States Airlines',
  'Trans World Airlines', 'Transamerica Airlines', 'Transavia',
  'Tunis Air', 'Turkish Airlines',
  'United Airlines', 'United Express', 'UPS Airlines',
  'US Air', 'US Airways', 'USAir', 'UTA',
  'Varig', 'VASP', 'Vietnam Airlines',
  'Virgin America', 'Virgin Atlantic', 'Virgin Australia', 'Virgin Blue',
  'Vanguard Airlines', 'ValuJet Airlines',
  'Western Airlines', 'Western Pacific Airlines',
  'Wien Air Alaska', 'World Airways', 'Yemen Airways',
];

const YEARS: string[] = [];
for (let y = 1930; y <= new Date().getFullYear(); y++) {
  YEARS.push(String(y));
}

function envBool(name: string, fallback = false): boolean {
  const v = (process.env[name] || '').toLowerCase().trim();
  if (!v) return fallback;
  return v === '1' || v === 'true' || v === 'yes';
}

function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

function safeTrim(s?: string | null) {
  return (s || '').toString().trim();
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function buildAltText(regOrKeyword: string, img: any) {
  if (!img) return `Photo of aircraft (${regOrKeyword}).`;
  const aircraft = safeTrim(img.Aircraft);
  const registration = safeTrim(img.Registration);
  const airline = safeTrim(img.Airline);
  const photographer = safeTrim(img.Photographer);
  const when = safeTrim(img.DateTaken);
  const parts: string[] = [];
  if (aircraft) parts.push(aircraft);
  if (registration) parts.push(registration);
  else parts.push(regOrKeyword);
  if (airline) parts.push(`(${airline})`);
  const main = parts.join(' ');
  const by = photographer ? `Photo: ${photographer}` : '';
  const whenPart = when ? when : '';
  const alt = [main, whenPart, by].filter(Boolean).join(' · ');
  return alt.length > 2000 ? alt.slice(0, 1997) + '...' : alt;
}

async function tryUpgradeThumbnailToFull(thumbUrl: string) {
  if (!thumbUrl) return undefined;
  try {
    const candidate = thumbUrl.replace(/\/\d+\//, '/full/');
    if (!candidate || candidate === thumbUrl) return undefined;
    const resp = await fetch(candidate, { method: 'HEAD' });
    if (resp.ok) return candidate;
  } catch (e) {}
  return undefined;
}

function buildSearchTerm(): string {
  const include = {
    manufacturer: Math.random() < 0.5,
    airline:      Math.random() < 0.5,
    year:         Math.random() < 0.4,
  };

  if (!include.manufacturer && !include.airline && !include.year) {
    const roll = Math.random();
    if (roll < 0.4)      include.manufacturer = true;
    else if (roll < 0.8) include.airline = true;
    else                 include.year = true;
  }

  const parts: string[] = [];
  if (include.manufacturer) parts.push(pickRandom(MANUFACTURERS));
  if (include.airline)      parts.push(pickRandom(AIRLINES));
  if (include.year)         parts.push(pickRandom(YEARS));

  return parts.join(' ');
}

async function runOnce() {
  const dryRun = envBool('POST_DRY_RUN', false);
  const preferThumb = envBool('JETAPI_USE_THUMBNAIL', false);
  const photosBase = Number(process.env.JETAPI_PHOTOS || 5) || 5;
  const maxAttempts = Number(process.env.ROOWUS_ATTEMPTS || 8);
  const allowMissingMeta = envBool('ALLOW_MISSING_PHOTO_METADATA', false);
  const failOnNoImage = envBool('FAIL_ON_NO_IMAGE', false);

  let chosenImage: any = null;
  let chosenKeyword = '';
  let lastRaw: any = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const keyword = buildSearchTerm();
    const photos = photosBase * (1 + Math.floor(attempt / 2));
    console.log(`Attempt ${attempt + 1}/${maxAttempts}: querying for "${keyword}" (photos=${photos})`);
    let jp;
    try {
      jp = await fetchForKeyword(keyword, photos);
      lastRaw = jp?.raw;
    } catch (e) {
      console.warn(`Fetch for "${keyword}" failed:`, (e && (e as any).message) ? (e as any).message : e);
      continue;
    }
    const available = Array.isArray(jp?.Images) ? jp.Images.length : 0;
    console.log(`Returned ${available} images for "${keyword}"`);
    const usable = chooseUsableImage(jp);
    if (usable) {
      chosenImage = usable;
      chosenKeyword = keyword;
      break;
    }
    console.log(`No usable image for "${keyword}", trying a different combination.`);
  }

  if (!chosenImage) {
    console.log('No image matched strict filter; trying relaxed fallback.');
    for (let i = 0; i < 3; i++) {
      const keyword = buildSearchTerm();
      try {
        const jp = await fetchForKeyword(keyword, photosBase * 2);
        lastRaw = jp?.raw;
        const candidate = (jp?.Images || []).find((img: any) => img && ((img.Image && img.Image.trim()) || (img.Thumbnail && img.Thumbnail.trim())) && img.Link);
        if (candidate) {
          chosenImage = candidate;
          chosenKeyword = keyword;
          console.log(`Found relaxed candidate for "${keyword}".`);
          break;
        }
      } catch (e) {}
    }
  }

  if (!chosenImage) {
    if (lastRaw) {
      try { console.error('Sample raw response (truncated):', JSON.stringify(lastRaw).slice(0, 2000)); } catch {}
    }
    const msg = 'No usable images found after all attempts.';
    if (failOnNoImage) throw new Error(msg);
    console.warn(msg);
    return;
  }

  if ((!chosenImage.Photographer || !chosenImage.Link) && !allowMissingMeta) {
    const missing = [
      !chosenImage.Photographer ? 'Photographer' : null,
      !chosenImage.Link ? 'Link' : null,
    ].filter(Boolean).join(', ');
    const s = `Selected image for "${chosenKeyword}" is missing metadata: ${missing}`;
    if (dryRun) {
      console.log('POST_DRY_RUN=true — selected image missing metadata:', s);
      return;
    }
    if (failOnNoImage) throw new Error(`Refusing to post: ${s}`);
    console.warn(s + ' — not posting (set ALLOW_MISSING_PHOTO_METADATA=true to override).');
    return;
  }

  const preferFull = !preferThumb;
  let downloadUrl: string | undefined = undefined;

  if (preferFull) {
    if (chosenImage.Image && String(chosenImage.Image).trim().length > 0) {
      downloadUrl = chosenImage.Image;
    } else if (chosenImage.Thumbnail && String(chosenImage.Thumbnail).trim().length > 0) {
      const upgraded = await tryUpgradeThumbnailToFull(chosenImage.Thumbnail);
      downloadUrl = upgraded || chosenImage.Thumbnail;
    }
  } else {
    downloadUrl = chosenImage.Thumbnail || chosenImage.Image;
  }

  if (!downloadUrl) throw new Error('Selected image has no downloadable URL.');

  console.log('Selected image URL:', downloadUrl);
  const tmpPath = await downloadImageToTemp(downloadUrl, chosenKeyword);
  console.log('Downloaded image to', tmpPath);
  const captionObj = composeCaption(chosenKeyword, chosenImage);
  const altText = buildAltText(chosenKeyword, chosenImage);

  if (dryRun) {
    console.log('POST_DRY_RUN=true — skipping actual posts. Payload:');
    console.log('caption:', captionObj.text);
    console.log('altText:', altText);
    console.log('file:', tmpPath);
    try { await fs.promises.unlink(tmpPath); } catch (e) {}
    return;
  }

  try {
    const postOptions = { path: tmpPath, text: captionObj.text, altText, link: chosenImage.Link };
    const results = await Promise.allSettled([postToBluesky(postOptions), postToMastodon(postOptions)]);

    const blueskyResult = results[0];
    if (blueskyResult && blueskyResult.status === 'fulfilled') {
      try {
        if (chosenImage?.photoId) {
          recordPostedPhoto(chosenImage.photoId);
          console.log('Recorded posted photoId:', chosenImage.photoId);
        } else {
          console.log('No photoId on chosen image; skipping history record.');
        }
      } catch (e) {
        console.warn('Failed to record posted photo:', e);
      }
    }

    const failures = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    if (failures.length > 0) {
      failures.forEach((f) => console.error('failed:', (f as any).reason));
      if (failures.length === results.length) throw new Error('All platforms failed.');
    }
    console.log('Post completed.');
  } finally {
    try { await fs.promises.unlink(tmpPath); console.log('Removed temp file', tmpPath); } catch (e) {}
  }
}

(async () => {
  const maxEmptyRetries = Number(process.env.ROOWUS_EMPTY_RETRY_COUNT || 3);
  const sleepSeconds = Number(process.env.ROOWUS_EMPTY_RETRY_SLEEP || 10);
  for (let attempt = 0; attempt <= maxEmptyRetries; attempt++) {
    try {
      await runOnce();
      process.exit(0);
    } catch (err: any) {
      const msg = (err && err.message) ? err.message : String(err);
      const noImages = msg.includes('No usable images found');
      if (!noImages) {
        console.error('Fatal:', err);
        process.exit(1);
      }
      if (attempt < maxEmptyRetries) {
        console.warn(`No usable images (attempt ${attempt + 1}/${maxEmptyRetries + 1}), sleeping ${sleepSeconds}s and retrying...`);
        await sleep(sleepSeconds * 1000);
        continue;
      } else {
        console.error('Exhausted retries, exiting.');
        process.exit(0);
      }
    }
  }
})();