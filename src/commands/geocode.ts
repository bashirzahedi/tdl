import axios from 'axios';
import Database from 'better-sqlite3';
import fs from 'fs-extra';
import path from 'path';
import type { Config, AlbumsData, LocationInfo, GeocodeCacheEntry } from '../types.js';
import { Logger, RateLimiter, StatsTracker } from '../utils.js';

const CACHE_TTL_DAYS = 30;
const NOMINATIM_TIMEOUT = 10000;

// Common Persian location names with their English equivalents
const PERSIAN_TO_ENGLISH: Record<string, string> = {
  // Major cities
  'تهران': 'Tehran',
  'اصفهان': 'Isfahan',
  'شیراز': 'Shiraz',
  'مشهد': 'Mashhad',
  'تبریز': 'Tabriz',
  'کرج': 'Karaj',
  'قم': 'Qom',
  'اهواز': 'Ahvaz',
  'کرمان': 'Kerman',
  'رشت': 'Rasht',
  'همدان': 'Hamadan',
  'یزد': 'Yazd',
  'کرمانشاه': 'Kermanshah',
  'ارومیه': 'Urmia',
  'زاهدان': 'Zahedan',
  'سنندج': 'Sanandaj',
  'بندرعباس': 'Bandar Abbas',
  'اردبیل': 'Ardabil',
  'قزوین': 'Qazvin',
  'زنجان': 'Zanjan',
  'گرگان': 'Gorgan',
  'ساری': 'Sari',
  'بوشهر': 'Bushehr',
  'خرم‌آباد': 'Khorramabad',
  'خرمآباد': 'Khorramabad',
  // Mazandaran cities
  'آمل': 'Amol',
  'بابل': 'Babol',
  'نوشهر': 'Nowshahr',
  'چالوس': 'Chalus',
  'تنکابن': 'Tonekabon',
  'رامسر': 'Ramsar',
  'بابلسر': 'Babolsar',
  'قائمشهر': 'Ghaemshahr',
  // Gilan cities
  'لاهیجان': 'Lahijan',
  'انزلی': 'Anzali',
  'بندر انزلی': 'Bandar Anzali',
  'آستارا': 'Astara',
  'رودسر': 'Rudsar',
  'فومن': 'Fuman',
  'طالش': 'Talesh',
  // Isfahan cities
  'کاشان': 'Kashan',
  'نجف‌آباد': 'Najafabad',
  'خمینی‌شهر': 'Khomeinishahr',
  'شاهین‌شهر': 'Shahinshahr',
  // Khorasan cities
  'نیشابور': 'Nishapur',
  'سبزوار': 'Sabzevar',
  'تربت حیدریه': 'Torbat-e Heydarieh',
  'قوچان': 'Quchan',
  'گناباد': 'Gonabad',
  'بیرجند': 'Birjand',
  // Fars cities
  'مرودشت': 'Marvdasht',
  'جهرم': 'Jahrom',
  'لار': 'Lar',
  'فسا': 'Fasa',
  'داراب': 'Darab',
  // Khuzestan cities
  'آبادان': 'Abadan',
  'خرمشهر': 'Khorramshahr',
  'دزفول': 'Dezful',
  'شوش': 'Shush',
  'ماهشهر': 'Mahshahr',
  'بهبهان': 'Behbahan',
  // East Azerbaijan cities
  'مراغه': 'Maragheh',
  'مرند': 'Marand',
  'میانه': 'Mianeh',
  'اهر': 'Ahar',
  'بناب': 'Bonab',
  // West Azerbaijan cities
  'خوی': 'Khoy',
  'میاندوآب': 'Miandoab',
  'بوکان': 'Bukan',
  'مهاباد': 'Mahabad',
  'سلماس': 'Salmas',
  // Other cities
  'ایلام': 'Ilam',
  'بجنورد': 'Bojnord',
  'یاسوج': 'Yasuj',
  'شهرکرد': 'Shahrekord',
  'سمنان': 'Semnan',
  // Tehran neighborhoods
  'صادقیه': 'Sadeghieh',
  'نارمک': 'Narmak',
  'ونک': 'Vanak',
  'تجریش': 'Tajrish',
  'ولیعصر': 'Valiasr',
  'پونک': 'Punak',
  'سعادت‌آباد': 'Saadat Abad',
  'سعادتآباد': 'Saadat Abad',
  'تهرانپارس': 'Tehranpars',
  'تهران‌پارس': 'Tehranpars',
  'پیروزی': 'Piroozi',
  'جنت‌آباد': 'Jannat Abad',
  'شهرک غرب': 'Shahrak-e Gharb',
  'اکباتان': 'Ekbatan',
  'شهران': 'Shahran',
  'ستارخان': 'Sattarkhan',
  'آزادی': 'Azadi',
  'انقلاب': 'Enghelab',
  'امیرآباد': 'Amir Abad',
  'یوسف‌آباد': 'Yousefabad',
  'میرداماد': 'Mirdamad',
  'الهیه': 'Elahieh',
  'زعفرانیه': 'Zafaraniyeh',
  'نیاوران': 'Niavaran',
  'فرمانیه': 'Farmaniyeh',
  'قیطریه': 'Gheytarieh',
  'پاسداران': 'Pasdaran',
  'شریعتی': 'Shariati',
  'هفت‌تیر': 'Haft-e Tir',
  // Provinces
  'گیلان': 'Gilan',
  'مازندران': 'Mazandaran',
  'آذربایجان شرقی': 'East Azerbaijan',
  'آذربایجان غربی': 'West Azerbaijan',
  'خراسان رضوی': 'Razavi Khorasan',
  'فارس': 'Fars',
  'خوزستان': 'Khuzestan',
  'البرز': 'Alborz',
  // Country
  'ایران': 'Iran',
};

