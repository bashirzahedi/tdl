import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import fs from 'fs-extra';
import path from 'path';
import input from 'input';
import type { Config, Album, AlbumItem, AlbumsData } from '../types.js';
import { Logger, RateLimiter, StatsTracker, getFileExtension, sleep } from '../utils.js';

const SESSION_FILE = 'session.txt';

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

export interface DownloadOptions {
  resume: boolean;
  dryRun: boolean;
  metadataOnly: boolean;
}

export async function download(config: Config, options: DownloadOptions): Promise<void> {
  const logger = new Logger(config.paths.raw);
  const stats = new StatsTracker();
  const rateLimiter = new RateLimiter(1000);

  console.log('📥 Starting download...');
  console.log(`   Channel: ${config.telegram.channel}`);
  console.log(`   Date range: ${config.telegram.dateFrom.toISOString()} to ${config.telegram.dateTo.toISOString()}`);
  console.log(`   Dry run: ${options.dryRun}`);
  console.log(`   Resume: ${options.resume}`);
  console.log(`   Metadata only: ${options.metadataOnly}`);

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
  console.log('✓ Connected to Telegram');

  const existingAlbums = new Set<string>();
  const albumsPath = path.join(config.paths.raw, 'albums.json');

  let albumsData: AlbumsData = {
    version: '1.0',
    channel: config.telegram.channel,
    date_range: {
      from: config.telegram.dateFrom.toISOString(),
      to: config.telegram.dateTo.toISOString(),
    },
    downloaded_at: new Date().toISOString(),
    albums: [],
  };

  if (options.resume && await fs.pathExists(albumsPath)) {
    albumsData = await fs.readJson(albumsPath);
    albumsData.albums.forEach(a => existingAlbums.add(a.album_id));
    console.log(`   Resuming: ${existingAlbums.size} albums already downloaded`);
  }

  const entity = await client.getEntity(config.telegram.channel);
  const albumsMap = new Map<string, Album>();
  let processedCount = 0;

  console.log('\n📨 Fetching messages...');

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

    const chatId = message.peerId && 'channelId' in message.peerId
      ? message.peerId.channelId.toString()
      : 'unknown';
    const groupedId = message.groupedId?.toString() || message.id.toString();
    const albumId = `${chatId}_${groupedId}`;

    if (options.resume && existingAlbums.has(albumId)) {
      continue;
    }

    if (!albumsMap.has(albumId)) {
      albumsMap.set(albumId, {
        album_id: albumId,
        telegram_date: msgDate.toISOString(),
        caption_fa: '',
        items: [],
      });
    }

    const album = albumsMap.get(albumId)!;

    if (message.message && !album.caption_fa) {
      album.caption_fa = message.message;
    }

    const dateFolder = msgDate.toISOString().split('T')[0];
    const rawDatePath = path.join(config.paths.raw, dateFolder);

    let fileExt = '.bin';
    let itemType: AlbumItem['type'] = 'document';

    if (message.media instanceof Api.MessageMediaPhoto) {
      fileExt = '.jpg';
      itemType = 'photo';
    } else if (message.media instanceof Api.MessageMediaDocument) {
      const doc = message.media.document;
      if (doc instanceof Api.Document) {
        fileExt = getFileExtension(doc.mimeType,
          doc.attributes.find((a): a is Api.DocumentAttributeFilename =>
            a instanceof Api.DocumentAttributeFilename)?.fileName
        );
        itemType = doc.mimeType?.startsWith('video/') ? 'video' : 'document';
      }
    }

    const filePath = path.join(rawDatePath, `${message.id}${fileExt}`);
    const relativePath = path.relative(process.cwd(), filePath);

    album.items.push({
      id: message.id,
      path: relativePath,
      type: itemType,
    });

    if (options.metadataOnly) {
      stats.increment('files_total');
      if (processedCount % 100 === 0) {
        logger.log('download', 'success', `Collected metadata for ${relativePath}`, albumId);
      }
    } else if (!options.dryRun) {
      await fs.ensureDir(rawDatePath);
      await rateLimiter.wait();

      try {
        const buffer = await client.downloadMedia(message, {});
        if (buffer) {
          await fs.writeFile(filePath, buffer);
          const fileSize = (buffer as Buffer).length;
          stats.increment('files_size_bytes', fileSize);
          stats.increment('files_total');
          logger.log('download', 'success', `Downloaded ${relativePath}`, albumId);
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        logger.log('download', 'error', `Failed to download: ${errorMsg}`, albumId);
        stats.increment('errors');
      }
    } else {
      console.log(`   [DRY RUN] Would download: ${relativePath}`);
      stats.increment('files_total');
    }

    processedCount++;
    if (processedCount % 50 === 0) {
      console.log(`   Processed ${processedCount} messages...`);
    }
  }

  const newAlbums = Array.from(albumsMap.values()).filter(a => a.items.length > 0);
  stats.increment('albums_total', newAlbums.length);

  if (options.resume) {
    albumsData.albums = [...albumsData.albums, ...newAlbums];
  } else {
    albumsData.albums = newAlbums;
  }

  albumsData.downloaded_at = new Date().toISOString();

  if (!options.dryRun || options.metadataOnly) {
    await fs.ensureDir(config.paths.raw);
    await fs.writeJson(albumsPath, albumsData, { spaces: 2 });
    await logger.save();
  }

  await client.disconnect();

  console.log('\n✓ Download complete');
  stats.print();
}
