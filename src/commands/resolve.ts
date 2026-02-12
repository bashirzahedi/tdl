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

const PERSIAN_ORDINALS: Record<string, number> = {
  'اول': 1, 'یکم': 1,
  'دوم': 2,
  'سوم': 3,
  'چهارم': 4,
  'پنجم': 5,
  'ششم': 6,
  'هفتم': 7,
  'هشتم': 8,
  'نهم': 9,
  'دهم': 10,
  'یازدهم': 11,
  'دوازدهم': 12,
  'سیزدهم': 13,
  'چهاردهم': 14,
  'پانزدهم': 15,
  'شانزدهم': 16,
  'هفدهم': 17,
  'هجدهم': 18, 'هیجدهم': 18,
  'نوزدهم': 19,
  'بیستم': 20,
  'بیست‌ویکم': 21, 'بیست و یکم': 21,
  'بیست‌ودوم': 22, 'بیست و دوم': 22,
  'بیست‌وسوم': 23, 'بیست و سوم': 23,
  'بیست‌وچهارم': 24, 'بیست و چهارم': 24,
  'بیست‌وپنجم': 25, 'بیست و پنجم': 25,
  'بیست‌وششم': 26, 'بیست و ششم': 26,
  'بیست‌وهفتم': 27, 'بیست و هفتم': 27,
  'بیست‌وهشتم': 28, 'بیست و هشتم': 28,
  'بیست‌ونهم': 29, 'بیست و نهم': 29,
  'سی‌ام': 30, 'سیم': 30,
  'سی‌ویکم': 31, 'سی و یکم': 31,
};

function persianToEnglishNumbers(str: string): string {
  const persianNums = '۰۱۲۳۴۵۶۷۸۹';
  return str.replace(/[۰-۹]/g, (d) => String(persianNums.indexOf(d)));
}

function extractOrdinalDay(text: string): number | null {
  // Check longest ordinals first to avoid partial matches (e.g., "بیست‌ویکم" before "یکم")
  const sorted = Object.entries(PERSIAN_ORDINALS).sort((a, b) => b[0].length - a[0].length);
  for (const [ordinal, num] of sorted) {
    if (text.includes(ordinal)) return num;
  }
  return null;
}

function jalaliToUTCDate(year: number, month: number, day: number): Date | null {
  try {
    const jm = jalaliMoment(`${year}/${month}/${day}`, 'jYYYY/jM/jD');
    if (!jm.isValid()) return null;
    // Convert to UTC midnight to avoid timezone shifts
    const gregorian = jm.format('YYYY-MM-DD');
    return new Date(gregorian + 'T00:00:00.000Z');
  } catch {
    return null;
  }
}

function parseJalaliDate(dateStr: string, referenceDate?: Date): Date | null {
  const normalized = persianToEnglishNumbers(dateStr.trim());

  // Try numeric format: 1404/10/18 or 1404-10-18
  const numericMatch = normalized.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (numericMatch) {
    const [, year, month, day] = numericMatch;
    return jalaliToUTCDate(parseInt(year, 10), parseInt(month, 10), parseInt(day, 10));
  }

  // Try Persian month name: "18 دی" or "۱۸ دی" or "هفتم دی" or "18 دی 1404"
  for (const [monthName, monthNum] of Object.entries(JALALI_MONTHS)) {
    if (findMonthAsWholeWord(dateStr, monthName) !== -1) {
      // First: try ordinal text ("هفتم", "سیزدهم", etc.)
      let day = extractOrdinalDay(dateStr);

      // Second: try numeric day — match 1-2 digits NOT part of a 4-digit year
      if (day === null) {
        const dayMatch = normalized.match(/(?<!\d)(\d{1,2})(?!\d)/);
        if (dayMatch) {
          day = parseInt(dayMatch[1], 10);
        }
      }

      // Skip if no day found (month-only reference like "خرداد ۱۴۰۱")
      if (day === null || day < 1 || day > 31) continue;

      // Extract year (4-digit number)
      const yearMatch = normalized.match(/(\d{4})/);
      let year: number;
      if (yearMatch) {
        year = parseInt(yearMatch[1], 10);
      } else if (referenceDate) {
        const refJm = jalaliMoment.utc(referenceDate);
        year = refJm.jYear();
      } else {
        year = 1404;
      }

      const result = jalaliToUTCDate(year, monthNum, day);
      if (result) return result;
    }
  }

  return null;
}

