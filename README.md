# TDL the Farsi Telegram Downloader

Download media from Telegram channels, analyze Farsi captions with AI, geocode locations with Nominatim, and organize files into bilingual folder structures.

## Features

- **Preview** scan channel to see file counts, sizes, and time estimates before downloading
- **Download** media (photos, videos) from Telegram channels with GramJS
- **Analyze** Farsi captions to extract dates (Jalali/relative) and locations using AI
- **5 AI Providers** - Ollama (local/free), OpenAI, Claude, Google Gemini, or any OpenAI-compatible API (Groq, Together, OpenRouter, LM Studio)
- **Retry & Fallback** - automatic retries with exponential backoff, plus provider fallback chains
- **Parallel Processing** - cloud providers analyze 3 albums concurrently
- **Convert** Jalali and relative dates (دیروز, جمعه) to Gregorian
- **Geocode** locations via Nominatim with SQLite caching
- **Organize** files into bilingual folders: `ایران__Iran/تهران__Tehran/...`

## Prerequisites

- Node.js 18+
- One of the following AI providers:
  - [Ollama](https://ollama.ai) running locally (free)
  - [OpenAI API key](https://platform.openai.com/api-keys) (paid)
  - [Claude API key](https://console.anthropic.com/) (paid)
  - [Google Gemini API key](https://aistudio.google.com/apikey) (free tier available)
  - Any OpenAI-compatible API (Groq, Together AI, OpenRouter, LM Studio)
- Telegram API credentials from [my.telegram.org](https://my.telegram.org)

## Installation

```bash
npm install
```

## AI Providers

TDL supports five AI providers for Farsi text analysis and translation:

| Provider | Type | Cost | Best For |
|----------|------|------|----------|
| **Ollama** | Local | Free | Privacy, no API costs, offline use |
| **OpenAI** | Cloud | Paid | Best quality, fast responses |
| **Claude** | Cloud | Paid | Excellent Farsi, nuanced analysis |
| **Gemini** | Cloud | Free tier | Good quality, generous free quota |
| **OpenAI-Compatible** | Cloud | Varies | Groq (free), Together, OpenRouter, LM Studio |

### Quick Comparison

| Provider | Model | Farsi Quality | Speed | Cost |
|----------|-------|---------------|-------|------|
| OpenAI | `gpt-4o` | ⭐⭐⭐⭐⭐ | Fast | ~$0.005/album |
| OpenAI | `gpt-4o-mini` | ⭐⭐⭐⭐ | Very Fast | ~$0.0005/album |
| Claude | `claude-sonnet-4-20250514` | ⭐⭐⭐⭐⭐ | Fast | ~$0.003/album |
| Claude | `claude-3-5-haiku-20241022` | ⭐⭐⭐⭐ | Very Fast | ~$0.001/album |
| Gemini | `gemini-2.0-flash` | ⭐⭐⭐⭐ | Very Fast | Free (limits) |
| Groq | `llama-3.3-70b-versatile` | ⭐⭐⭐⭐ | Fastest | Free (limits) |
| Ollama | `aya:35b` | ⭐⭐⭐⭐⭐ | Slow | Free |
| Ollama | `aya:8b` | ⭐⭐⭐⭐ | Medium | Free |

## Ollama Models (Local AI)

If using Ollama, the quality depends heavily on the model. Here are the recommended models for Farsi:

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

### Using Ollama (Local/Free)

```env
TELEGRAM_API_ID=12345678
TELEGRAM_API_HASH=abcdef0123456789abcdef0123456789
TELEGRAM_CHANNEL=@yourchannel
TELEGRAM_DATE_FROM=2026-01-01T00:00:00Z
TELEGRAM_DATE_TO=2026-01-27T23:59:59Z

AI_PROVIDER=ollama
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL_ANALYZE=aya:35b
OLLAMA_MODEL_TRANSLATE=aya:35b

NOMINATIM_USER_AGENT=TDownloader/1.0

# Optional: copy organized files to a second directory
# EXTRA_OUTPUT_DIR=/mnt/nas/photos
```

### Using OpenAI/ChatGPT

```env
AI_PROVIDER=openai
OPENAI_API_KEY=sk-your-api-key-here
OPENAI_MODEL=gpt-4o-mini    # or gpt-4o for best quality
```

### Using Claude

```env
AI_PROVIDER=claude
CLAUDE_API_KEY=sk-ant-your-api-key-here
CLAUDE_MODEL=claude-sonnet-4-20250514    # or claude-3-5-haiku-20241022 for faster/cheaper
```

### Using Google Gemini

```env
AI_PROVIDER=gemini
GEMINI_API_KEY=your-gemini-api-key-here
GEMINI_MODEL=gemini-2.0-flash    # or gemini-1.5-pro for best quality
```

### Using Groq (Free, Fast)

```env
AI_PROVIDER=groq
OPENAI_COMPAT_API_KEY=your-groq-api-key
OPENAI_COMPAT_BASE_URL=https://api.groq.com/openai/v1/chat/completions
OPENAI_COMPAT_MODEL=llama-3.3-70b-versatile
```

### Using Together AI

```env
AI_PROVIDER=together
OPENAI_COMPAT_API_KEY=your-together-api-key
OPENAI_COMPAT_BASE_URL=https://api.together.xyz/v1/chat/completions
OPENAI_COMPAT_MODEL=meta-llama/Llama-3.3-70B-Instruct-Turbo
```

### Using OpenRouter

```env
AI_PROVIDER=openrouter
OPENAI_COMPAT_API_KEY=your-openrouter-api-key
OPENAI_COMPAT_BASE_URL=https://openrouter.ai/api/v1/chat/completions
OPENAI_COMPAT_MODEL=meta-llama/llama-3.3-70b-instruct
```

### Retry & Fallback Configuration

```env
# Retry up to 3 times on transient errors (429, 5xx, timeouts)
AI_MAX_RETRIES=3
AI_RETRY_DELAY_MS=1000
AI_TIMEOUT_MS=60000

# If primary provider fails, try these in order
AI_FALLBACK_PROVIDERS=openai,gemini
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

# Analyze captions with AI (uses configured provider)
npm run tdownloader analyze

# Analyze with a specific provider (overrides .env)
npm run tdownloader analyze -- --provider gemini

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

| Flag | Command | Description |
|------|---------|-------------|
| `--resume` | all, download, analyze, geocode, organize | Skip already processed albums |
| `--dry-run` | all commands | Preview without making changes |
| `--metadata-only` | download, organize | Fetch captions only, skip media files |
| `--keep-raw` | organize, all | Keep raw files after organizing |
| `--extra-output <path>` | organize, all | Copy organized files to an additional directory |
| `--provider <name>` | analyze | Override AI provider for this run |
| `--date-from <date>` | download, preview, all | Override start date (ISO format) |
| `--date-to <date>` | download, preview, all | Override end date (ISO format) |

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

# Analyze with Gemini instead of configured provider
npm run tdownloader analyze -- --provider gemini

# Organize and copy to a second folder
npm run tdownloader organize -- --extra-output /mnt/nas/photos

# Full pipeline with extra output
npm run tdownloader all -- --resume --extra-output /mnt/nas/photos
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

## Rate Limits & Reliability

| Service | Limit | Notes |
|---------|-------|-------|
| Telegram | 1 req/sec | Built-in rate limiter |
| Nominatim | 1 req/sec | OSM policy, cached in SQLite |
| AI Providers | Configurable | Default: 60s timeout, 3 retries with exponential backoff |
| Cloud AI | 3 concurrent | Parallel batch processing for cloud providers |
| Ollama | 1 sequential | Local resource constraint |

Transient errors (429 rate limits, 5xx server errors, timeouts) are automatically retried. Auth errors (401/403) fail immediately. If a provider fails after all retries, the fallback chain kicks in.

## License

MIT