// Iran locations database for English translations and province lookups
class IranLocationsDB {
  private db: Database.Database | null = null;
  private translationMap: Map<string, string> = new Map();
  private cityToProvinceMap: Map<string, { province_fa: string; province_en: string }> = new Map();

  constructor(dbPath: string) {
    if (fs.existsSync(dbPath)) {
      this.db = new Database(dbPath, { readonly: true });
      this.loadTranslations();
      this.loadCityToProvinceMapping();
    }
  }

  private loadTranslations(): void {
    if (!this.db) return;

    const rows = this.db.prepare(`
      SELECT name_fa, name_en FROM locations
      WHERE name_en IS NOT NULL
      ORDER BY population DESC
    `).all() as Array<{ name_fa: string; name_en: string }>;

    for (const row of rows) {
      if (!this.translationMap.has(row.name_fa)) {
        this.translationMap.set(row.name_fa, row.name_en);
      }
    }
  }

  private loadCityToProvinceMapping(): void {
    if (!this.db) return;

    // Get all cities (admin_level 1 and 2) with their province codes, prioritized by population
    const cities = this.db.prepare(`
      SELECT c.name_fa as city_fa, c.province_code
      FROM locations c
      WHERE c.admin_level IN (1, 2) AND c.province_code IS NOT NULL
      ORDER BY c.population DESC
    `).all() as Array<{ city_fa: string; province_code: string }>;

    // Get province names for each province code
    // Prefer names starting with استان (standard Persian province prefix)
    const provinces = this.db.prepare(`
      SELECT province_code, name_fa, name_en,
        CASE WHEN name_fa LIKE 'استان%' THEN 0 ELSE 1 END as priority
      FROM locations
      WHERE admin_level = 0 AND province_code IS NOT NULL
      ORDER BY priority ASC, LENGTH(name_fa) ASC
    `).all() as Array<{ province_code: string; name_fa: string; name_en: string }>;

    // Build province code to name map (prefer استان prefix for proper province names)
    const provinceCodeMap = new Map<string, { province_fa: string; province_en: string }>();
    for (const p of provinces) {
      if (!provinceCodeMap.has(p.province_code)) {
        provinceCodeMap.set(p.province_code, {
          province_fa: p.name_fa,
          province_en: p.name_en,
        });
      }
    }

    // Build city to province mapping
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

  // Look up the province for a given city name
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

interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
  address?: {
    country?: string;
    state?: string;
    province?: string;
    county?: string;
    city?: string;
    town?: string;
    village?: string;
    suburb?: string;
    neighbourhood?: string;
    district?: string;
    quarter?: string;
  };
}

class GeocodeCache {
  private db: Database.Database;

  constructor(cachePath: string) {
    fs.ensureDirSync(path.dirname(cachePath));
    this.db = new Database(cachePath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS geocode_cache (
        query TEXT PRIMARY KEY,
        result TEXT,
        created_at INTEGER
      )
    `);
  }

  get(query: string): LocationInfo | null | undefined {
    const ttlCutoff = Date.now() - (CACHE_TTL_DAYS * 24 * 60 * 60 * 1000);
    const row = this.db.prepare(`
      SELECT result, created_at FROM geocode_cache
      WHERE query = ? AND created_at > ?
    `).get(query, ttlCutoff) as { result: string; created_at: number } | undefined;

    if (!row) return undefined;
    return JSON.parse(row.result) as LocationInfo | null;
  }

  set(query: string, result: LocationInfo | null): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO geocode_cache (query, result, created_at)
      VALUES (?, ?, ?)
    `).run(query, JSON.stringify(result), Date.now());
  }

