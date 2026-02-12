import Database from 'better-sqlite3';
import fs from 'fs-extra';
import path from 'path';
import type { Config, Album, AlbumsData, LocationInfo } from '../types.js';
import { Logger, StatsTracker, sleep } from '../utils.js';
import { queryAI, getProviderDisplayName } from '../ai-provider.js';

// Hardcoded fallback translations (used when DB is unavailable)
const PERSIAN_TO_ENGLISH: Record<string, string> = {
  // Major cities
  'تهران': 'Tehran', 'اصفهان': 'Isfahan', 'شیراز': 'Shiraz',
  'مشهد': 'Mashhad', 'تبریز': 'Tabriz', 'کرج': 'Karaj',
  'قم': 'Qom', 'اهواز': 'Ahvaz', 'کرمان': 'Kerman',
  'رشت': 'Rasht', 'همدان': 'Hamadan', 'یزد': 'Yazd',
  'کرمانشاه': 'Kermanshah', 'ارومیه': 'Urmia', 'زاهدان': 'Zahedan',
  'سنندج': 'Sanandaj', 'بندرعباس': 'Bandar Abbas', 'اردبیل': 'Ardabil',
  'قزوین': 'Qazvin', 'زنجان': 'Zanjan', 'گرگان': 'Gorgan',
  'ساری': 'Sari', 'بوشهر': 'Bushehr', 'خرم‌آباد': 'Khorramabad',
  'خرمآباد': 'Khorramabad',
  // Other cities
  'آمل': 'Amol', 'بابل': 'Babol', 'نوشهر': 'Nowshahr',
  'چالوس': 'Chalus', 'تنکابن': 'Tonekabon', 'رامسر': 'Ramsar',
  'بابلسر': 'Babolsar', 'قائمشهر': 'Ghaemshahr',
  'لاهیجان': 'Lahijan', 'انزلی': 'Anzali', 'بندر انزلی': 'Bandar Anzali',
  'آستارا': 'Astara', 'کاشان': 'Kashan', 'نیشابور': 'Nishapur',
  'سبزوار': 'Sabzevar', 'بیرجند': 'Birjand',
  'آبادان': 'Abadan', 'خرمشهر': 'Khorramshahr', 'دزفول': 'Dezful',
  'مراغه': 'Maragheh', 'مرند': 'Marand', 'خوی': 'Khoy',
  'مهاباد': 'Mahabad', 'ایلام': 'Ilam', 'بجنورد': 'Bojnord',
  'یاسوج': 'Yasuj', 'شهرکرد': 'Shahrekord', 'سمنان': 'Semnan',
  // Tehran neighborhoods
  'صادقیه': 'Sadeghieh', 'نارمک': 'Narmak', 'ونک': 'Vanak',
  'تجریش': 'Tajrish', 'ولیعصر': 'Valiasr', 'پونک': 'Punak',
  'سعادت‌آباد': 'Saadat Abad', 'سعادتآباد': 'Saadat Abad',
  'تهرانپارس': 'Tehranpars', 'تهران‌پارس': 'Tehranpars',
  'پیروزی': 'Piroozi', 'شهرک غرب': 'Shahrak-e Gharb',
  'اکباتان': 'Ekbatan', 'شهران': 'Shahran', 'ستارخان': 'Sattarkhan',
  'آزادی': 'Azadi', 'انقلاب': 'Enghelab', 'یوسف‌آباد': 'Yousefabad',
  'میرداماد': 'Mirdamad', 'الهیه': 'Elahieh', 'زعفرانیه': 'Zafaraniyeh',
  'نیاوران': 'Niavaran', 'فرمانیه': 'Farmaniyeh', 'قیطریه': 'Gheytarieh',
  'پاسداران': 'Pasdaran', 'شریعتی': 'Shariati',
  'آریاشهر': 'Ariashahr', 'جنت‌آباد': 'Jannat Abad', 'جنتآباد': 'Jannat Abad',
  // Cities
  'اراک': 'Arak', 'بروجرد': 'Borujerd', 'اسلامشهر': 'Eslamshahr', 'فردیس': 'Fardis',
  // Provinces
  'گیلان': 'Gilan', 'مازندران': 'Mazandaran',
  'آذربایجان شرقی': 'East Azerbaijan', 'آذربایجان غربی': 'West Azerbaijan',
  'خراسان رضوی': 'Razavi Khorasan', 'فارس': 'Fars',
  'خوزستان': 'Khuzestan', 'البرز': 'Alborz',
  // Country
  'ایران': 'Iran',
};

