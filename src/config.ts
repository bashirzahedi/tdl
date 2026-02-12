import { config as dotenvConfig } from 'dotenv';
import path from 'path';
import type { Config, AIProviderType } from './types.js';

dotenvConfig();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getEnv(name: string, defaultValue: string): string {
  return process.env[name] || defaultValue;
}

function getAIProvider(): AIProviderType {
  const provider = process.env['AI_PROVIDER']?.toLowerCase();
  if (provider === 'openai' || provider === 'chatgpt') return 'openai';
  if (provider === 'claude' || provider === 'anthropic') return 'claude';
  if (provider === 'gemini' || provider === 'google') return 'gemini';
  if (provider === 'openai-compat' || provider === 'groq' || provider === 'together' || provider === 'openrouter' || provider === 'lmstudio') return 'openai-compat';
  return 'ollama';
}

function getDefaultModel(provider: AIProviderType): string {
  switch (provider) {
    case 'openai':
      return process.env['OPENAI_MODEL'] || 'gpt-4o-mini';
    case 'claude':
      return process.env['CLAUDE_MODEL'] || 'claude-sonnet-4-20250514';
    case 'gemini':
      return process.env['GEMINI_MODEL'] || 'gemini-2.0-flash';
    case 'openai-compat':
      return process.env['OPENAI_COMPAT_MODEL'] || '';
    case 'ollama':
    default:
      return process.env['OLLAMA_MODEL_ANALYZE'] || 'aya:35b';
  }
}

function parseFallbackProviders(envVal?: string): AIProviderType[] {
  if (!envVal) return [];
  const valid: AIProviderType[] = ['ollama', 'openai', 'claude', 'gemini', 'openai-compat'];
  return envVal
    .split(',')
    .map(s => s.trim().toLowerCase() as AIProviderType)
    .filter(s => valid.includes(s));
}

export function loadConfig(overrides?: Partial<{
  dateFrom: string;
  dateTo: string;
}>): Config {
  const dateFrom = overrides?.dateFrom || requireEnv('TELEGRAM_DATE_FROM');
  const dateTo = overrides?.dateTo || requireEnv('TELEGRAM_DATE_TO');

  const aiProvider = getAIProvider();

  const config: Config = {
    telegram: {
      apiId: parseInt(requireEnv('TELEGRAM_API_ID'), 10),
      apiHash: requireEnv('TELEGRAM_API_HASH'),
      channel: requireEnv('TELEGRAM_CHANNEL'),
      dateFrom: new Date(dateFrom),
      dateTo: new Date(dateTo),
    },
    ai: {
      provider: aiProvider,
      model: getDefaultModel(aiProvider),
      maxRetries: parseInt(getEnv('AI_MAX_RETRIES', '3'), 10),
      retryDelayMs: parseInt(getEnv('AI_RETRY_DELAY_MS', '1000'), 10),
      timeoutMs: parseInt(getEnv('AI_TIMEOUT_MS', '60000'), 10),
      fallbackProviders: parseFallbackProviders(process.env['AI_FALLBACK_PROVIDERS']),
    },
    ollama: {
      url: getEnv('OLLAMA_URL', 'http://localhost:11434'),
      modelAnalyze: getEnv('OLLAMA_MODEL_ANALYZE', 'aya:35b'),
      modelTranslate: getEnv('OLLAMA_MODEL_TRANSLATE', 'aya:35b'),
    },
    nominatim: {
      userAgent: getEnv('NOMINATIM_USER_AGENT', 'TDownloader/1.0'),
    },
    paths: {
      raw: path.resolve(process.cwd(), 'raw'),
      output: path.resolve(process.cwd(), 'output'),
    },
  };

  // Add OpenAI config if API key is set
  const openaiKey = process.env['OPENAI_API_KEY'];
  if (openaiKey) {
    config.openai = {
      apiKey: openaiKey,
      baseUrl: process.env['OPENAI_BASE_URL'],
      model: process.env['OPENAI_MODEL'] || 'gpt-4o-mini',
    };
  }

  // Add Claude config if API key is set
  const claudeKey = process.env['CLAUDE_API_KEY'];
  if (claudeKey) {
    config.claude = {
      apiKey: claudeKey,
      baseUrl: process.env['CLAUDE_BASE_URL'],
      model: process.env['CLAUDE_MODEL'] || 'claude-sonnet-4-20250514',
    };
  }

  // Add Gemini config if API key is set
  const geminiKey = process.env['GEMINI_API_KEY'];
  if (geminiKey) {
    config.gemini = {
      apiKey: geminiKey,
      model: process.env['GEMINI_MODEL'] || 'gemini-2.0-flash',
    };
  }

  // Add OpenAI-compatible config if key and URL are set
  const compatKey = process.env['OPENAI_COMPAT_API_KEY'];
  const compatUrl = process.env['OPENAI_COMPAT_BASE_URL'];
  if (compatKey && compatUrl) {
    config.openaiCompat = {
      apiKey: compatKey,
      baseUrl: compatUrl,
      model: process.env['OPENAI_COMPAT_MODEL'] || '',
    };
  }

  return config;
}
