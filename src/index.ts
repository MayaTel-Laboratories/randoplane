import * as dotenv from 'dotenv';
dotenv.config();
import * as fs from 'fs';
import { postImage as postToBluesky } from './clients/at';
import { postImage as postToMastodon } from './clients/mastodon';
import { fetchForKeyword, chooseUsableImage, downloadImageToTemp, composeCaption, recordPostedPhoto, SearchParams } from './clients/roowus';

const MANUFACTURERS = [
  'Concorde', 'Airbus', 'Antonov', 'BAC', 'BAe', 'Boeing', 'Bombardier',
  'COMAC', 'Convair', 'De Havilland', 'De Havilland Canada', 'Dornier',
  'Douglas', 'Embraer', 'Fairchild', 'Fokker', 'Ford', 'Harbin',
  'Hawker Siddeley', 'Ilyushin', 'Lockheed', 'Martin', 'McDonnell Douglas',
  'NAMC', 'SAAB', 'Tupolev', 'Vickers', 'Yakovlev'
];

const AIRLINES = [
  'Aer Lingus', 'Aeroflot', 'Aeromexico', 'Aero California',
  'Air Afrique', 'Air Algerie', 'Air Berlin', 'Air California',
  'AirCal', 'Air Canada', 'Air China', 'Air Europe', 'Air Florida',
  'Air France', 'Air India', 'Air Inter', 'Air Jamaica', 'Air Koryo',
  'Air Lanka', 'Air Malta', 'Air Mauritius', 'Air Midwest',
  'Air New England', 'Air New Zealand', 'Air Niugini', 'Air Pacific',
  'Air Portugal', 'Air Seychelles', 'Air Tran Airways', 'Air Wisconsin',
  'Air Zimbabwe', 'Alaska Airlines', 'Alitalia', 'All Nippon Airways',
  'Allegheny Airlines', 'Aloha Airlines', 'Aloha Air Cargo',
  'America West Airlines', 'American Airlines', 'American Eagle Airlines',
  'American Flyers Airline', 'American Trans Air', 'Ansett Australia',
  'Ariana Afghan Airlines', 'Arrow Air', 'Aspen Airways',
  'Atlantic Southeast Airlines', 'Atlas Air', 'Austrian Airlines',
  'Avianca', 'Aviateca', 'Avjet Corporation', 'Azul',
  'Balkan Bulgarian Airlines', 'BEA', 'British European Airways', 'Braniff International Airways',
  'Braniff', 'British Airways', 'British Caledonian', 'British Midland',
  'British Overseas Airways Corporation', 'Business Express Airlines',
  'Canadian Airlines', 'Canadian Pacific Air Lines', 'Capital Airlines',
  'Capitol Air', 'Caribbean Atlantic Airlines', 'Cargolux', 'Cathay Pacific',
  'Chautauqua Airlines', 'China Airlines', 'China Eastern', 'China Southern',
  'Coastal Airways', 'Colgan Air', 'Comair', 'Condor',
  'Continental Airlines', 'Continental Express', 'Copa Airlines', 'Cruzeiro do Sul',
  'CSA Czechoslovak Airlines', 'Cyprus Airways', 'Cubana',
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
  'Markair', 'Mesa Air', 'Mexicana', 'Metrojet', 'Midway Airlines',
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
  'Viva', 'VivaAerobus', 'Vanguard Airlines', 'ValuJet Airlines',
  'Western Airlines', 'Western Pacific Airlines',
  'Wien Air Alaska', 'World Airways', 'Yemen Airways',
];

const YEARS: string[] = [];
for (let y = 1930; y <= new Date().getFullYear(); y++) {
  YEARS.push(String(y));
}

function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function buildSearchParams(): SearchParams {
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

  const params: SearchParams = {};
  if (include.manufacturer) params.manufacturer = pickRandom(MANUFACTURERS);
  if (include.airline)      params.airline = pickRandom(AIRLINES);
  if (include.year)         params.year = pickRandom(YEARS);

  return params;
}