function resolveRelativeDate(relativeStr: string, referenceDate: Date): Date | null {
  const normalized = relativeStr.trim();

  if (RELATIVE_DAYS[normalized] !== undefined) {
    const result = new Date(referenceDate);
    result.setUTCDate(result.getUTCDate() + RELATIVE_DAYS[normalized]);
    return result;
  }

  if (WEEKDAYS[normalized] !== undefined) {
    const targetDay = WEEKDAYS[normalized];
    const currentDay = referenceDate.getUTCDay();
    let diff = targetDay - currentDay;
    if (diff > 0) diff -= 7;
    if (diff === 0) diff = -7;
    const result = new Date(referenceDate);
    result.setUTCDate(result.getUTCDate() + diff);
    return result;
  }

  return null;
}

function findMonthAsWholeWord(text: string, monthName: string): number {
  // Build regex requiring month name as a standalone word
  const pattern = new RegExp(
    `(?<![\\u0600-\\u06FF\\u0750-\\u077F\\uFB50-\\uFDFF\\uFE70-\\uFEFF])` +
    monthName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
    `(?![\\u0600-\\u06FF\\u0750-\\u077F\\uFB50-\\uFDFF\\uFE70-\\uFEFF])`
  );
  const match = pattern.exec(text);
  return match ? match.index : -1;
}

// Extract date strings from caption text (fallback when AI didn't extract dates)
function extractDatesFromCaption(caption: string): string[] {
  if (!caption) return [];

  const dates: string[] = [];

  // Look for numeric Jalali dates: 1404/10/18, ۱۴۰۴/۱۰/۱۸
  const numericPattern = /[\u06F0-\u06F9\d]{4}[\/-][\u06F0-\u06F9\d]{1,2}[\/-][\u06F0-\u06F9\d]{1,2}/g;
  let match;
  while ((match = numericPattern.exec(caption)) !== null) {
    dates.push(match[0]);
  }

  // Look for month name patterns with word boundary: "۱۸ دی", "هفتم دی", etc.
  // Short month names like "دی" must be standalone words (not inside "دوری", "دیگر")
  const monthNames = Object.keys(JALALI_MONTHS);
  for (const monthName of monthNames) {
    const idx = findMonthAsWholeWord(caption, monthName);
    if (idx === -1) continue;

    // Extract a window around the month name (50 chars before and after)
    const start = Math.max(0, idx - 50);
    const end = Math.min(caption.length, idx + monthName.length + 50);
    const segment = caption.substring(start, end);
    dates.push(segment);
  }

  // Look for relative date words
  for (const word of Object.keys(RELATIVE_DAYS)) {
    if (caption.includes(word)) {
      dates.push(word);
    }
  }

  return dates;
}

function toJalaliString(date: Date): string {
  const jm = jalaliMoment.utc(date);
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
  let captionCount = 0;
  let fallbackCount = 0;

  for (const album of albumsData.albums) {
    const telegramDate = new Date(album.telegram_date);
    let finalDate: Date | null = null;
    let source: ResolvedDates['source'] = 'telegram_fallback';

    // Try AI-extracted dates first
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

    // Fallback: extract dates from caption text
    if (!finalDate && album.caption_fa) {
      const captionDates = extractDatesFromCaption(album.caption_fa);
      for (const dateStr of captionDates) {
        const jalaliDate = parseJalaliDate(dateStr, telegramDate);
        if (jalaliDate) {
          finalDate = jalaliDate;
          source = 'caption';
          captionCount++;
          break;
        }

        const relativeDate = resolveRelativeDate(dateStr, telegramDate);
        if (relativeDate) {
          finalDate = relativeDate;
          source = 'caption';
          captionCount++;
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
  console.log(`   From Jalali (AI): ${jalaliCount}`);
  console.log(`   From relative (AI): ${relativeCount}`);
  console.log(`   From caption: ${captionCount}`);
  console.log(`   Telegram fallback: ${fallbackCount}`);
}