// Hardcoded province mapping for major cities (overrides DB which has duplicates with wrong province)
const CITY_PROVINCE: Record<string, { province_fa: string; province_en: string }> = {
  'تهران': { province_fa: 'استان تهران', province_en: 'Tehran Province' },
  'مشهد': { province_fa: 'استان خراسان رضوی', province_en: 'Razavi Khorasan Province' },
  'اصفهان': { province_fa: 'استان اصفهان', province_en: 'Isfahan Province' },
  'شیراز': { province_fa: 'استان فارس', province_en: 'Fars Province' },
  'تبریز': { province_fa: 'استان آذربایجان شرقی', province_en: 'East Azerbaijan Province' },
  'کرج': { province_fa: 'استان البرز', province_en: 'Alborz Province' },
  'قم': { province_fa: 'استان قم', province_en: 'Qom Province' },
  'اهواز': { province_fa: 'استان خوزستان', province_en: 'Khuzestan Province' },
  'کرمان': { province_fa: 'استان کرمان', province_en: 'Kerman Province' },
  'رشت': { province_fa: 'استان گیلان', province_en: 'Gilan Province' },
  'همدان': { province_fa: 'استان همدان', province_en: 'Hamadan Province' },
  'یزد': { province_fa: 'استان یزد', province_en: 'Yazd Province' },
  'کرمانشاه': { province_fa: 'استان کرمانشاه', province_en: 'Kermanshah Province' },
  'ارومیه': { province_fa: 'استان آذربایجان غربی', province_en: 'West Azerbaijan Province' },
  'زاهدان': { province_fa: 'استان سیستان و بلوچستان', province_en: 'Sistan and Baluchestan Province' },
  'سنندج': { province_fa: 'استان کردستان', province_en: 'Kurdistan Province' },
  'بندرعباس': { province_fa: 'استان هرمزگان', province_en: 'Hormozgan Province' },
  'اردبیل': { province_fa: 'استان اردبیل', province_en: 'Ardabil Province' },
  'قزوین': { province_fa: 'استان قزوین', province_en: 'Qazvin Province' },
  'زنجان': { province_fa: 'استان زنجان', province_en: 'Zanjan Province' },
  'گرگان': { province_fa: 'استان گلستان', province_en: 'Golestan Province' },
  'ساری': { province_fa: 'استان مازندران', province_en: 'Mazandaran Province' },
  'بوشهر': { province_fa: 'استان بوشهر', province_en: 'Bushehr Province' },
  'خرم‌آباد': { province_fa: 'استان لرستان', province_en: 'Lorestan Province' },
  'خرمآباد': { province_fa: 'استان لرستان', province_en: 'Lorestan Province' },
  'کاشان': { province_fa: 'استان اصفهان', province_en: 'Isfahan Province' },
  'نیشابور': { province_fa: 'استان خراسان رضوی', province_en: 'Razavi Khorasan Province' },
  'سبزوار': { province_fa: 'استان خراسان رضوی', province_en: 'Razavi Khorasan Province' },
  'بیرجند': { province_fa: 'استان خراسان جنوبی', province_en: 'South Khorasan Province' },
  'آبادان': { province_fa: 'استان خوزستان', province_en: 'Khuzestan Province' },
  'خرمشهر': { province_fa: 'استان خوزستان', province_en: 'Khuzestan Province' },
  'دزفول': { province_fa: 'استان خوزستان', province_en: 'Khuzestan Province' },
  'ایلام': { province_fa: 'استان ایلام', province_en: 'Ilam Province' },
  'بجنورد': { province_fa: 'استان خراسان شمالی', province_en: 'North Khorasan Province' },
  'یاسوج': { province_fa: 'استان کهگیلویه و بویراحمد', province_en: 'Kohgiluyeh and Boyer-Ahmad Province' },
  'شهرکرد': { province_fa: 'استان چهارمحال و بختیاری', province_en: 'Chaharmahal and Bakhtiari Province' },
  'سمنان': { province_fa: 'استان سمنان', province_en: 'Semnan Province' },
  'ورامین': { province_fa: 'استان تهران', province_en: 'Tehran Province' },
  'نظرآباد': { province_fa: 'استان البرز', province_en: 'Alborz Province' },
  'آمل': { province_fa: 'استان مازندران', province_en: 'Mazandaran Province' },
  'بابل': { province_fa: 'استان مازندران', province_en: 'Mazandaran Province' },
  'قائمشهر': { province_fa: 'استان مازندران', province_en: 'Mazandaran Province' },
  'لاهیجان': { province_fa: 'استان گیلان', province_en: 'Gilan Province' },
  'مهاباد': { province_fa: 'استان آذربایجان غربی', province_en: 'West Azerbaijan Province' },
  'خوی': { province_fa: 'استان آذربایجان غربی', province_en: 'West Azerbaijan Province' },
  'مراغه': { province_fa: 'استان آذربایجان شرقی', province_en: 'East Azerbaijan Province' },
  'مرند': { province_fa: 'استان آذربایجان شرقی', province_en: 'East Azerbaijan Province' },
  'اراک': { province_fa: 'استان مرکزی', province_en: 'Markazi Province' },
  'بروجرد': { province_fa: 'استان لرستان', province_en: 'Lorestan Province' },
  'اسلامشهر': { province_fa: 'استان تهران', province_en: 'Tehran Province' },
  'فردیس': { province_fa: 'استان البرز', province_en: 'Alborz Province' },
};