  close(): void {
    this.db.close();
  }
}

async function queryNominatim(
  query: string,
  userAgent: string,
  lang: 'en' | 'fa' = 'en'
): Promise<NominatimResult | null> {
  try {
    const response = await axios.get<NominatimResult[]>(
      'https://nominatim.openstreetmap.org/search',
      {
        params: {
          format: 'json',
          q: query,
          countrycodes: 'IR',
          addressdetails: 1,
          limit: 1,
        },
        headers: {
          'User-Agent': userAgent,
          'Accept-Language': lang,
        },
        timeout: NOMINATIM_TIMEOUT,
      }
    );

    if (response.data.length > 0) {
      return response.data[0];
    }
    return null;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`   Nominatim error: ${errorMsg}`);
    return null;
  }
}

function buildSearchQuery(locations: LocationInfo): string {
  const parts: string[] = [];

  // Most specific first for better Nominatim results
  if (locations.area_fa) parts.push(locations.area_fa);
  if (locations.city_fa) parts.push(locations.city_fa);

  // Add Iran/ایران for better results
  parts.push('ایران');

  return parts.join(', ');
}

function extractAddressFromResult(result: NominatimResult): Partial<LocationInfo> {
  const addr = result.address || {};

  // Extract with proper hierarchy: country > province/state > city > area
  // Skip 'district' - it returns unhelpful values like "District 2"
  // Only use suburb/neighbourhood which have actual place names
  const area = addr.suburb || addr.neighbourhood || addr.quarter;

  // Filter out generic district names like "District 2", "District 4", etc.
  const isGenericDistrict = area && /^district\s*\d+$/i.test(area);

  return {
    country_en: addr.country,
    province_en: addr.state || addr.province,
    city_en: addr.city || addr.town || addr.village || addr.county,
    area_en: isGenericDistrict ? undefined : area,
    lat: parseFloat(result.lat),
    lon: parseFloat(result.lon),
  };
}

// Get English translation: try Nominatim, then local DB, then hardcoded map
function getEnglishName(
  nominatimEn: string | undefined,
  farsi: string | undefined,
  locationsDB?: IranLocationsDB
): string | undefined {
  if (nominatimEn) return nominatimEn;
  if (farsi && locationsDB?.isAvailable()) {
    const dbName = locationsDB.getEnglish(farsi);
    if (dbName) return dbName;
  }
  if (farsi && PERSIAN_TO_ENGLISH[farsi]) return PERSIAN_TO_ENGLISH[farsi];
  return undefined;
}

// Enrich location data with province from database when province is missing
function enrichWithProvinceFromDB(
  locations: LocationInfo,
  locationsDB?: IranLocationsDB
): LocationInfo {
  // If we already have province, return as-is
  if (locations.province_fa || locations.province_en) {
    return locations;
  }

  // Try to look up province using city name
  const cityFa = locations.city_fa;
  if (cityFa && locationsDB?.isAvailable()) {
    const provinceInfo = locationsDB.getProvinceForCity(cityFa);
    if (provinceInfo) {
      return {
        ...locations,
        province_fa: provinceInfo.province_fa,
        province_en: provinceInfo.province_en,
      };
    }
  }

  return locations;
}

function mergeLocationData(
  original: LocationInfo,
  enResult: Partial<LocationInfo>,
  faResult: Partial<LocationInfo>,
  locationsDB?: IranLocationsDB
): LocationInfo {
  const countryFa = faResult.country_en || original.country_fa || 'ایران';
  let provinceFa = faResult.province_en || original.province_fa;
  let provinceEn = enResult.province_en;
  const cityFa = faResult.city_en || original.city_fa;
  const areaFa = original.area_fa || faResult.area_en;

  // If province is missing but we have a city, look up the province from the database
  if (!provinceFa && !provinceEn && cityFa && locationsDB?.isAvailable()) {
    const provinceInfo = locationsDB.getProvinceForCity(cityFa);
    if (provinceInfo) {
      provinceFa = provinceInfo.province_fa;
      provinceEn = provinceInfo.province_en;
    }
  }

  return {
    country_fa: countryFa,
    country_en: getEnglishName(enResult.country_en, countryFa, locationsDB) || 'Iran',
    province_fa: provinceFa,
    province_en: provinceEn || getEnglishName(undefined, provinceFa, locationsDB),
    city_fa: cityFa,
    city_en: getEnglishName(enResult.city_en, cityFa, locationsDB),
    // For area: PREFER the original from Ollama (e.g., نارمک) since it's the actual neighborhood name
    area_fa: areaFa,
    area_en: getEnglishName(enResult.area_en, areaFa, locationsDB),
    lat: enResult.lat,
    lon: enResult.lon,
  };
}

