import jalaliMoment from 'jalali-moment';
import fs from 'fs-extra';
import path from 'path';
import type { Config, AlbumsData, ResolvedDates } from '../types.js';
import { Logger, StatsTracker } from '../utils.js';

const RELATIVE_DAYS: Record<string, number> = {
  'امروز': 0,
  'دیروز': -1,
  'پریروز': -2,
  'فردا': 1,
  'پس‌فردا': 2,
  'پسفردا': 2,
};

const WEEKDAYS: Record<string, number> = {
  'شنبه': 6,
  'یکشنبه': 0,
  'یک‌شنبه': 0,
  'دوشنبه': 1,
  'سه‌شنبه': 2,
  'سه شنبه': 2,
  'چهارشنبه': 3,
  'چهار‌شنبه': 3,
  'پنجشنبه': 4,
  'پنج‌شنبه': 4,
  'جمعه': 5,
};

const JALALI_MONTHS: Record<string, number> = {
  'فروردین': 1,
  'اردیبهشت': 2,
  'خرداد': 3,
  'تیر': 4,
  'مرداد': 5,
  'شهریور': 6,
  'مهر': 7,
  'آبان': 8,
  'آذر': 9,
  'دی': 10,
  'بهمن': 11,
  'اسفند': 12,
};

function persianToEnglishNumbers(str: string): string {
  const persianNums = '۰۱۲۳۴۵۶۷۸۹';
  return str.replace(/[۰-۹]/g, (d) => String(persianNums.indexOf(d)));
}

function parseJalaliDate(dateStr: string, referenceDate?: Date): Date | null {
  const normalized = persianToEnglishNumbers(dateStr.trim());

  // Try numeric format: 1404/10/18 or 1404-10-18
  const numericMatch = normalized.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (numericMatch) {
    const [, year, month, day] = numericMatch;
    try {
      const jm = jalaliMoment(`${year}/${month.padStart(2, '0')}/${day.padStart(2, '0')}`, 'jYYYY/jMM/jDD');
      if (jm.isValid()) return jm.toDate();
    } catch {
      // Continue to try other formats
    }
  }

  // Try Persian month name: "18 دی" or "۱۸ دی" or "18 دی 1404"
  for (const [monthName, monthNum] of Object.entries(JALALI_MONTHS)) {
    if (dateStr.includes(monthName)) {
      // Extract day number (before or after month name)
      const dayMatch = normalized.match(/(\d{1,2})/);
      if (dayMatch) {
        const day = parseInt(dayMatch[1], 10);
        if (day >= 1 && day <= 31) {
          // Try to find year, otherwise use reference year
          const yearMatch = normalized.match(/(\d{4})/);
          let year: number;
          if (yearMatch) {
            year = parseInt(yearMatch[1], 10);
          } else if (referenceDate) {
            // Use reference date's Jalali year
            const refJm = jalaliMoment(referenceDate);
            year = refJm.jYear();
          } else {
            year = 1404; // Default to current year
          }

          try {
            const jm = jalaliMoment(`${year}/${monthNum}/${day}`, 'jYYYY/jM/jD');
            if (jm.isValid()) return jm.toDate();
          } catch {
            // Continue
          }
        }
      }
    }
  }

  return null;
}

function resolveRelativeDate(relativeStr: string, referenceDate: Date): Date | null {
  const normalized = relativeStr.trim();

  if (RELATIVE_DAYS[normalized] !== undefined) {
    const result = new Date(referenceDate);
    result.setDate(result.getDate() + RELATIVE_DAYS[normalized]);
    return result;
  }

  if (WEEKDAYS[normalized] !== undefined) {
    const targetDay = WEEKDAYS[normalized];
    const currentDay = referenceDate.getDay();
    let diff = targetDay - currentDay;
    if (diff > 0) diff -= 7;
    if (diff === 0) diff = -7;
    const result = new Date(referenceDate);
    result.setDate(result.getDate() + diff);
    return result;
  }

  return null;
}

function toJalaliString(date: Date): string {
  const jm = jalaliMoment(date);
  return jm.format('jYYYY/jMM/jDD');
}

function toGregorianString(date: Date): string {
  return date.toISOString().split('T')[0];
}

export interface ResolveOptions {
  dryRun: boolean;
}

export async function resolve(config: Config, options: ResolveOptions): Promise<void> {
  const logger = new Logger(config.paths.raw);
  const stats = new StatsTracker();

  const albumsPath = path.join(config.paths.raw, 'albums.json');

  if (!await fs.pathExists(albumsPath)) {
    console.error('✗ No albums.json found. Run download first.');
    process.exit(1);
  }

  const albumsData: AlbumsData = await fs.readJson(albumsPath);

  console.log('📅 Resolving dates...');
  console.log(`   Albums: ${albumsData.albums.length}`);
  console.log(`   Dry run: ${options.dryRun}`);

  let resolved = 0;
  let jalaliCount = 0;
  let relativeCount = 0;
  let fallbackCount = 0;

  for (const album of albumsData.albums) {
    const telegramDate = new Date(album.telegram_date);
    let finalDate: Date | null = null;
    let source: ResolvedDates['source'] = 'telegram_fallback';

    if (album.analysis?.dates && album.analysis.dates.length > 0) {
      for (const dateStr of album.analysis.dates) {
        const jalaliDate = parseJalaliDate(dateStr, telegramDate);
        if (jalaliDate) {
          finalDate = jalaliDate;
          source = 'jalali';
          jalaliCount++;
          break;
        }

        const relativeDate = resolveRelativeDate(dateStr, telegramDate);
        if (relativeDate) {
          finalDate = relativeDate;
          source = 'relative';
          relativeCount++;
          break;
        }
      }
    }

    if (!finalDate) {
      finalDate = telegramDate;
      source = 'telegram_fallback';
      fallbackCount++;
    }

    album.resolved_dates = {
      gregorian: toGregorianString(finalDate),
      jalali: toJalaliString(finalDate),
      source,
    };

    resolved++;
    stats.increment('albums_total');

    if (options.dryRun) {
      console.log(`   ${album.album_id}: ${album.resolved_dates.gregorian} (${source})`);
    } else {
      logger.log('resolve', 'success',
        `Resolved: ${album.resolved_dates.gregorian} via ${source}`,
        album.album_id
      );
    }
  }

  if (!options.dryRun) {
    await fs.writeJson(albumsPath, albumsData, { spaces: 2 });
    await logger.save();
  }

  console.log(`\n✓ Date resolution complete`);
  console.log(`   Total: ${resolved}`);
  console.log(`   From Jalali: ${jalaliCount}`);
  console.log(`   From relative: ${relativeCount}`);
  console.log(`   Telegram fallback: ${fallbackCount}`);
}
