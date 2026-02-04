export interface AlbumItem {
  id: number;
  path: string;
  type: 'photo' | 'video' | 'document';
  size?: number;
}

export interface LocationInfo {
  country_fa?: string;
  country_en?: string;
  province_fa?: string;
  province_en?: string;
  city_fa?: string;
  city_en?: string;
  area_fa?: string;
  area_en?: string;
  lat?: number;
  lon?: number;
}

export interface Analysis {
  dates: string[];
  locations: LocationInfo;
  confidence: number;
  raw_response?: string;
}

export interface ResolvedDates {
  gregorian: string;
  jalali: string;
  source: 'jalali' | 'relative' | 'telegram_fallback';
}

export interface Album {
  album_id: string;
  telegram_date: string;
  caption_fa: string;
  items: AlbumItem[];
  analysis?: Analysis;
  resolved_dates?: ResolvedDates;
  geocoded?: LocationInfo;
}

export interface AlbumsData {
  version: string;
  channel: string;
  date_range: {
    from: string;
    to: string;
  };
  downloaded_at: string;
  albums: Album[];
}

export interface LogEntry {
  timestamp: string;
  step: string;
  status: 'success' | 'error' | 'warning';
  message: string;
  album_id?: string;
  details?: Record<string, unknown>;
}

export interface Stats {
  albums_total: number;
  files_total: number;
  files_size_bytes: number;
  cache_hits: number;
  cache_misses: number;
  low_confidence: number;
  errors: number;
  warnings: number;
}

export type AIProviderType = 'ollama' | 'openai' | 'claude';

export interface Config {
  telegram: {
    apiId: number;
    apiHash: string;
    channel: string;
    dateFrom: Date;
    dateTo: Date;
  };
  ai: {
    provider: AIProviderType;
    model: string;
  };
  ollama: {
    url: string;
    modelAnalyze: string;
    modelTranslate: string;
  };
  openai?: {
    apiKey: string;
    baseUrl?: string;
  };
  claude?: {
    apiKey: string;
    baseUrl?: string;
  };
  nominatim: {
    userAgent: string;
  };
  paths: {
    raw: string;
    output: string;
  };
}

export interface GeocodeCacheEntry {
  query: string;
  result: LocationInfo | null;
  created_at: number;
}