export interface GeocodeOptions {
  resume: boolean;
  dryRun: boolean;
}

export async function geocode(config: Config, options: GeocodeOptions): Promise<void> {
  const logger = new Logger(config.paths.raw);
  const stats = new StatsTracker();
  const rateLimiter = new RateLimiter(1000);

  const albumsPath = path.join(config.paths.raw, 'albums.json');
  const cachePath = path.join(config.paths.output, 'cache', 'geocode.sqlite');
  const locationsDBPath = path.join(process.cwd(), 'data', 'iran-locations.sqlite');

  if (!await fs.pathExists(albumsPath)) {
    console.error('✗ No albums.json found. Run download first.');
    process.exit(1);
  }

  const albumsData: AlbumsData = await fs.readJson(albumsPath);
  const locationsDB = new IranLocationsDB(locationsDBPath);

  console.log('🌍 Geocoding locations with Nominatim...');
  console.log(`   Albums: ${albumsData.albums.length}`);
  console.log(`   Dry run: ${options.dryRun}`);
  if (locationsDB.isAvailable()) {
    console.log('   Using local Iran locations database for translations');
  }

  const cache = new GeocodeCache(cachePath);
  let geocoded = 0;
  let skipped = 0;
  let noLocation = 0;

  for (const album of albumsData.albums) {
    if (options.resume && album.geocoded) {
      skipped++;
      continue;
    }

    const locations = album.analysis?.locations;
    if (!locations || Object.keys(locations).length === 0) {
      album.geocoded = {};
      noLocation++;
      continue;
    }

    const query = buildSearchQuery(locations);
    if (!query) {
      album.geocoded = { ...locations };
      noLocation++;
      continue;
    }

    const cached = cache.get(query);
    if (cached !== undefined) {
      // If cache has data, merge it; otherwise enrich original locations with province from DB
      const baseLocations = cached ? { ...locations, ...cached } : { ...locations, country_fa: 'ایران', country_en: 'Iran' };
      album.geocoded = enrichWithProvinceFromDB(baseLocations, locationsDB);
      stats.increment('cache_hits');
      geocoded++;
      logger.log('geocode', 'success', `Cache hit: ${query}`, album.album_id);
      continue;
    }

    if (options.dryRun) {
      console.log(`   [DRY RUN] Would geocode: ${query}`);
      geocoded++;
      continue;
    }

    await rateLimiter.wait();

    // Query for English names
    const enResult = await queryNominatim(query, config.nominatim.userAgent, 'en');

    if (enResult) {
      // Query for Persian names (with rate limit)
      await rateLimiter.wait();
      const faResult = await queryNominatim(query, config.nominatim.userAgent, 'fa');

      const enData = extractAddressFromResult(enResult);
      const faData = faResult ? extractAddressFromResult(faResult) : {};

      album.geocoded = mergeLocationData(locations, enData, faData, locationsDB);
      cache.set(query, album.geocoded);
      stats.increment('cache_misses');
      logger.log('geocode', 'success',
        `Geocoded: ${query} → ${album.geocoded.province_en || ''} / ${album.geocoded.city_en || ''} / ${album.geocoded.area_en || ''}`,
        album.album_id
      );
    } else {
      // Nominatim returned no results - enrich with province from database
      const baseLocations = {
        ...locations,
        country_fa: 'ایران',
        country_en: 'Iran',
      };
      album.geocoded = enrichWithProvinceFromDB(baseLocations, locationsDB);
      cache.set(query, null);
      stats.increment('cache_misses');
      logger.log('geocode', 'warning', `No Nominatim results for: ${query}, using DB lookup`, album.album_id);
      stats.increment('warnings');
    }

    geocoded++;
    stats.increment('albums_total');

    if (geocoded % 20 === 0) {
      console.log(`   Geocoded ${geocoded}/${albumsData.albums.length - skipped}...`);
      await fs.writeJson(albumsPath, albumsData, { spaces: 2 });
    }
  }

  cache.close();
  locationsDB.close();

  if (!options.dryRun) {
    await fs.writeJson(albumsPath, albumsData, { spaces: 2 });
    await logger.save();
  }

  console.log(`\n✓ Geocoding complete`);
  console.log(`   Geocoded: ${geocoded}`);
  console.log(`   Skipped (already done): ${skipped}`);
  console.log(`   No location data: ${noLocation}`);
  stats.print();
}