async function runOnce() {
  const dryRun = (process.env.POST_DRY_RUN || '').toLowerCase().trim();
  const isDryRun = dryRun === '1' || dryRun === 'true' || dryRun === 'yes';

  let chosenImage: any = null;
  let chosenKeyword = '';
  let lastRaw: any = null;

  for (let attempt = 0; attempt < 8; attempt++) {
    const params = buildSearchParams();
    const keyword = [params.manufacturer, params.airline, params.year].filter(Boolean).join(' / ');
    const photos = 5 * (1 + Math.floor(attempt / 2));
    console.log(`attempt ${attempt + 1}/8: querying for "${keyword}" (photos=${photos})`);
    let jp;
    try {
      jp = await fetchForKeyword(params, photos);
      lastRaw = jp?.raw;
    } catch (e) {
      console.warn(`fetch for "${keyword}" failed:`, (e && (e as any).message) ? (e as any).message : e);
      continue;
    }
    const available = Array.isArray(jp?.Images) ? jp.Images.length : 0;
    console.log(`returned ${available} images for "${keyword}"`);
    const usable = chooseUsableImage(jp);
    if (usable) {
      chosenImage = usable;
      chosenKeyword = keyword;
      break;
    }
    console.log(`apparently "${keyword}" was a bad combo, trying again...`);
    if (attempt < 7) await sleep(3000);
  }

  if (!chosenImage) {
    console.log('no image matched strict filter; trying again but looser...');
    for (let i = 0; i < 3; i++) {
      const fallbackParams = buildSearchParams();
      const keyword = [fallbackParams.manufacturer, fallbackParams.airline, fallbackParams.year].filter(Boolean).join(' / ');
      try {
        const jp = await fetchForKeyword(fallbackParams, 10);
        lastRaw = jp?.raw;
        const candidate = (jp?.Images || []).find((img: any) => img && ((img.Image && img.Image.trim()) || (img.Thumbnail && img.Thumbnail.trim())) && img.Link);
        if (candidate) {
          chosenImage = candidate;
          chosenKeyword = keyword;
          console.log(`found relaxed candidate for "${keyword}".`);
          break;
        }
      } catch (e) {}
    }
  }

  if (!chosenImage) {
    if (lastRaw) {
      try { console.error('sample raw response (truncated):', JSON.stringify(lastRaw).slice(0, 2000)); } catch {}
    }
    const msg = 'i got nothing, sorry';
    console.warn(msg);
    throw new Error(msg);
  }

  if (!chosenImage.Photographer || !chosenImage.Link) {
    const missing = [
      !chosenImage.Photographer ? 'Photographer' : null,
      !chosenImage.Link ? 'Link' : null,
    ].filter(Boolean).join(', ');
    console.warn(`selected image for "${chosenKeyword}" is missing metadata: ${missing} — not posting.`);
    return;
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
    const postOptions = { path: tmpPath, text: captionObj.text, link: chosenImage.Link };
    const results = await Promise.allSettled([postToBluesky(postOptions), postToMastodon(postOptions)]);

    const blueskyResult = results[0];
    if (blueskyResult && blueskyResult.status === 'fulfilled') {
      try {
        if (chosenImage?.photoId) {
          recordPostedPhoto(chosenImage.photoId);
          console.log('recorded photo id:', chosenImage.photoId);
        } else {
          console.log('no photo id on chosen image; skipping writing it down...');
        }
      } catch (e) {
        console.warn('failed to record posted photo:', e);
      }
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
  for (let attempt = 0; attempt <= 3; attempt++) {
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
      if (attempt < 3) {
        console.warn(`no usable images (attempt ${attempt + 1}/4), sleeping 10s and retrying...`);
        await sleep(10000);
        continue;
      } else {
        console.error('no more retries. run the workflow again?');
        process.exit(0);
      }
    }
  }
})();