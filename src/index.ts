import { postImage } from './clients/at';
import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config();

const CUTOFF_DATE = new Date('1950-10-01T00:00:00');

function getDateFromFilename(filename: string): Date {
    const filenameNoJPG = filename.replace(/\.(JPG|jpeg|png|gif|bmp)$/i, "");
    return new Date(filenameNoJPG + 'T12:00:00'); 
}

function formatFullDate(dateObj: Date): string {
    const options: Intl.DateTimeFormatOptions = {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    };
    return new Intl.DateTimeFormat('en-US', options).format(dateObj);
}

function generateAltText(dateObj: Date): string {
    const formattedDate = formatFullDate(dateObj);
    if (dateObj < CUTOFF_DATE) {
        return 'A Li\'l Folks comic strip, drawn by Charles M. Schulz and credited to "Sparky", originally released ' + formattedDate;
    } else {
        return 'A Peanuts comic strip, drawn by Charles M. Schulz, originally released ' + formattedDate;
    }
}

function generateCaption(dateObj: Date): string {
  const formattedDate = formatFullDate(dateObj);
  if (dateObj < CUTOFF_DATE) {
    return 'Li\'l Folks by "Sparky": ' + formattedDate;
  } else {
    if (dateObj.getDay() === 0) {
      return 'Sunday Peanuts by Schulz: ' + formattedDate; 
    } else {
      return 'Peanuts by Schulz: ' + formattedDate; 
    }
  }
}

async function main() {
  const preSelectedPath = process.env.IMAGE_TO_POST;
  if (!preSelectedPath) {
    throw new Error('IMAGE_TO_POST environment variable is not set.');
  }
  console.log(`hello, index.ts here. i'm confirming that the RNG has selected ${preSelectedPath}`);

  const imageName = path.basename(preSelectedPath);
  const absolutePath = path.resolve(process.cwd(), preSelectedPath);
  const imageDate = getDateFromFilename(imageName); 
  const postText = generateCaption(imageDate);
  const postAltText = generateAltText(imageDate);

  await postImage({
    path: absolutePath,
    text: postText,
    altText: postAltText,
  });
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});