import Database from 'better-sqlite3';
import fs from 'fs-extra';
import path from 'path';
import type { Config, Album, AlbumsData, Analysis, LocationInfo } from '../types.js';
import { Logger, StatsTracker, truncateText, sleep } from '../utils.js';
import { queryAI, parseAnalysisResponse, getProviderDisplayName } from '../ai-provider.js';

// Location info with admin level, population, and province
interface LocationEntry {
  name_en: string;
  lat: number;
  lon: number;
  admin_level: number; // 0 = province, 1 = major city, 2 = city/town, 3 = neighborhood/locality
  population: number;  // Used to prefer well-known places
  province_code: string; // Province code for filtering (e.g., "26" for Tehran)
}

// Iran locations database (downloaded from GeoNames)
class IranLocationsDB {
  private db: Database.Database | null = null;
  private locationMap: Map<string, LocationEntry> = new Map();
  // Separate sets for fast lookup by admin level
  private provinces: Set<string> = new Set();       // admin_level 0
  private majorCities: Set<string> = new Set();     // admin_level 1
  private cities: Set<string> = new Set();          // admin_level 2
  private neighborhoods: Set<string> = new Set();   // admin_level 3

  constructor(dbPath: string) {
    if (fs.existsSync(dbPath)) {
      this.db = new Database(dbPath, { readonly: true });
      this.loadLocations();
    }
  }

  private loadLocations(): void {
    if (!this.db) return;

    // For provinces (admin_level 0) and cities (admin_level 1-2): require minimum population
    // For neighborhoods (admin_level 3): include all since population data is often missing
    // Order: major cities (1) first, then provinces (0), then cities (2), then neighborhoods (3)
    // This ensures "تهران" is recognized as the city, not the province
    const rows = this.db.prepare(`
      SELECT name_fa, name_en, latitude, longitude, admin_level, population, province_code
      FROM locations
      WHERE (admin_level <= 2 AND population >= ${MIN_POPULATION})
         OR admin_level = 3
         OR admin_level = 0
      ORDER BY CASE admin_level WHEN 1 THEN 0 WHEN 0 THEN 1 ELSE admin_level END ASC, population DESC
    `).all() as Array<{ name_fa: string; name_en: string; latitude: number; longitude: number; admin_level: number; population: number; province_code: string }>;

    for (const row of rows) {
      // Only store first occurrence (highest priority due to ORDER BY)
      if (!this.locationMap.has(row.name_fa)) {
        this.locationMap.set(row.name_fa, {
          name_en: row.name_en,
          lat: row.latitude,
          lon: row.longitude,
          admin_level: row.admin_level,
          population: row.population || 0,
          province_code: row.province_code || '',
        });

        // Add to appropriate set based on admin level
        if (row.admin_level === 0) {
          this.provinces.add(row.name_fa);
        } else if (row.admin_level === 1) {
          this.majorCities.add(row.name_fa);
        } else if (row.admin_level === 2) {
          this.cities.add(row.name_fa);
        } else {
          this.neighborhoods.add(row.name_fa);
        }
      }
    }

    console.log(`   Loaded ${this.locationMap.size} locations (${this.provinces.size} provinces, ${this.majorCities.size} major cities, ${this.cities.size} cities, ${this.neighborhoods.size} neighborhoods)`);
  }

  isLocation(word: string): boolean {
    return this.locationMap.has(word);
  }

  isProvince(word: string): boolean {
    return this.provinces.has(word);
  }

  isMajorCity(word: string): boolean {
    return this.majorCities.has(word);
  }

  isCity(word: string): boolean {
    return this.majorCities.has(word) || this.cities.has(word);
  }

  isNeighborhood(word: string): boolean {
    return this.neighborhoods.has(word);
  }

  getAdminLevel(word: string): number | undefined {
    return this.locationMap.get(word)?.admin_level;
  }

  getEnglishName(persianName: string): string | undefined {
    return this.locationMap.get(persianName)?.name_en;
  }

  getCoordinates(persianName: string): { lat: number; lon: number } | undefined {
    const loc = this.locationMap.get(persianName);
    if (loc) return { lat: loc.lat, lon: loc.lon };
    return undefined;
  }

  getPopulation(persianName: string): number {
    return this.locationMap.get(persianName)?.population || 0;
  }

  getProvinceCode(persianName: string): string {
    return this.locationMap.get(persianName)?.province_code || '';
  }

  isAvailable(): boolean {
    return this.db !== null;
  }

  close(): void {
    this.db?.close();
  }
}

// Minimum population for a place to be considered (filters out tiny villages)
const MIN_POPULATION = 1000;

