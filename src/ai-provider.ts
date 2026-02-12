import axios from 'axios';
import type { Config, Analysis, AIProviderType, LocationInfo } from './types.js';
import { sleep } from './utils.js';

export interface AIResponse {
  text: string;
  success: boolean;
  error?: string;
}

// --- Individual provider functions ---

async function queryOllama(
  config: Config,
  prompt: string,
  maxTokens: number = 500
): Promise<AIResponse> {
  try {
    const response = await axios.post(
      `${config.ollama.url}/api/generate`,
      {
        model: config.ai.model || config.ollama.modelAnalyze,
        prompt,
        stream: false,
        format: 'json',
        options: {
          temperature: 0.1,
          num_predict: maxTokens,
        },
      },
      {
        timeout: config.ai.timeoutMs,
        headers: { 'Content-Type': 'application/json' },
      }
    );

    return {
      text: response.data.response.trim(),
      success: true,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      text: '',
      success: false,
      error: `Ollama error: ${errorMsg}`,
    };
  }
}

async function queryOpenAI(
  config: Config,
  prompt: string,
  maxTokens: number = 500
): Promise<AIResponse> {
  if (!config.openai?.apiKey) {
    return {
      text: '',
      success: false,
      error: 'OpenAI API key not configured. Set OPENAI_API_KEY in .env',
    };
  }

  try {
    const response = await axios.post(
      config.openai.baseUrl || 'https://api.openai.com/v1/chat/completions',
      {
        model: config.openai.model || 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are a helpful assistant that analyzes Farsi text and extracts structured information. Always respond with valid JSON.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        max_tokens: maxTokens,
        temperature: 0.1,
        response_format: { type: 'json_object' },
      },
      {
        timeout: config.ai.timeoutMs,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.openai.apiKey}`,
        },
      }
    );

    const text = response.data.choices[0]?.message?.content?.trim() || '';
    return { text, success: true };
  } catch (err) {
    return formatAxiosError('OpenAI', err);
  }
}

async function queryClaude(
  config: Config,
  prompt: string,
  maxTokens: number = 500
): Promise<AIResponse> {
  if (!config.claude?.apiKey) {
    return {
      text: '',
      success: false,
      error: 'Claude API key not configured. Set CLAUDE_API_KEY in .env',
    };
  }

  try {
    const response = await axios.post(
      config.claude.baseUrl || 'https://api.anthropic.com/v1/messages',
      {
        model: config.claude?.model || 'claude-sonnet-4-20250514',
        max_tokens: maxTokens,
        messages: [
          {
            role: 'user',
            content: prompt + '\n\nRespond ONLY with valid JSON, no other text.',
          },
        ],
      },
      {
        timeout: config.ai.timeoutMs,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': config.claude.apiKey,
          'anthropic-version': '2023-06-01',
        },
      }
    );

    const text = response.data.content[0]?.text?.trim() || '';
    return { text, success: true };
  } catch (err) {
    return formatAxiosError('Claude', err);
  }
}

async function queryGemini(
  config: Config,
  prompt: string,
  maxTokens: number = 500
): Promise<AIResponse> {
  if (!config.gemini?.apiKey) {
    return {
      text: '',
      success: false,
      error: 'Gemini API key not configured. Set GEMINI_API_KEY in .env',
    };
  }

  try {
    const model = config.gemini?.model || 'gemini-2.0-flash';
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.gemini.apiKey}`,
      {
        contents: [
          {
            parts: [
              {
                text: prompt + '\n\nRespond ONLY with valid JSON, no other text.',
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: maxTokens,
          responseMimeType: 'application/json',
        },
      },
      {
        timeout: config.ai.timeoutMs,
        headers: { 'Content-Type': 'application/json' },
      }
    );

    // Check for safety filter blocks
    if (response.data.candidates?.[0]?.finishReason === 'SAFETY') {
      return {
        text: '',
        success: false,
        error: 'Gemini: Content blocked by safety filters',
      };
    }

    const text = response.data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
    return { text, success: true };
  } catch (err) {
    return formatAxiosError('Gemini', err);
  }
}

async function queryOpenAICompat(
  config: Config,
  prompt: string,
  maxTokens: number = 500
): Promise<AIResponse> {
  if (!config.openaiCompat?.apiKey || !config.openaiCompat?.baseUrl) {
    return {
      text: '',
      success: false,
      error: 'OpenAI-compatible provider not configured. Set OPENAI_COMPAT_API_KEY and OPENAI_COMPAT_BASE_URL in .env',
    };
  }

  const model = config.openaiCompat.model || config.ai.model;
  if (!model) {
    return {
      text: '',
      success: false,
      error: 'OpenAI-compatible provider requires a model. Set OPENAI_COMPAT_MODEL in .env',
    };
  }

  try {
    const response = await axios.post(
      config.openaiCompat.baseUrl,
      {
        model,
        messages: [
          {
            role: 'system',
            content: 'You are a helpful assistant that analyzes Farsi text and extracts structured information. Always respond with valid JSON.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        max_tokens: maxTokens,
        temperature: 0.1,
        // NOTE: No response_format — not all compatible APIs support it
      },
      {
        timeout: config.ai.timeoutMs,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.openaiCompat.apiKey}`,
        },
      }
    );

    const text = response.data.choices?.[0]?.message?.content?.trim() || '';
    return { text, success: true };
  } catch (err) {
    return formatAxiosError('OpenAI-compat', err);
  }
}

// --- Error formatting helper ---

function formatAxiosError(provider: string, err: unknown): AIResponse {
  const errorMsg = err instanceof Error ? err.message : String(err);
  if (axios.isAxiosError(err)) {
    const data = err.response?.data;
    // Handle both { error: { message: "..." } } and { error: "..." } formats
    const apiMsg = typeof data?.error === 'string'
      ? data.error
      : data?.error?.message;
    if (apiMsg) {
      return {
        text: '',
        success: false,
        error: `${provider} error: ${apiMsg}`,
      };
    }
  }
  return {
    text: '',
    success: false,
    error: `${provider} error: ${errorMsg}`,
  };
}

// --- Retry logic ---

function isRetryableError(error: string | undefined): boolean {
  if (!error) return false;
  const retryablePatterns = [
    'timeout', 'etimedout', 'econnreset', 'econnrefused', 'enotfound',
    '429', 'rate limit', 'too many requests',
    '500', '502', '503', '504',
    'internal server error', 'bad gateway', 'service unavailable',
    'overloaded',
  ];
  const lower = error.toLowerCase();
  return retryablePatterns.some(p => lower.includes(p));
}

type ProviderQueryFn = (config: Config, prompt: string, maxTokens: number) => Promise<AIResponse>;

async function queryWithRetry(
  config: Config,
  queryFn: ProviderQueryFn,
  prompt: string,
  maxTokens: number
): Promise<AIResponse> {
  const maxRetries = config.ai.maxRetries;
  const baseDelay = config.ai.retryDelayMs;

  let lastResult: AIResponse = { text: '', success: false, error: 'No attempts made' };

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    lastResult = await queryFn(config, prompt, maxTokens);

    if (lastResult.success) return lastResult;

    // Don't retry non-retryable errors (auth, bad request, etc.)
    if (!isRetryableError(lastResult.error)) return lastResult;

    // Don't sleep after the last attempt
    if (attempt < maxRetries) {
      const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 500;
      console.log(`   Retry ${attempt + 1}/${maxRetries} after ${Math.round(delay)}ms: ${lastResult.error}`);
      await sleep(delay);
    }
  }

  return lastResult;
}

// --- Provider routing ---

function getProviderQueryFn(provider: AIProviderType): ProviderQueryFn | null {
  switch (provider) {
    case 'openai': return queryOpenAI;
    case 'claude': return queryClaude;
    case 'gemini': return queryGemini;
    case 'openai-compat': return queryOpenAICompat;
    case 'ollama': return queryOllama;
    default: return null;
  }
}

function isProviderConfigured(config: Config, provider: AIProviderType): boolean {
  switch (provider) {
    case 'openai': return !!config.openai?.apiKey;
    case 'claude': return !!config.claude?.apiKey;
    case 'gemini': return !!config.gemini?.apiKey;
    case 'openai-compat': return !!(config.openaiCompat?.apiKey && config.openaiCompat?.baseUrl);
    case 'ollama': return !!config.ollama?.url;
    default: return false;
  }
}

// --- Main query function with fallback chain ---

export async function queryAI(
  config: Config,
  prompt: string,
  maxTokens: number = 500
): Promise<AIResponse> {
  const providersToTry: AIProviderType[] = [
    config.ai.provider,
    ...config.ai.fallbackProviders.filter(p => p !== config.ai.provider),
  ];

  let lastResult: AIResponse = { text: '', success: false, error: 'No providers configured' };

  for (let i = 0; i < providersToTry.length; i++) {
    const provider = providersToTry[i];
    const queryFn = getProviderQueryFn(provider);
    if (!queryFn) continue;

    // Skip providers that aren't configured
    if (!isProviderConfigured(config, provider)) {
      if (i > 0) {
        console.log(`   Skipping fallback ${provider} (not configured)`);
      }
      continue;
    }

    lastResult = await queryWithRetry(config, queryFn, prompt, maxTokens);

    if (lastResult.success) return lastResult;

    if (i < providersToTry.length - 1) {
      console.log(`   Provider ${provider} failed: ${lastResult.error || 'unknown error'}`);
      console.log(`   Trying next fallback...`);
    }
  }

  return lastResult;
}

// --- Parse AI response to Analysis ---

export function parseAnalysisResponse(text: string): Analysis | null {
  try {
    // First: try parsing the entire text as JSON
    try {
      const parsed = JSON.parse(text);
      return validateAnalysis(parsed, text);
    } catch {
      // Not valid JSON as-is, try extraction
    }

    // Second: find the first JSON object by counting brace depth
    const startIdx = text.indexOf('{');
    if (startIdx === -1) return null;

    let depth = 0;
    let endIdx = -1;
    for (let i = startIdx; i < text.length; i++) {
      if (text[i] === '{') depth++;
      if (text[i] === '}') depth--;
      if (depth === 0) { endIdx = i; break; }
    }

    if (endIdx === -1) return null;

    const jsonStr = text.substring(startIdx, endIdx + 1);
    const parsed = JSON.parse(jsonStr);
    return validateAnalysis(parsed, text);
  } catch {
    return null;
  }
}

function validateAnalysis(parsed: Record<string, unknown>, rawText: string): Analysis {
  return {
    dates: Array.isArray(parsed.dates) ? parsed.dates : [],
    locations: typeof parsed.locations === 'object' && parsed.locations !== null
      ? parsed.locations as LocationInfo
      : {},
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
    raw_response: rawText,
  };
}

// --- Translation helper ---

export async function translateText(
  config: Config,
  text: string
): Promise<string> {
  if (!text || text.trim() === '') return '';

  const prompt = `Translate this Farsi text to English. Only output the translation, nothing else:\n\n${text.substring(0, 500)}`;

  const provider = config.ai.provider;

  try {
    if (provider === 'openai' && config.openai?.apiKey) {
      const response = await axios.post(
        config.openai.baseUrl || 'https://api.openai.com/v1/chat/completions',
        {
          model: config.openai.model || 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 200,
          temperature: 0.1,
        },
        {
          timeout: 15000,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.openai.apiKey}`,
          },
        }
      );
      return response.data.choices[0]?.message?.content?.trim() || '';
    }

    if (provider === 'claude' && config.claude?.apiKey) {
      const response = await axios.post(
        config.claude.baseUrl || 'https://api.anthropic.com/v1/messages',
        {
          model: config.claude.model || 'claude-sonnet-4-20250514',
          max_tokens: 200,
          messages: [{ role: 'user', content: prompt }],
        },
        {
          timeout: 15000,
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': config.claude.apiKey,
            'anthropic-version': '2023-06-01',
          },
        }
      );
      return response.data.content[0]?.text?.trim() || '';
    }

    if (provider === 'gemini' && config.gemini?.apiKey) {
      const model = config.gemini.model || 'gemini-2.0-flash';
      const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.gemini.apiKey}`,
        {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 200 },
        },
        {
          timeout: 15000,
          headers: { 'Content-Type': 'application/json' },
        }
      );
      return response.data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
    }

    if (provider === 'openai-compat' && config.openaiCompat?.apiKey && config.openaiCompat?.baseUrl) {
      const model = config.openaiCompat.model || config.ai.model;
      const response = await axios.post(
        config.openaiCompat.baseUrl,
        {
          model,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 200,
          temperature: 0.1,
        },
        {
          timeout: 15000,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.openaiCompat.apiKey}`,
          },
        }
      );
      return response.data.choices?.[0]?.message?.content?.trim() || '';
    }

    // Default: Ollama
    const response = await axios.post(
      `${config.ollama.url}/api/generate`,
      {
        model: config.ollama.modelTranslate,
        prompt,
        stream: false,
        options: {
          temperature: 0.1,
          num_predict: 200,
        },
      },
      {
        timeout: 15000,
        headers: { 'Content-Type': 'application/json' },
      }
    );
    return response.data.response.trim();
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.log(`   Translation failed (${provider}): ${errorMsg}`);
    return '';
  }
}

// --- Display name ---

export function getProviderDisplayName(provider: AIProviderType): string {
  switch (provider) {
    case 'openai': return 'OpenAI (ChatGPT)';
    case 'claude': return 'Claude (Anthropic)';
    case 'gemini': return 'Google Gemini';
    case 'openai-compat': return 'OpenAI-Compatible';
    case 'ollama':
    default: return 'Ollama (Local)';
  }
}
