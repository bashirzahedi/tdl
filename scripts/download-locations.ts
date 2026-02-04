/**
 * Downloads and processes Iranian locations from GeoNames
 * Creates a SQLite database for fast pattern matching
 *
 * Run with: npx tsx scripts/download-locations.ts
 */

import axios from 'axios';
import Database from 'better-sqlite3';
import fs from 'fs-extra';
import path from 'path';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import { createGunzip } from 'zlib';

const GEONAMES_URL = 'https://download.geonames.org/export/dump/IR.zip';
const OUTPUT_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(OUTPUT_DIR, 'iran-locations.sqlite');

interface GeoNameEntry {
  geonameid: string;
  name: string;           // Name in local script (Persian)
  asciiname: string;      // ASCII name
  alternatenames: string; // Comma-separated alternate names
  latitude: string;
  longitude: string;
  feature_class: string;
  feature_code: string;
  country_code: string;
  admin1_code: string;    // Province code
  population: string;
}

// Feature codes for populated places
const PLACE_FEATURE_CODES = new Set([
  'PPL',      // Populated place
  'PPLA',     // Seat of first-order admin division
  'PPLA2',    // Seat of second-order admin division
  'PPLA3',    // Seat of third-order admin division
  'PPLA4',    // Seat of fourth-order admin division
  'PPLC',     // Capital of a political entity
  'PPLG',     // Seat of government
  'PPLL',     // Populated locality
  'PPLQ',     // Abandoned populated place
  'PPLR',     // Religious populated place
  'PPLS',     // Populated places
  'PPLW',     // Destroyed populated place
  'PPLX',     // Section of populated place
]);

// Feature codes for administrative divisions (provinces)
const ADMIN_FEATURE_CODES = new Set([
  'ADM1',     // First-order administrative division (province/state)
]);

async function downloadAndExtract(): Promise<string> {
  console.log('📥 Downloading Iran locations from GeoNames...');

  await fs.ensureDir(OUTPUT_DIR);
  const zipPath = path.join(OUTPUT_DIR, 'IR.zip');
  const txtPath = path.join(OUTPUT_DIR, 'IR.txt');

  // Download the zip file
  const response = await axios.get(GEONAMES_URL, {
    responseType: 'arraybuffer',
    timeout: 60000,
  });

  await fs.writeFile(zipPath, response.data);
  console.log('   Downloaded IR.zip');

  // Extract using unzip command
  const { execSync } = await import('child_process');
  execSync(`unzip -o "${zipPath}" -d "${OUTPUT_DIR}"`, { stdio: 'inherit' });
  console.log('   Extracted IR.txt');

  // Clean up zip
  await fs.remove(zipPath);

  return txtPath;
}

async function parseGeoNames(txtPath: string): Promise<GeoNameEntry[]> {
  console.log('📊 Parsing GeoNames data...');

  const entries: GeoNameEntry[] = [];

  const fileStream = createReadStream(txtPath);
  const rl = createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const parts = line.split('\t');
    if (parts.length < 15) continue;

    const entry: GeoNameEntry = {
      geonameid: parts[0],
      name: parts[1],
      asciiname: parts[2],
      alternatenames: parts[3],
      latitude: parts[4],
      longitude: parts[5],
      feature_class: parts[6],
      feature_code: parts[7],
      country_code: parts[8],
      admin1_code: parts[10],
      population: parts[14],
    };

    // Keep populated places and administrative divisions (provinces)
    const isPopulatedPlace = entry.feature_class === 'P' && PLACE_FEATURE_CODES.has(entry.feature_code);
    const isAdminDivision = entry.feature_class === 'A' && ADMIN_FEATURE_CODES.has(entry.feature_code);

    if (isPopulatedPlace || isAdminDivision) {
      entries.push(entry);
    }
  }

  console.log(`   Found ${entries.length} locations (populated places + provinces)`);
  return entries;
}

