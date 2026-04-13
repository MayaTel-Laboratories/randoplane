import * as fs from 'fs/promises';
import * as path from 'path';
const Holidays = require('date-holidays');
type RandomImage = {
  imageName: string;
  absolutePath: string;
};
const hd = new Holidays('US'); 
const imagesDir = path.resolve(__dirname, '../../imagequeue');
const imageRegex = /\.(jpg|jpeg|png|gif|bmp)$/i;
const dateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  month: '2-digit',
  day: '2-digit',
  year: 'numeric'
});
let cachedThanksgivingDates: string[] = [];
function getHistoricalThanksgivings(currentYear: number): string[] {
  if (cachedThanksgivingDates.length > 0) return cachedThanksgivingDates;
  for (let y = 1950; y <= currentYear; y++) {
    const yearlyHolidays = hd.getHolidays(y);
    const tg = yearlyHolidays.find((h: any) => h.name === 'Thanksgiving Day');
    if (tg) {
      const d = new Date(tg.date);
      cachedThanksgivingDates.push(`${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`);
    }
  }
  return cachedThanksgivingDates;
}
async function getNextImage(): Promise<RandomImage> {
  if (process.env.IMAGE_TO_POST) {
    const preSelectedPath = process.env.IMAGE_TO_POST;
    console.log(`hello, index.ts here. i'm confirming that the RNG has selected ${preSelectedPath}`);
    return {
      imageName: path.basename(preSelectedPath),
      absolutePath: path.resolve(process.cwd(), preSelectedPath)
    };
  }
  const now = new Date();
  const parts = dateFormatter.formatToParts(now);
  const month = parts.find(p => p.type === 'month')?.value;
  const day = parts.find(p => p.type === 'day')?.value;
  const year = parseInt(parts.find(p => p.type === 'year')?.value || '2026');
  const dateString = `${month}-${day}`;
  const todayHolidays = hd.isHoliday(now);
  const isThanksgiving = Array.isArray(todayHolidays) && todayHolidays.some((h: any) => h.name === 'Thanksgiving Day');
  const isFixedHoliday = ['12-25', '01-01', '10-31'].includes(dateString);
  const tgDates = isThanksgiving ? getHistoricalThanksgivings(year) : [];
  let validFiles: string[] = [];
  let holidayFiles: string[] = [];
  const dir = await fs.opendir(imagesDir);
  for await (const entry of dir) {
    if (entry.isFile() && imageRegex.test(entry.name)) {
      validFiles.push(entry.name);
      if (isThanksgiving && tgDates.some(d => entry.name.includes(d))) {
        holidayFiles.push(entry.name);
      } else if (isFixedHoliday && entry.name.includes(dateString)) {
        holidayFiles.push(entry.name);
      }
    }
  }
  const selectionPool = holidayFiles.length > 0 ? holidayFiles : validFiles;
  if (selectionPool.length === 0) {
    throw new Error('No valid image files found in directory.');
  }
  const imageName = selectionPool[Math.floor(Math.random() * selectionPool.length)];
  return { 
    imageName, 
    absolutePath: path.join(imagesDir, imageName) 
  };
}
export { getNextImage };