// Iran locations database — provides translations, province mapping, and coordinates
class IranLocationsDB {
  private db: Database.Database | null = null;
  private translationMap: Map<string, string> = new Map();
  private coordinateMap: Map<string, { lat: number; lon: number }> = new Map();
  private cityToProvinceMap: Map<string, { province_fa: string; province_en: string }> = new Map();

  constructor(dbPath: string) {
    if (fs.existsSync(dbPath)) {
      this.db = new Database(dbPath, { readonly: true });
      this.loadData();
      this.loadCityToProvinceMapping();
    }
  }

  private loadData(): void {
    if (!this.db) return;

    const rows = this.db.prepare(`
      SELECT name_fa, name_en, latitude, longitude
      FROM locations
      WHERE name_en IS NOT NULL
      ORDER BY population DESC
    `).all() as Array<{ name_fa: string; name_en: string; latitude: number; longitude: number }>;

    for (const row of rows) {
      if (!this.translationMap.has(row.name_fa)) {
        this.translationMap.set(row.name_fa, row.name_en);
        if (row.latitude && row.longitude) {
          this.coordinateMap.set(row.name_fa, { lat: row.latitude, lon: row.longitude });
        }
      }
    }
  }

  private loadCityToProvinceMapping(): void {
    if (!this.db) return;

    const cities = this.db.prepare(`
      SELECT name_fa as city_fa, province_code
      FROM locations
      WHERE admin_level IN (1, 2) AND province_code IS NOT NULL
      ORDER BY population DESC
    `).all() as Array<{ city_fa: string; province_code: string }>;

    const provinces = this.db.prepare(`
      SELECT province_code, name_fa, name_en,
        CASE WHEN name_fa LIKE 'استان%' THEN 0 ELSE 1 END as priority
      FROM locations
      WHERE admin_level = 0 AND province_code IS NOT NULL
      ORDER BY priority ASC, LENGTH(name_fa) ASC
    `).all() as Array<{ province_code: string; name_fa: string; name_en: string }>;

    const provinceCodeMap = new Map<string, { province_fa: string; province_en: string }>();
    for (const p of provinces) {
      if (!provinceCodeMap.has(p.province_code)) {
        provinceCodeMap.set(p.province_code, {
          province_fa: p.name_fa,
          province_en: p.name_en,
        });
      }
    }

    for (const city of cities) {
      if (!this.cityToProvinceMap.has(city.city_fa)) {
        const province = provinceCodeMap.get(city.province_code);
        if (province) {
          this.cityToProvinceMap.set(city.city_fa, province);
        }
      }
    }
  }

