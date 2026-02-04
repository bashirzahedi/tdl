import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import fs from 'fs-extra';
import input from 'input';
import type { Config } from '../types.js';

const SESSION_FILE = 'session.txt';

interface PreviewStats {
  totalMessages: number;
  totalAlbums: number;
  photos: number;
  videos: number;
  documents: number;
  estimatedSizeBytes: number;
  dateRange: { earliest: Date | null; latest: Date | null };
  messagesWithCaption: number;
}

async function getSession(): Promise<StringSession> {
  if (await fs.pathExists(SESSION_FILE)) {
    const sessionString = await fs.readFile(SESSION_FILE, 'utf-8');
    return new StringSession(sessionString.trim());
  }
  return new StringSession('');
}

async function saveSession(session: StringSession): Promise<void> {
  await fs.writeFile(SESSION_FILE, session.save());
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} seconds`;
  if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return `${mins}m ${secs}s`;
  }
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${mins}m`;
}

export async function preview(config: Config): Promise<void> {
  console.log('🔍 Scanning channel for preview...');
  console.log(`   Channel: ${config.telegram.channel}`);
  console.log(`   Date range: ${config.telegram.dateFrom.toISOString().split('T')[0]} to ${config.telegram.dateTo.toISOString().split('T')[0]}`);

  const session = await getSession();
  const client = new TelegramClient(session, config.telegram.apiId, config.telegram.apiHash, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: async () => await input.text('Phone number: '),
    password: async () => await input.text('Password (if 2FA): '),
    phoneCode: async () => await input.text('Code: '),
    onError: (err) => console.error('Auth error:', err),
  });

  await saveSession(client.session as StringSession);
  console.log('✓ Connected to Telegram\n');

  const entity = await client.getEntity(config.telegram.channel);
  const albumIds = new Set<string>();

  const stats: PreviewStats = {
    totalMessages: 0,
    totalAlbums: 0,
    photos: 0,
    videos: 0,
    documents: 0,
    estimatedSizeBytes: 0,
    dateRange: { earliest: null, latest: null },
    messagesWithCaption: 0,
  };

  console.log('📨 Scanning messages (this is fast, no downloads)...\n');
  let scanCount = 0;

  for await (const message of client.iterMessages(entity, {
    offsetDate: Math.floor(config.telegram.dateTo.getTime() / 1000),
  })) {
    const msgDate = new Date((message.date || 0) * 1000);

    if (msgDate < config.telegram.dateFrom) {
      break;
    }

    if (msgDate > config.telegram.dateTo) {
      continue;
    }

    if (!message.media) {
      continue;
    }

    stats.totalMessages++;
    scanCount++;

    // Track date range
    if (!stats.dateRange.earliest || msgDate < stats.dateRange.earliest) {
      stats.dateRange.earliest = msgDate;
    }
    if (!stats.dateRange.latest || msgDate > stats.dateRange.latest) {
      stats.dateRange.latest = msgDate;
    }

    // Track albums
    const chatId = message.peerId && 'channelId' in message.peerId
      ? message.peerId.channelId.toString()
      : 'unknown';
    const groupedId = message.groupedId?.toString() || message.id.toString();
    const albumId = `${chatId}_${groupedId}`;
    albumIds.add(albumId);

    // Track captions
    if (message.message) {
      stats.messagesWithCaption++;
    }

    // Categorize media and estimate size
    if (message.media instanceof Api.MessageMediaPhoto) {
      stats.photos++;
      // Average photo size estimate: 500KB
      stats.estimatedSizeBytes += 500 * 1024;
    } else if (message.media instanceof Api.MessageMediaDocument) {
      const doc = message.media.document;
      if (doc instanceof Api.Document) {
        const isVideo = doc.mimeType?.startsWith('video/');
        if (isVideo) {
          stats.videos++;
        } else {
          stats.documents++;
        }
        // Use actual size from document
        stats.estimatedSizeBytes += Number(doc.size) || 0;
      }
    }

    // Progress indicator
    if (scanCount % 100 === 0) {
      process.stdout.write(`\r   Scanned ${scanCount} media messages...`);
    }
  }

  stats.totalAlbums = albumIds.size;

  await client.disconnect();

  // Clear progress line
  process.stdout.write('\r' + ' '.repeat(50) + '\r');

  // Print summary
  console.log('═══════════════════════════════════════════════════════════');
  console.log('                    📊 PREVIEW SUMMARY                      ');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('📁 Content Overview:');
  console.log(`   Total albums:     ${stats.totalAlbums.toLocaleString()}`);
  console.log(`   Total files:      ${stats.totalMessages.toLocaleString()}`);
  console.log(`   With captions:    ${stats.messagesWithCaption.toLocaleString()}`);

  console.log('\n📷 File Types:');
  console.log(`   Photos:           ${stats.photos.toLocaleString()}`);
  console.log(`   Videos:           ${stats.videos.toLocaleString()}`);
  console.log(`   Documents:        ${stats.documents.toLocaleString()}`);

  console.log('\n💾 Size Estimate:');
  console.log(`   Total size:       ~${formatBytes(stats.estimatedSizeBytes)}`);

  if (stats.dateRange.earliest && stats.dateRange.latest) {
    console.log('\n📅 Actual Date Range:');
    console.log(`   From:             ${stats.dateRange.earliest.toISOString().split('T')[0]}`);
    console.log(`   To:               ${stats.dateRange.latest.toISOString().split('T')[0]}`);
  }

  // Time estimates (based on current 1 second rate limit)
  const downloadSeconds = stats.totalMessages * 1; // 1 sec per file (current rate limit)
  const analyzeSeconds = stats.totalAlbums * 30; // ~30 sec per album for Ollama
  const geocodeSeconds = stats.totalAlbums * 2; // 2 sec per album (2 queries)

  console.log('\n⏱️  Time Estimates (with current settings):');
  console.log(`   Download:         ~${formatDuration(downloadSeconds)}`);
  console.log(`   AI Analysis:      ~${formatDuration(analyzeSeconds)}`);
  console.log(`   Geocoding:        ~${formatDuration(geocodeSeconds)}`);
  console.log(`   ─────────────────────────────────`);
  console.log(`   Total pipeline:   ~${formatDuration(downloadSeconds + analyzeSeconds + geocodeSeconds)}`);

  // Tips
  console.log('\n💡 Tips:');
  if (stats.totalMessages > 500) {
    console.log('   • Consider using --date-from/--date-to for smaller batches');
  }
  console.log('   • Use --metadata-only to skip downloading media files');
  console.log('   • Use --resume to continue interrupted downloads');

  console.log('\n═══════════════════════════════════════════════════════════\n');
}
