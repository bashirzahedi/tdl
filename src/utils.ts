import fs from 'fs-extra';
import path from 'path';
import type { LogEntry, Stats } from './types.js';

export function safeName(text: string): string {
  if (!text) return 'unknown';
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s\u0600-\u06FF\-_]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .substring(0, 100) || 'unknown';
}

export function bilingualFolderName(farsi: string, english: string): string {
  const fa = safeName(farsi);
  const en = safeName(english);
  if (fa === en || !en || en === 'unknown') return fa;
  if (!fa || fa === 'unknown') return en;
  return `${fa}__${en}`;
}

export function truncateText(text: string, maxChars: number = 16000): string {
  if (text.length <= maxChars) return text;
  return text.substring(0, maxChars) + '...';
}

export async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class RateLimiter {
  private lastCall: number = 0;

  constructor(private minIntervalMs: number) {}

  async wait(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastCall;
    if (elapsed < this.minIntervalMs) {
      await sleep(this.minIntervalMs - elapsed);
    }
    this.lastCall = Date.now();
  }
}

export class Logger {
  private logs: LogEntry[] = [];
  private logPath: string;

  constructor(basePath: string) {
    this.logPath = path.join(basePath, 'log.json');
  }

  log(step: string, status: LogEntry['status'], message: string, albumId?: string, details?: Record<string, unknown>): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      step,
      status,
      message,
      album_id: albumId,
      details,
    };
    this.logs.push(entry);

    const icon = status === 'success' ? '✓' : status === 'error' ? '✗' : '⚠';
    console.log(`[${step}] ${icon} ${message}${albumId ? ` (${albumId})` : ''}`);
  }

  async save(): Promise<void> {
    await fs.ensureDir(path.dirname(this.logPath));
    await fs.writeJson(this.logPath, this.logs, { spaces: 2 });
  }

  async load(): Promise<void> {
    if (await fs.pathExists(this.logPath)) {
      this.logs = await fs.readJson(this.logPath);
    }
  }

  getErrors(): LogEntry[] {
    return this.logs.filter(l => l.status === 'error');
  }
}

export class StatsTracker {
  private stats: Stats = {
    albums_total: 0,
    files_total: 0,
    files_size_bytes: 0,
    cache_hits: 0,
    cache_misses: 0,
    low_confidence: 0,
    errors: 0,
    warnings: 0,
  };

  increment(key: keyof Stats, amount: number = 1): void {
    this.stats[key] += amount;
  }

  get(): Stats {
    return { ...this.stats };
  }

  print(): void {
    const sizeMB = (this.stats.files_size_bytes / (1024 * 1024)).toFixed(2);
    const cacheHitRate = this.stats.cache_hits + this.stats.cache_misses > 0
      ? ((this.stats.cache_hits / (this.stats.cache_hits + this.stats.cache_misses)) * 100).toFixed(1)
      : '0';

    console.log('\n📊 Statistics:');
    console.log(`   Albums: ${this.stats.albums_total}`);
    console.log(`   Files: ${this.stats.files_total} (${sizeMB}MB)`);
    console.log(`   Cache hit rate: ${cacheHitRate}%`);
    console.log(`   Low confidence: ${this.stats.low_confidence}`);
    console.log(`   Errors: ${this.stats.errors}`);
    console.log(`   Warnings: ${this.stats.warnings}`);
  }
}

export function formatDateForFolder(gregorian: string, jalali: string): string {
  const gDate = gregorian.split('T')[0];
  const jDate = jalali.replace(/\//g, '-');
  return `${gDate}__${jDate}`;
}

export function getFileExtension(mimeType?: string, filename?: string): string {
  if (filename) {
    const ext = path.extname(filename).toLowerCase();
    if (ext) return ext;
  }

  const mimeMap: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'video/mp4': '.mp4',
    'video/quicktime': '.mov',
    'video/webm': '.webm',
  };

  return mimeMap[mimeType || ''] || '.bin';
}
