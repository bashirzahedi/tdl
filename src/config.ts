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
  return 'ollama';
}

function getDefaultModel(provider: AIProviderType): string {
  switch (provider) {
    case 'openai':
      return process.env['OPENAI_MODEL'] || 'gpt-4o-mini';
    case 'claude':
      return process.env['CLAUDE_MODEL'] || 'claude-sonnet-4-20250514';
    case 'ollama':
    default:
      return process.env['OLLAMA_MODEL_ANALYZE'] || 'aya:35b';
  }
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
    };
  }

  // Add Claude config if API key is set
  const claudeKey = process.env['CLAUDE_API_KEY'];
  if (claudeKey) {
    config.claude = {
      apiKey: claudeKey,
      baseUrl: process.env['CLAUDE_BASE_URL'],
    };
  }

  return config;
}
