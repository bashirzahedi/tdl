import { config as dotenvConfig } from 'dotenv';
import path from 'path';
import type { Config } from './types.js';

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

export function loadConfig(overrides?: Partial<{
  dateFrom: string;
  dateTo: string;
}>): Config {
  const dateFrom = overrides?.dateFrom || requireEnv('TELEGRAM_DATE_FROM');
  const dateTo = overrides?.dateTo || requireEnv('TELEGRAM_DATE_TO');

  return {
    telegram: {
      apiId: parseInt(requireEnv('TELEGRAM_API_ID'), 10),
      apiHash: requireEnv('TELEGRAM_API_HASH'),
      channel: requireEnv('TELEGRAM_CHANNEL'),
      dateFrom: new Date(dateFrom),
      dateTo: new Date(dateTo),
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
}