  getEnglish(persianName: string): string | undefined {
    return this.translationMap.get(persianName);
  }

  getCoordinates(persianName: string): { lat: number; lon: number } | undefined {
    return this.coordinateMap.get(persianName);
  }

  getProvinceForCity(cityFa: string): { province_fa: string; province_en: string } | undefined {
    return this.cityToProvinceMap.get(cityFa);
  }

  isAvailable(): boolean {
    return this.db !== null;
  }

  close(): void {
    this.db?.close();
  }
}

// Translate a Persian name using DB, then hardcoded map
function translateName(
  persianName: string | undefined,
  locationsDB: IranLocationsDB
): string | undefined {
  if (!persianName) return undefined;
  return locationsDB.getEnglish(persianName) || PERSIAN_TO_ENGLISH[persianName] || undefined;
}

// Known Tehran neighborhoods for caption extraction (area-level, not city-level)
const TEHRAN_NEIGHBORHOODS = new Set([
  'صادقیه', 'نارمک', 'ونک', 'تجریش', 'ولیعصر', 'پونک',
  'سعادت‌آباد', 'سعادتآباد', 'تهرانپارس', 'تهران‌پارس',
  'پیروزی', 'شهرک غرب', 'اکباتان', 'شهران', 'ستارخان',
  'آزادی', 'انقلاب', 'یوسف‌آباد', 'میرداماد', 'الهیه',
  'زعفرانیه', 'نیاوران', 'فرمانیه', 'قیطریه', 'پاسداران',
  'شریعتی', 'گیشا', 'هفت‌حوض', 'فلکه',
  'آریاشهر', 'جنت‌آباد', 'جنتآباد',
]);

// Build curated set of known location names (no tiny villages that match common words)
const KNOWN_LOCATIONS = new Set([
  ...Object.keys(PERSIAN_TO_ENGLISH).filter(k => k !== 'ایران'),
  ...Object.keys(CITY_PROVINCE),
]);

