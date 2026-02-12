#!/usr/bin/env node

import path from 'path';
import { Command } from 'commander';
import { loadConfig } from './config.js';
import { download } from './commands/download.js';
import { preview } from './commands/preview.js';
import { analyze } from './commands/analyze.js';
import { resolve } from './commands/resolve.js';
import { geocode } from './commands/geocode.js';
import { organize } from './commands/organize.js';

const program = new Command();

program
  .name('tdownloader')
  .description('Telegram albums → AI Farsi analysis → Nominatim → bilingual folders')
  .version('1.0.0');

program
  .command('download')
  .description('Download media files from Telegram channel')
  .option('--resume', 'Skip already downloaded albums', false)
  .option('--dry-run', 'Preview without downloading', false)
  .option('--metadata-only', 'Fetch metadata and captions only, skip media files', false)
  .option('--date-from <date>', 'Override start date (ISO format)')
  .option('--date-to <date>', 'Override end date (ISO format)')
  .action(async (options) => {
    const config = loadConfig({
      dateFrom: options.dateFrom,
      dateTo: options.dateTo,
    });
    await download(config, {
      resume: options.resume,
      dryRun: options.dryRun,
      metadataOnly: options.metadataOnly,
    });
  });

program
  .command('preview')
  .description('Scan channel and show download statistics without downloading')
  .option('--date-from <date>', 'Override start date (ISO format)')
  .option('--date-to <date>', 'Override end date (ISO format)')
  .action(async (options) => {
    const config = loadConfig({
      dateFrom: options.dateFrom,
      dateTo: options.dateTo,
    });
    await preview(config);
  });

program
  .command('analyze')
  .description('Analyze captions with AI (Farsi → dates/locations)')
  .option('--resume', 'Skip already analyzed albums', false)
  .option('--dry-run', 'Preview without analyzing', false)
  .option('--provider <name>', 'Override AI provider (ollama, openai, claude, gemini, openai-compat)')
  .action(async (options) => {
    const config = loadConfig();
    if (options.provider) {
      const valid = ['ollama', 'openai', 'claude', 'gemini', 'openai-compat'];
      const p = options.provider.toLowerCase();
      if (!valid.includes(p)) {
        console.error(`✗ Unknown provider "${options.provider}". Use: ${valid.join(', ')}`);
        process.exit(1);
      }
      config.ai.provider = p as typeof config.ai.provider;
      // Update display model to match the overridden provider
      const providerModelMap: Record<string, string> = {
        ollama: config.ollama.modelAnalyze,
        openai: config.openai?.model || 'gpt-4o-mini',
        claude: config.claude?.model || 'claude-sonnet-4-20250514',
        gemini: config.gemini?.model || 'gemini-2.0-flash',
        'openai-compat': config.openaiCompat?.model || '',
      };
      config.ai.model = providerModelMap[p] || config.ai.model;
    }
    await analyze(config, {
      resume: options.resume,
      dryRun: options.dryRun,
    });
  });

program
  .command('resolve')
  .description('Convert dates (Jalali/relative → Gregorian)')
  .option('--dry-run', 'Preview without saving', false)
  .action(async (options) => {
    const config = loadConfig();
    await resolve(config, {
      dryRun: options.dryRun,
    });
  });

program
  .command('geocode')
  .description('Geocode locations with local DB + AI translation')
  .option('--resume', 'Skip already geocoded albums', false)
  .option('--dry-run', 'Preview without geocoding', false)
  .action(async (options) => {
    const config = loadConfig();
    await geocode(config, {
      resume: options.resume,
      dryRun: options.dryRun,
    });
  });

program
  .command('organize')
  .description('Move files to bilingual folder structure')
  .option('--resume', 'Skip already organized albums', false)
  .option('--dry-run', 'Preview without moving files', false)
  .option('--metadata-only', 'Create folders and captions only, skip file moving', false)
  .option('--keep-raw', 'Keep raw files after organizing', false)
  .option('--extra-output <path>', 'Copy organized files to an additional directory')
  .action(async (options) => {
    const config = loadConfig();
    if (options.extraOutput) {
      config.paths.extraOutput = path.resolve(options.extraOutput);
    }
    await organize(config, {
      resume: options.resume,
      dryRun: options.dryRun,
      keepRaw: options.keepRaw,
      metadataOnly: options.metadataOnly,
    });
  });

program
  .command('all')
  .description('Run full pipeline: download → analyze → resolve → geocode → organize')
  .option('--resume', 'Resume from last state', false)
  .option('--dry-run', 'Preview all steps without making changes', false)
  .option('--metadata-only', 'Fetch metadata only, skip media downloads and organize', false)
  .option('--keep-raw', 'Keep raw files after organizing', false)
  .option('--extra-output <path>', 'Copy organized files to an additional directory')
  .option('--date-from <date>', 'Override start date (ISO format)')
  .option('--date-to <date>', 'Override end date (ISO format)')
  .action(async (options) => {
    const config = loadConfig({
      dateFrom: options.dateFrom,
      dateTo: options.dateTo,
    });
    if (options.extraOutput) {
      config.paths.extraOutput = path.resolve(options.extraOutput);
    }

    console.log('🚀 Starting full pipeline...\n');

    console.log('═══════════════════════════════════════');
    console.log('Step 1/5: DOWNLOAD');
    console.log('═══════════════════════════════════════');
    await download(config, {
      resume: options.resume,
      dryRun: options.dryRun,
      metadataOnly: options.metadataOnly,
    });

    console.log('\n═══════════════════════════════════════');
    console.log('Step 2/5: ANALYZE');
    console.log('═══════════════════════════════════════');
    await analyze(config, {
      resume: options.resume,
      dryRun: options.dryRun,
    });

    console.log('\n═══════════════════════════════════════');
    console.log('Step 3/5: RESOLVE DATES');
    console.log('═══════════════════════════════════════');
    await resolve(config, {
      dryRun: options.dryRun,
    });

    console.log('\n═══════════════════════════════════════');
    console.log('Step 4/5: GEOCODE');
    console.log('═══════════════════════════════════════');
    await geocode(config, {
      resume: options.resume,
      dryRun: options.dryRun,
    });

    console.log('\n═══════════════════════════════════════');
    console.log(`Step 5/5: ORGANIZE${options.metadataOnly ? ' (folders + captions only)' : ''}`);
    console.log('═══════════════════════════════════════');
    await organize(config, {
      resume: options.resume,
      dryRun: options.dryRun,
      keepRaw: options.keepRaw,
      metadataOnly: options.metadataOnly,
    });

    console.log('\n🎉 Pipeline complete!');
  });

program.parse();
