import fs from 'fs-extra';
import path from 'path';
import { glob } from 'glob';
import type { Config, Album, AlbumsData, LocationInfo } from '../types.js';
import { Logger, StatsTracker, safeName, bilingualFolderName, formatDateForFolder, sleep } from '../utils.js';
import { translateText } from '../ai-provider.js';

function buildLocationPath(loc: LocationInfo): string {
  const parts: string[] = [];

  // Hierarchy: Country → Province → City → Area
  if (loc.country_fa || loc.country_en) {
    parts.push(bilingualFolderName(loc.country_fa || '', loc.country_en || ''));
  }

  if (loc.province_fa || loc.province_en) {
    parts.push(bilingualFolderName(loc.province_fa || '', loc.province_en || ''));
  }

  // Skip city if it's the same as country (e.g., both are "ایران")
  const cityIsCountry = loc.city_fa === loc.country_fa || loc.city_en === loc.country_en;
  if ((loc.city_fa || loc.city_en) && !cityIsCountry) {
    parts.push(bilingualFolderName(loc.city_fa || '', loc.city_en || ''));
  }

  if (loc.area_fa || loc.area_en) {
    parts.push(bilingualFolderName(loc.area_fa || '', loc.area_en || ''));
  }

  if (parts.length === 0) {
    return 'unknown';
  }

  return parts.join(path.sep);
}

export interface OrganizeOptions {
  resume: boolean;
  dryRun: boolean;
  keepRaw: boolean;
  metadataOnly: boolean;
}

export async function organize(config: Config, options: OrganizeOptions): Promise<void> {
  const logger = new Logger(config.paths.output);
  const stats = new StatsTracker();

  const albumsPath = path.join(config.paths.raw, 'albums.json');

  if (!await fs.pathExists(albumsPath)) {
    console.error('✗ No albums.json found. Run download first.');
    process.exit(1);
  }

  const albumsData: AlbumsData = await fs.readJson(albumsPath);

  console.log('📁 Organizing files...');
  console.log(`   Albums: ${albumsData.albums.length}`);
  console.log(`   Dry run: ${options.dryRun}`);
  console.log(`   Keep raw: ${options.keepRaw}`);
  console.log(`   Metadata only: ${options.metadataOnly}`);

  let organized = 0;
  let skipped = 0;

  for (const album of albumsData.albums) {
    const albumFolderName = `album_${safeName(album.album_id)}`;

    if (options.resume) {
      const matches = await glob(`**/album_${safeName(album.album_id)}/meta.json`, {
        cwd: config.paths.output,
      });
      if (matches.length > 0) {
        skipped++;
        continue;
      }
    }

    const dateFolder = album.resolved_dates
      ? formatDateForFolder(album.resolved_dates.gregorian, album.resolved_dates.jalali)
      : album.telegram_date.split('T')[0];

    const locationPath = album.geocoded
      ? buildLocationPath(album.geocoded)
      : 'unknown';

    const finalAlbumPath = path.join(
      config.paths.output,
      dateFolder,
      locationPath,
      albumFolderName
    );

    if (options.dryRun) {
      console.log(`\n   [DRY RUN] Album: ${album.album_id}`);
      console.log(`   → ${path.relative(config.paths.output, finalAlbumPath)}`);
      for (const item of album.items) {
        console.log(`     - ${path.basename(item.path)}`);
      }
      organized++;
      continue;
    }

    await fs.ensureDir(finalAlbumPath);

    if (!options.metadataOnly) {
      for (const item of album.items) {
        const sourcePath = path.resolve(process.cwd(), item.path);
        const destPath = path.join(finalAlbumPath, path.basename(item.path));

        if (await fs.pathExists(sourcePath)) {
          try {
            await fs.move(sourcePath, destPath, { overwrite: false });
            const fileStat = await fs.stat(destPath);
            stats.increment('files_size_bytes', fileStat.size);
            stats.increment('files_total');
          } catch (err) {
            if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
              const timestamp = Date.now();
              const ext = path.extname(item.path);
              const base = path.basename(item.path, ext);
              const newDestPath = path.join(finalAlbumPath, `${base}_${timestamp}${ext}`);
              await fs.move(sourcePath, newDestPath);
              stats.increment('files_total');
              logger.log('organize', 'warning', `Renamed duplicate: ${newDestPath}`, album.album_id);
              stats.increment('warnings');
            } else {
              throw err;
            }
          }
        } else {
          logger.log('organize', 'error', `Source file not found: ${item.path}`, album.album_id);
          stats.increment('errors');
        }
      }
    }

    if (album.caption_fa) {
      await fs.writeFile(
        path.join(finalAlbumPath, 'caption_fa.txt'),
        album.caption_fa,
        'utf-8'
      );

      const captionEn = await translateText(config, album.caption_fa);
      if (captionEn) {
        await fs.writeFile(
          path.join(finalAlbumPath, 'caption_en.txt'),
          captionEn,
          'utf-8'
        );
      } else {
        logger.log('organize', 'warning', 'Translation failed, no caption_en.txt created', album.album_id);
        stats.increment('warnings');
      }
    }

    const meta = {
      album_id: album.album_id,
      telegram_date: album.telegram_date,
      resolved_dates: album.resolved_dates,
      locations: album.geocoded,
      analysis_confidence: album.analysis?.confidence,
      organized_at: new Date().toISOString(),
    };
    await fs.writeJson(path.join(finalAlbumPath, 'meta.json'), meta, { spaces: 2 });

    const items = album.items.map(item => ({
      id: item.id,
      filename: path.basename(item.path),
      type: item.type,
    }));
    await fs.writeJson(path.join(finalAlbumPath, 'items.json'), items, { spaces: 2 });

    logger.log('organize', 'success',
      `Organized ${album.items.length} files → ${path.relative(config.paths.output, finalAlbumPath)}`,
      album.album_id
    );

    organized++;
    stats.increment('albums_total');

    if (organized % 20 === 0) {
      console.log(`   Organized ${organized}/${albumsData.albums.length - skipped}...`);
    }

    await sleep(100);
  }

  if (!options.dryRun && !options.keepRaw) {
    const rawDirs = await fs.readdir(config.paths.raw);
    for (const dir of rawDirs) {
      const dirPath = path.join(config.paths.raw, dir);
      const stat = await fs.stat(dirPath);
      if (stat.isDirectory()) {
        const files = await fs.readdir(dirPath);
        if (files.length === 0) {
          await fs.remove(dirPath);
        }
      }
    }
  }

  if (!options.dryRun) {
    await logger.save();
  }

  console.log(`\n✓ Organization complete`);
  console.log(`   Organized: ${organized}`);
  console.log(`   Skipped (already done): ${skipped}`);
  stats.print();
}