// Extract locations directly from caption text (fallback when AI didn't extract)
function extractLocationsFromCaption(
  caption: string,
  locationsDB: IranLocationsDB
): LocationInfo | null {
  if (!caption) return null;

  // Clean: remove hashtags but keep the word, remove emojis/special chars
  const cleaned = caption.replace(/#/g, '').replace(/[⚠️🔸🔹♦️📡]/g, '');

  // Split into tokens (words) — keep ZWNJ (\u200c) inside words for compound names like جنت‌آباد
  const words = cleaned.split(/[\s,،.؛:!؟\-\(\)\[\]«»"']+/).filter(w => w.length >= 2);

  let cityFa: string | undefined;
  let areaFa: string | undefined;

  // Check multi-word combos first (e.g., "بندر عباس", "شهرک غرب")
  for (let i = 0; i < words.length - 1; i++) {
    const twoWord = `${words[i]} ${words[i + 1]}`;
    const threeWord = i < words.length - 2 ? `${words[i]} ${words[i + 1]} ${words[i + 2]}` : '';
    for (const combo of [threeWord, twoWord]) {
      if (!combo) continue;
      if (KNOWN_LOCATIONS.has(combo) || TEHRAN_NEIGHBORHOODS.has(combo)) {
        if (TEHRAN_NEIGHBORHOODS.has(combo)) {
          areaFa = combo;
          if (!cityFa) cityFa = 'تهران';
        } else if (!cityFa) {
          cityFa = combo;
        }
      }
    }
  }

  // Check single words — only match curated lists, NOT the full DB (avoids "گفت", "در", etc.)
  for (const word of words) {
    if (KNOWN_LOCATIONS.has(word)) {
      if (TEHRAN_NEIGHBORHOODS.has(word)) {
        if (!areaFa) areaFa = word;
        if (!cityFa) cityFa = 'تهران';
      } else if (!cityFa) {
        cityFa = word;
      }
    } else if (TEHRAN_NEIGHBORHOODS.has(word)) {
      if (!areaFa) areaFa = word;
      if (!cityFa) cityFa = 'تهران';
    }
  }

  if (!cityFa) return null;

  const result: LocationInfo = {
    country_fa: 'ایران',
    country_en: 'Iran',
    city_fa: cityFa,
    city_en: translateName(cityFa, locationsDB) || cityFa,
  };

  // Add province — hardcoded map first, then DB
  const province = CITY_PROVINCE[cityFa] || locationsDB.getProvinceForCity(cityFa);
  if (province) {
    result.province_fa = province.province_fa;
    result.province_en = province.province_en;
  }

  // Add coordinates
  const coords = locationsDB.getCoordinates(cityFa);
  if (coords) {
    result.lat = coords.lat;
    result.lon = coords.lon;
  }

  // Add area
  if (areaFa) {
    result.area_fa = areaFa;
    result.area_en = translateName(areaFa, locationsDB) || areaFa;
    const areaCoords = locationsDB.getCoordinates(areaFa);
    if (areaCoords) {
      result.lat = areaCoords.lat;
      result.lon = areaCoords.lon;
    }
  }

  return result;
}

// Resolve a single album's locations from the local DB (instant, no API calls)
function resolveFromDB(
  locations: LocationInfo,
  locationsDB: IranLocationsDB
): { geocoded: LocationInfo; untranslated: string[] } {
  const untranslated: string[] = [];

  const geocoded: LocationInfo = {
    country_fa: locations.country_fa || 'ایران',
    country_en: locations.country_en || 'Iran',
  };

  // Foreign locations — pass through as-is
  if (geocoded.country_fa === 'سایر' || geocoded.country_en === 'Other') {
    geocoded.country_fa = 'سایر';
    geocoded.country_en = 'Other';
    if (locations.city_fa) {
      geocoded.city_fa = locations.city_fa;
      geocoded.city_en = locations.city_en || translateName(locations.city_fa, locationsDB);
      if (!geocoded.city_en) untranslated.push(locations.city_fa);
    }
    return { geocoded, untranslated };
  }

  // City
  if (locations.city_fa) {
    geocoded.city_fa = locations.city_fa;
    geocoded.city_en = locations.city_en || translateName(locations.city_fa, locationsDB);
    if (!geocoded.city_en) {
      untranslated.push(locations.city_fa);
    }

    // Province from city — hardcoded map first, then DB
    const province = CITY_PROVINCE[locations.city_fa] || locationsDB.getProvinceForCity(locations.city_fa);
    if (province) {
      geocoded.province_fa = province.province_fa;
      geocoded.province_en = province.province_en;
    } else if (locations.province_fa) {
      geocoded.province_fa = locations.province_fa;
      geocoded.province_en = locations.province_en || translateName(locations.province_fa, locationsDB);
      if (!geocoded.province_en) untranslated.push(locations.province_fa);
    }

    // Coordinates from city
    const coords = locationsDB.getCoordinates(locations.city_fa);
    if (coords) {
      geocoded.lat = coords.lat;
      geocoded.lon = coords.lon;
    }
  }

  // Area/neighborhood
  if (locations.area_fa) {
    geocoded.area_fa = locations.area_fa;
    geocoded.area_en = locations.area_en || translateName(locations.area_fa, locationsDB);
    if (!geocoded.area_en) {
      untranslated.push(locations.area_fa);
    }

    // Try more specific coordinates from area
    const areaCoords = locationsDB.getCoordinates(locations.area_fa);
    if (areaCoords) {
      geocoded.lat = areaCoords.lat;
      geocoded.lon = areaCoords.lon;
    }
  }

  return { geocoded, untranslated };
}

// Batch translate Persian location names using AI
async function batchTranslateWithAI(
  config: Config,
  names: string[]
): Promise<Map<string, string>> {
  const results = new Map<string, string>();
  if (names.length === 0) return results;

  const batchSize = 30;
  const concurrency = config.ai.provider === 'ollama' ? 1 : 3;

  for (let i = 0; i < names.length; i += batchSize * concurrency) {
    const batchGroup = names.slice(i, i + batchSize * concurrency);
    const batches: string[][] = [];

    for (let j = 0; j < batchGroup.length; j += batchSize) {
      batches.push(batchGroup.slice(j, j + batchSize));
    }

    const batchResults = await Promise.all(
      batches.map(batch => {
        const nameList = batch.map((n, idx) => `${idx + 1}. ${n}`).join('\n');
        const prompt = `Transliterate these Persian/Iranian location names to English. These are cities, neighborhoods, streets, and areas in Iran.

Return ONLY a JSON object mapping each Persian name to its English transliteration.

Names:
${nameList}

Example format: {"نارمک": "Narmak", "صادقیه": "Sadeghieh"}`;
        return queryAI(config, prompt, 500);
      })
    );

    for (const result of batchResults) {
      if (!result.success) continue;

      try {
        let parsed: Record<string, string>;
        try {
          parsed = JSON.parse(result.text);
        } catch {
          // Try extracting JSON from the response
          const startIdx = result.text.indexOf('{');
          const endIdx = result.text.lastIndexOf('}');
          if (startIdx === -1 || endIdx === -1) continue;
          parsed = JSON.parse(result.text.substring(startIdx, endIdx + 1));
        }

        for (const [fa, en] of Object.entries(parsed)) {
          if (typeof en === 'string' && en.trim()) {
            results.set(fa, en.trim());
          }
        }
      } catch {
        // Failed to parse AI response for this batch
      }
    }

    if (i + batchSize * concurrency < names.length) {
      await sleep(500);
    }
  }

  return results;
}

export interface GeocodeOptions {
  resume: boolean;
  dryRun: boolean;
}

export async function geocode(config: Config, options: GeocodeOptions): Promise<void> {
  const logger = new Logger(config.paths.raw);
  const stats = new StatsTracker();

  const albumsPath = path.join(config.paths.raw, 'albums.json');
  const locationsDBPath = path.join(process.cwd(), 'data', 'iran-locations.sqlite');

  if (!await fs.pathExists(albumsPath)) {
    console.error('✗ No albums.json found. Run download first.');
    process.exit(1);
  }

  const albumsData: AlbumsData = await fs.readJson(albumsPath);
  const locationsDB = new IranLocationsDB(locationsDBPath);

  console.log('🌍 Geocoding locations...');
  console.log(`   Method: Local DB + AI translation (${getProviderDisplayName(config.ai.provider)})`);
  console.log(`   Albums: ${albumsData.albums.length}`);
  console.log(`   Dry run: ${options.dryRun}`);
  if (locationsDB.isAvailable()) {
    console.log('   Iran locations database: loaded');
  } else {
    console.log('   ⚠ Iran locations database not found. Run: npx tsx scripts/download-locations.ts');
  }

  // Phase 1: Resolve all locations from local DB (instant)
  console.log('\n   Phase 1: Resolving from local database...');

  const allUntranslated = new Set<string>();
  const albumsToProcess: Album[] = [];
  let skipped = 0;
  let noLocation = 0;
  let dbResolved = 0;
  let captionResolved = 0;

  for (const album of albumsData.albums) {
    if (options.resume && album.geocoded && Object.keys(album.geocoded).length > 0) {
      skipped++;
      continue;
    }

    let locations = album.analysis?.locations;
    let fromCaption = false;

    // Fallback: extract locations from caption if AI analysis didn't find any
    if (!locations || Object.keys(locations).length === 0) {
      const captionLoc = extractLocationsFromCaption(album.caption_fa, locationsDB);
      if (captionLoc) {
        locations = captionLoc;
        fromCaption = true;
      } else {
        album.geocoded = {};
        noLocation++;
        continue;
      }
    }

    if (fromCaption) {
      // Caption extraction already returns full LocationInfo, use directly
      if (options.dryRun) {
        console.log(`   [DRY RUN] ${album.album_id}: ${locations.city_fa || '?'} → ${locations.city_en || '?'} (from caption)`);
        captionResolved++;
        continue;
      }
      album.geocoded = locations;
      captionResolved++;
      stats.increment('albums_total');
      continue;
    }

    const { geocoded, untranslated } = resolveFromDB(locations, locationsDB);

    if (options.dryRun) {
      console.log(`   [DRY RUN] ${album.album_id}: ${geocoded.city_fa || '?'} → ${geocoded.city_en || '(needs AI)'}`);
      for (const name of untranslated) allUntranslated.add(name);
      dbResolved++;
      continue;
    }

    album.geocoded = geocoded;

    for (const name of untranslated) {
      allUntranslated.add(name);
    }

    albumsToProcess.push(album);
    dbResolved++;
    stats.increment('albums_total');
  }

  console.log(`   From AI analysis: ${dbResolved} albums`);
  console.log(`   From caption fallback: ${captionResolved} albums`);
  console.log(`   Skipped (already done): ${skipped}`);
  console.log(`   No location data: ${noLocation}`);

  // Phase 2: AI batch translation for unknown names
  if (allUntranslated.size > 0 && !options.dryRun) {
    console.log(`\n   Phase 2: AI translating ${allUntranslated.size} unknown names...`);

    const translations = await batchTranslateWithAI(config, [...allUntranslated]);

    console.log(`   Translated: ${translations.size}/${allUntranslated.size} names`);

    // Apply translations to all processed albums
    let applied = 0;
    for (const album of albumsToProcess) {
      if (!album.geocoded) continue;
      let changed = false;

      if (album.geocoded.city_fa && !album.geocoded.city_en) {
        const en = translations.get(album.geocoded.city_fa);
        if (en) { album.geocoded.city_en = en; changed = true; }
      }
      if (album.geocoded.area_fa && !album.geocoded.area_en) {
        const en = translations.get(album.geocoded.area_fa);
        if (en) { album.geocoded.area_en = en; changed = true; }
      }
      if (album.geocoded.province_fa && !album.geocoded.province_en) {
        const en = translations.get(album.geocoded.province_fa);
        if (en) { album.geocoded.province_en = en; changed = true; }
      }

      if (changed) applied++;
    }

    console.log(`   Applied to: ${applied} albums`);

    for (const name of allUntranslated) {
      if (!translations.has(name)) {
        logger.log('geocode', 'warning', `Could not translate: ${name}`, '');
        stats.increment('warnings');
      }
    }
  } else if (allUntranslated.size > 0 && options.dryRun) {
    console.log(`\n   Phase 2: [DRY RUN] Would AI-translate ${allUntranslated.size} names:`);
    for (const name of allUntranslated) {
      console.log(`     - ${name}`);
    }
  } else if (!options.dryRun) {
    console.log('\n   Phase 2: All names resolved from DB, no AI needed');
  }

  // Log results
  for (const album of albumsToProcess) {
    if (!album.geocoded) continue;
    const g = album.geocoded;
    logger.log('geocode', 'success',
      `${g.province_en || ''} / ${g.city_en || g.city_fa || ''} / ${g.area_en || g.area_fa || ''}`,
      album.album_id
    );
  }

  locationsDB.close();

  if (!options.dryRun) {
    await fs.writeJson(albumsPath, albumsData, { spaces: 2 });
    await logger.save();
  }

  console.log(`\n✓ Geocoding complete`);
  console.log(`   From AI analysis: ${dbResolved}`);
  console.log(`   From caption fallback: ${captionResolved}`);
  console.log(`   Skipped (already done): ${skipped}`);
  console.log(`   No location data: ${noLocation}`);
  if (allUntranslated.size > 0) {
    console.log(`   AI-translated: ${allUntranslated.size} unique names`);
  }
  stats.print();
}