function extractPersianNames(entry: GeoNameEntry): string[] {
  const names: string[] = [];

  // Check if main name is Persian (contains Persian/Arabic characters)
  const persianRegex = /[\u0600-\u06FF]/;

  if (persianRegex.test(entry.name)) {
    names.push(entry.name);
  }

  // Check alternate names for Persian variants
  if (entry.alternatenames) {
    const alternates = entry.alternatenames.split(',');
    for (const alt of alternates) {
      if (persianRegex.test(alt) && alt.length >= 2) {
        names.push(alt.trim());
      }
    }
  }

  return [...new Set(names)]; // Remove duplicates
}

async function createDatabase(entries: GeoNameEntry[]): Promise<void> {
  console.log('💾 Creating SQLite database...');

  // Remove existing database
  if (await fs.pathExists(DB_PATH)) {
    await fs.remove(DB_PATH);
  }

  const db = new Database(DB_PATH);

  // Create tables
  // admin_level: 0 = province, 1 = major city (capital, provincial seat), 2 = city, 3 = neighborhood/locality
  db.exec(`
    CREATE TABLE locations (
      id INTEGER PRIMARY KEY,
      geonameid TEXT,
      name_fa TEXT NOT NULL,
      name_en TEXT,
      latitude REAL,
      longitude REAL,
      population INTEGER,
      feature_code TEXT,
      province_code TEXT,
      admin_level INTEGER DEFAULT 2
    );

    CREATE INDEX idx_name_fa ON locations(name_fa);
    CREATE INDEX idx_population ON locations(population DESC);
    CREATE INDEX idx_admin_level ON locations(admin_level);
  `);

  const insert = db.prepare(`
    INSERT INTO locations (geonameid, name_fa, name_en, latitude, longitude, population, feature_code, province_code, admin_level)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Determine admin level from feature code
  // Level 0: Provinces (ADM1) - highest level administrative divisions
  // Level 1: Major cities (capitals, provincial seats) - these are definitely cities
  // Level 2: Regular cities and towns
  // Level 3: Localities, neighborhoods, sections of cities
  function getAdminLevel(featureCode: string, population: number): number {
    // Provinces (first-order administrative divisions)
    if (featureCode === 'ADM1') return 0;
    // Capital and major administrative centers
    if (['PPLC', 'PPLA', 'PPLG'].includes(featureCode)) return 1;
    // Second and third order admin seats (county/district capitals)
    if (['PPLA2', 'PPLA3'].includes(featureCode)) return 1;
    // Fourth order or large populated places (50k+)
    if (featureCode === 'PPLA4' || population >= 50000) return 2;
    // Sections of populated places (neighborhoods)
    if (featureCode === 'PPLX') return 3;
    // Localities
    if (featureCode === 'PPLL') return 3;
    // Default: regular populated place
    return 2;
  }

  let count = 0;
  const insertMany = db.transaction((entries: GeoNameEntry[]) => {
    for (const entry of entries) {
      const persianNames = extractPersianNames(entry);
      const englishName = entry.asciiname || entry.name;
      const population = parseInt(entry.population) || 0;
      const adminLevel = getAdminLevel(entry.feature_code, population);

      for (const persianName of persianNames) {
        insert.run(
          entry.geonameid,
          persianName,
          englishName,
          parseFloat(entry.latitude),
          parseFloat(entry.longitude),
          population,
          entry.feature_code,
          entry.admin1_code,
          adminLevel
        );
        count++;
      }
    }
  });

  insertMany(entries);

  db.close();
  console.log(`   Inserted ${count} location names`);
}

async function main() {
  try {
    console.log('🗺️  Iran Location Database Builder\n');

    const txtPath = await downloadAndExtract();
    const entries = await parseGeoNames(txtPath);
    await createDatabase(entries);

    // Clean up txt file
    await fs.remove(txtPath);

    console.log(`\n✅ Database created: ${DB_PATH}`);
    console.log('   You can now use this for location detection.');

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();
