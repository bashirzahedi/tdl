import axios from 'axios';
import type { Config, Analysis } from './types.js';

export type AIProviderType = 'ollama' | 'openai' | 'claude';

export interface AIResponse {
  text: string;
  success: boolean;
  error?: string;
}

const AI_TIMEOUT = 30000;

// Ollama provider
async function queryOllama(
  config: Config,
  prompt: string,
  maxTokens: number = 500
): Promise<AIResponse> {
  try {
    const response = await axios.post(
      `${config.ollama.url}/api/generate`,
      {
        model: config.ai.provider === 'ollama' ? config.ai.model : config.ollama.modelAnalyze,
        prompt,
        stream: false,
        format: 'json',
        options: {
          temperature: 0.1,
          num_predict: maxTokens,
        },
      },
      {
        timeout: AI_TIMEOUT,
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

// OpenAI/ChatGPT provider
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
        model: config.ai.model || 'gpt-4o-mini',
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
        timeout: AI_TIMEOUT,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.openai.apiKey}`,
        },
      }
    );

    const text = response.data.choices[0]?.message?.content?.trim() || '';
    return {
      text,
      success: true,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    if (axios.isAxiosError(err) && err.response?.data?.error?.message) {
      return {
        text: '',
        success: false,
        error: `OpenAI error: ${err.response.data.error.message}`,
      };
    }
    return {
      text: '',
      success: false,
      error: `OpenAI error: ${errorMsg}`,
    };
  }
}

// Claude/Anthropic provider
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
        model: config.ai.model || 'claude-sonnet-4-20250514',
        max_tokens: maxTokens,
        messages: [
          {
            role: 'user',
            content: prompt + '\n\nRespond ONLY with valid JSON, no other text.',
          },
        ],
      },
      {
        timeout: AI_TIMEOUT,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': config.claude.apiKey,
          'anthropic-version': '2023-06-01',
        },
      }
    );

    const text = response.data.content[0]?.text?.trim() || '';
    return {
      text,
      success: true,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    if (axios.isAxiosError(err) && err.response?.data?.error?.message) {
      return {
        text: '',
        success: false,
        error: `Claude error: ${err.response.data.error.message}`,
      };
    }
    return {
      text: '',
      success: false,
      error: `Claude error: ${errorMsg}`,
    };
  }
}

// Main query function that routes to the appropriate provider
export async function queryAI(
  config: Config,
  prompt: string,
  maxTokens: number = 500
): Promise<AIResponse> {
  const provider = config.ai.provider;

  switch (provider) {
    case 'openai':
      return queryOpenAI(config, prompt, maxTokens);
    case 'claude':
      return queryClaude(config, prompt, maxTokens);
    case 'ollama':
    default:
      return queryOllama(config, prompt, maxTokens);
  }
}

// Parse AI response to Analysis object
export function parseAnalysisResponse(text: string): Analysis | null {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]);

    return {
      dates: Array.isArray(parsed.dates) ? parsed.dates : [],
      locations: typeof parsed.locations === 'object' ? parsed.locations : {},
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
      raw_response: text,
    };
  } catch {
    return null;
  }
}

// Translation helper for all providers
export async function translateText(
  config: Config,
  text: string
): Promise<string> {
  if (!text || text.trim() === '') return '';

  const prompt = `Translate this Farsi text to English. Only output the translation, nothing else:\n\n${text.substring(0, 500)}`;

  // For translation, we don't need JSON format, so handle differently
  const provider = config.ai.provider;

  try {
    if (provider === 'openai' && config.openai?.apiKey) {
      const response = await axios.post(
        config.openai.baseUrl || 'https://api.openai.com/v1/chat/completions',
        {
          model: config.ai.model || 'gpt-4o-mini',
          messages: [
            { role: 'user', content: prompt },
          ],
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
          model: config.ai.model || 'claude-sonnet-4-20250514',
          max_tokens: 200,
          messages: [
            { role: 'user', content: prompt },
          ],
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
  } catch {
    return '';
  }
}

// Get provider display name
export function getProviderDisplayName(provider: AIProviderType): string {
  switch (provider) {
    case 'openai':
      return 'OpenAI (ChatGPT)';
    case 'claude':
      return 'Claude (Anthropic)';
    case 'ollama':
    default:
      return 'Ollama (Local)';
  }
}
