# TDL the Farsi Telegram Downloader

Download media from Telegram channels, analyze Farsi captions with Ollama AI, geocode locations with Nominatim, and organize files into bilingual folder structures.

## Features

- **Preview** scan channel to see file counts, sizes, and time estimates before downloading
- **Download** media (photos, videos) from Telegram channels with GramJS
- **Analyze** Farsi captions to extract dates (Jalali/relative) and locations using Ollama
- **Convert** Jalali and relative dates (دیروز, جمعه) to Gregorian
- **Geocode** locations via Nominatim with SQLite caching
- **Organize** files into bilingual folders: `ایران__Iran/تهران__Tehran/...`

## Prerequisites

- Node.js 18+
- [Ollama](https://ollama.ai) running locally
- Telegram API credentials from [my.telegram.org](https://my.telegram.org)

## Installation

```bash
npm install
```

## Ollama Models

The quality of location detection and translation depends heavily on the model. Here are the recommended models for Farsi:

### Recommended Models

| Model | Size | RAM | Farsi Quality | Best For |
|-------|------|-----|---------------|----------|
| `aya:35b` | 20GB | 24GB+ | ⭐⭐⭐⭐⭐ Excellent | Best accuracy, production use |
| `aya:8b` | 5GB | 8GB+ | ⭐⭐⭐⭐ Very Good | Good balance of speed/quality |
| `llama3.1:70b` | 40GB | 48GB+ | ⭐⭐⭐⭐ Very Good | Large, accurate |
| `llama3.1:8b` | 5GB | 8GB+ | ⭐⭐⭐ Good | Fast, decent quality |
| `qwen2.5:32b` | 18GB | 24GB+ | ⭐⭐⭐⭐ Very Good | Good multilingual |
| `qwen2.5:14b` | 9GB | 12GB+ | ⭐⭐⭐ Good | Medium quality |
| `qwen2.5:7b` | 4GB | 6GB+ | ⭐⭐ Basic | Fast but limited Farsi |

**Aya** is specifically trained on 100+ languages including Persian - it's the best choice for Farsi.

### Quick Setup

**Best quality (24GB+ RAM):**
```bash
ollama pull aya:35b
```

**Good quality (8GB+ RAM):**
```bash
ollama pull aya:8b
```

**Basic/Fast (6GB+ RAM):**
```bash
ollama pull qwen2.5:7b-instruct-q4_0
ollama pull llama3.2:3b-instruct-q4_0
```

## Configuration

Copy the example environment file:

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```env
TELEGRAM_API_ID=12345678
TELEGRAM_API_HASH=abcdef0123456789abcdef0123456789
TELEGRAM_CHANNEL=@yourchannel
TELEGRAM_DATE_FROM=2026-01-01T00:00:00Z
TELEGRAM_DATE_TO=2026-01-27T23:59:59Z
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL_ANALYZE=aya:35b       # Best for Farsi (or aya:8b for less RAM)
OLLAMA_MODEL_TRANSLATE=aya:35b     # Best for Farsi (or aya:8b for less RAM)
NOMINATIM_USER_AGENT=TDownloader/1.0
```

## Usage

### Preview (Recommended First Step)

Scan the channel to see what will be downloaded before starting:

```bash
npm run tdownloader preview
```

This shows:
- Total albums and files count
- File types breakdown (photos, videos, documents)
- Estimated download size
- Time estimates for each pipeline stage

### Individual Commands

```bash
# Preview what will be downloaded (fast, no downloads)
npm run tdownloader preview

# Download media from Telegram
npm run tdownloader download

# Analyze captions with Ollama
npm run tdownloader analyze

# Resolve dates (Jalali/relative → Gregorian)
npm run tdownloader resolve

# Geocode locations with Nominatim
npm run tdownloader geocode

# Organize files into bilingual folders
npm run tdownloader organize
```

### Full Pipeline

```bash
npm run tdownloader all
```

### Options

| Flag | Description |
|------|-------------|
| `--resume` | Skip already processed albums |
| `--dry-run` | Preview without making changes |
| `--metadata-only` | Fetch captions only, skip media downloads |
| `--keep-raw` | Keep raw files after organizing |
| `--date-from <date>` | Override start date (ISO format) |
| `--date-to <date>` | Override end date (ISO format) |

Examples:

```bash
# Preview before downloading
npm run tdownloader preview

# Preview a specific date range
npm run tdownloader preview -- --date-from 2024-01-01 --date-to 2024-03-01

# Full pipeline with resume
npm run tdownloader all -- --resume

# Test mode: metadata only (no media downloads)
npm run tdownloader all -- --metadata-only

# Preview without changes
npm run tdownloader all -- --dry-run
```

### Preview Output Example

```
═══════════════════════════════════════════════════════════
                    📊 PREVIEW SUMMARY
═══════════════════════════════════════════════════════════

📁 Content Overview:
   Total albums:     1,234
   Total files:      5,678
   With captions:    1,100

📷 File Types:
   Photos:           4,500
   Videos:           1,000
   Documents:        178

💾 Size Estimate:
   Total size:       ~12.5 GB

⏱️  Time Estimates (with current settings):
   Download:         ~1h 34m
   AI Analysis:      ~10h 17m
   Geocoding:        ~41m
   ─────────────────────────────────
   Total pipeline:   ~12h 32m
```

## Output Structure

```
raw/                              # Downloaded files
├── 2026-01-20/
│   ├── 12345.jpg
│   └── 12346.mp4
└── albums.json

output/                           # Organized files
├── 2026-01-20__1404-11-01/
│   └── ایران__Iran/
│       └── تهران__Tehran/
│           └── میدان_ولیعصر__Valiasr_Square/
│               └── album_123_456/
│                   ├── 12345.jpg
│                   ├── 12346.mp4
│                   ├── caption_fa.txt
│                   ├── caption_en.txt
│                   ├── meta.json
│                   └── items.json
├── cache/
│   └── geocode.sqlite
└── log.json
```

## Rate Limits

| Service | Limit |
|---------|-------|
| Telegram | 1 request/sec |
| Nominatim | 1 request/sec (strict) |
| Ollama | 30s timeout |

## License

MIT