// Foreign countries - used for English translation when AI detects foreign location
const FOREIGN_COUNTRIES = new Map<string, string>([
  // Countries only (not cities - cities could be mentioned in context of Iran news)
  ['فرانسه', 'France'], ['آلمان', 'Germany'], ['انگلستان', 'UK'], ['انگلیس', 'UK'],
  ['ایتالیا', 'Italy'], ['اسپانیا', 'Spain'], ['هلند', 'Netherlands'],
  ['بلژیک', 'Belgium'], ['سوئیس', 'Switzerland'], ['اتریش', 'Austria'],
  ['یونان', 'Greece'], ['پرتغال', 'Portugal'], ['سوئد', 'Sweden'],
  ['نروژ', 'Norway'], ['دانمارک', 'Denmark'], ['فنلاند', 'Finland'],
  ['لهستان', 'Poland'], ['چک', 'Czech'], ['اوکراین', 'Ukraine'],
  ['روسیه', 'Russia'], ['آمریکا', 'USA'], ['امریکا', 'USA'],
  ['ایالات متحده', 'USA'], ['کانادا', 'Canada'], ['مکزیک', 'Mexico'],
  ['برزیل', 'Brazil'], ['چین', 'China'], ['ژاپن', 'Japan'],
  ['کره', 'Korea'], ['هند', 'India'], ['پاکستان', 'Pakistan'],
  ['افغانستان', 'Afghanistan'], ['عراق', 'Iraq'], ['ترکیه', 'Turkey'],
  ['امارات', 'UAE'], ['عربستان', 'Saudi Arabia'], ['قطر', 'Qatar'],
  ['کویت', 'Kuwait'], ['بحرین', 'Bahrain'], ['اسرائیل', 'Israel'],
  ['فلسطین', 'Palestine'], ['لبنان', 'Lebanon'], ['سوریه', 'Syria'],
  ['اردن', 'Jordan'], ['مصر', 'Egypt'], ['استرالیا', 'Australia'],
  ['نیوزیلند', 'New Zealand'],
]);

export interface AnalyzeOptions {
  resume: boolean;
  dryRun: boolean;
  provider?: string;
}

function buildPrompt(caption: string, telegramDate: string): string {
  return `Analyze this Farsi caption and extract location information.

Caption: "${truncateText(caption, 4000)}"
Telegram date: ${telegramDate}

TASK: Extract the MAIN location this event happened in.

LOCATION RULES:
1. Find the Iranian city where the event took place (تهران، مشهد، اصفهان، شیراز، تبریز، رشت، کرج، قم، اهواز، کرمانشاه، etc.)
2. If a neighborhood/street/area is mentioned, extract it too (نارمک، صادقیه، ونک، اشرفی اصفهانی، etc.)
3. The location words MUST appear in the caption - don't guess
4. If location is outside Iran (آمریکا، فرانسه، etc.), set is_foreign: true
5. Common phrases like "بنا بر"، "حوالی"، "نرسیده به" are NOT locations

EXAMPLES:
- "تیراندازی در مشهد" → city_fa: "مشهد"
- "اشرفی اصفهانی، تهران" → city_fa: "تهران", area_fa: "اشرفی اصفهانی"
- "نارمک تهران" → city_fa: "تهران", area_fa: "نارمک"
- "کهریزک تهران" → city_fa: "تهران", area_fa: "کهریزک"
- "اعتراضات در پاریس" → is_foreign: true, foreign_location: "پاریس"

Respond ONLY with valid JSON:
{
  "dates": ["۱۸ دی"],
  "locations": {
    "city_fa": "تهران",
    "area_fa": "نارمک"
  },
  "is_foreign": false,
  "confidence": 0.9
}

- dates: array of Persian dates found (or empty [])
- locations: object with city_fa and optionally area_fa (or empty {})
- is_foreign: true if event is outside Iran
- confidence: 0.0 to 1.0`;
}

// Process a single album's AI response and enrich with location DB
function processAnalysisResult(
  album: Album,
  aiResponse: { text: string; success: boolean; error?: string },
  locationsDB: IranLocationsDB,
  logger: Logger,
  stats: StatsTracker
): void {
  const analysis = aiResponse.success ? parseAnalysisResponse(aiResponse.text) : null;

  if (!aiResponse.success && aiResponse.error) {
    console.error(`   ${aiResponse.error}`);
  }

  if (analysis) {
    const aiLocations = analysis.locations as Record<string, string>;
    const finalLocations: Partial<LocationInfo> = {};

    const isForeign = (analysis as unknown as { is_foreign?: boolean }).is_foreign;

    if (isForeign) {
      finalLocations.country_fa = 'سایر';
      finalLocations.country_en = 'Other';
      if (aiLocations.city_fa || aiLocations.foreign_location) {
        finalLocations.city_fa = aiLocations.city_fa || aiLocations.foreign_location;
        const foreignEn = FOREIGN_COUNTRIES.get(finalLocations.city_fa || '');
        finalLocations.city_en = foreignEn || finalLocations.city_fa;
      }
    } else {
      if (aiLocations.city_fa) {
        finalLocations.city_fa = aiLocations.city_fa;
        finalLocations.city_en = locationsDB.getEnglishName(aiLocations.city_fa) || aiLocations.city_fa;
      }
      if (aiLocations.area_fa) {
        finalLocations.area_fa = aiLocations.area_fa;
        finalLocations.area_en = locationsDB.getEnglishName(aiLocations.area_fa) || aiLocations.area_fa;
      }
      if (aiLocations.province_fa) {
        finalLocations.province_fa = aiLocations.province_fa;
        finalLocations.province_en = locationsDB.getEnglishName(aiLocations.province_fa) || aiLocations.province_fa;
      }
    }

    analysis.locations = finalLocations;
    album.analysis = analysis;

    const locationCount = Object.keys(analysis.locations).length;
    logger.log('analyze', 'success',
      `Analyzed: ${analysis.dates.length} dates, ${locationCount} locations, confidence ${analysis.confidence.toFixed(2)}`,
      album.album_id
    );

    if (analysis.confidence < 0.5) {
      stats.increment('low_confidence');
    }
  } else {
    album.analysis = {
      dates: [],
      locations: {},
      confidence: 0,
    };
    logger.log('analyze', 'error', 'Failed to get analysis', album.album_id);
    stats.increment('errors');
  }

  stats.increment('albums_total');
}

// Concurrency: 1 for Ollama (local resources), 3 for cloud providers
function getConcurrency(provider: string): number {
  return provider === 'ollama' ? 1 : 3;
}

export async function analyze(config: Config, options: AnalyzeOptions): Promise<void> {
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

  if (!locationsDB.isAvailable()) {
    console.log('⚠️  Iran locations database not found.');
    console.log('   Run: npx tsx scripts/download-locations.ts');
    console.log('   Falling back to AI-only location detection.\n');
  }

  const concurrency = getConcurrency(config.ai.provider);

  console.log(`🔍 Starting analysis with ${getProviderDisplayName(config.ai.provider)}...`);
  console.log(`   Model: ${config.ai.model}`);
  if (config.ai.fallbackProviders.length > 0) {
    console.log(`   Fallbacks: ${config.ai.fallbackProviders.map(getProviderDisplayName).join(' → ')}`);
  }
  console.log(`   Retries: ${config.ai.maxRetries}, Timeout: ${config.ai.timeoutMs}ms`);
  console.log(`   Concurrency: ${concurrency}`);
  console.log(`   Albums to analyze: ${albumsData.albums.length}`);
  console.log(`   Dry run: ${options.dryRun}`);

  // Separate albums into: skip, empty caption, and to-analyze
  const toAnalyze: Album[] = [];
  let skipped = 0;
  let emptyCount = 0;

  for (const album of albumsData.albums) {
    if (options.resume && album.analysis) {
      skipped++;
      continue;
    }

    if (!album.caption_fa || album.caption_fa.trim() === '') {
      album.analysis = {
        dates: [],
        locations: {},
        confidence: 0,
      };
      logger.log('analyze', 'warning', 'Empty caption, skipping analysis', album.album_id);
      stats.increment('warnings');
      emptyCount++;
      continue;
    }

    if (options.dryRun) {
      console.log(`   [DRY RUN] Would analyze: ${album.album_id}`);
      console.log(`   Caption preview: ${album.caption_fa.substring(0, 100)}...`);
      continue;
    }

    toAnalyze.push(album);
  }

  if (options.dryRun) {
    console.log(`\n✓ Dry run complete`);
    console.log(`   Would analyze: ${toAnalyze.length}`);
    console.log(`   Skipped (already done): ${skipped}`);
    console.log(`   Empty captions: ${emptyCount}`);
    locationsDB.close();
    return;
  }

  // Process albums in batches
  let analyzed = 0;
  const total = toAnalyze.length;

  for (let i = 0; i < total; i += concurrency) {
    const batch = toAnalyze.slice(i, i + concurrency);

    // Fire all requests in the batch concurrently
    const results = await Promise.all(
      batch.map(album => {
        const prompt = buildPrompt(album.caption_fa, album.telegram_date);
        return queryAI(config, prompt, 500);
      })
    );

    // Process results and enrich with location DB
    for (let j = 0; j < batch.length; j++) {
      processAnalysisResult(batch[j], results[j], locationsDB, logger, stats);
    }

    analyzed += batch.length;

    // Save after every batch to prevent data loss
    await fs.writeJson(albumsPath, albumsData, { spaces: 2 });

    if (analyzed % 10 === 0 || analyzed === total) {
      console.log(`   Analyzed ${analyzed}/${total}...`);
    }

    // Rate limit between batches (not needed for Ollama since concurrency=1 handles pacing)
    if (config.ai.provider !== 'ollama' && i + concurrency < total) {
      await sleep(500);
    }
  }

  locationsDB.close();

  await fs.writeJson(albumsPath, albumsData, { spaces: 2 });
  await logger.save();

  console.log(`\n✓ Analysis complete`);
  console.log(`   Analyzed: ${analyzed}`);
  console.log(`   Skipped (already done): ${skipped}`);
  console.log(`   Empty captions: ${emptyCount}`);
  stats.print();
}
