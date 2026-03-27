export interface FastifyParams {
  id?: string;
  episodeId?: string;
  date?: string;
  sort?: string;
  genre?: string;
  country?: string;
  season?: string;
  episode?: number;
  year?: string;
  status?: string;
  category?: string;
  format?: string;
}

export interface FastifyQuery {
  q?: string;
  year?: string;
  type?: string;
  page?: number;
  perPage?: number;
  format?: string;
  version?: string;
  server?: string;
  provider?: string;
  timeWindow?: string;
  country?: string;
  genre?: string;
  quality?: string;
}
export type BrowserName = 'firefox' | 'chrome';
export type DeviceType = 'desktop' | 'mobile';
export type OperatingSystem = 'windows' | 'ios' | 'android';
export type Locale = (typeof Locales)[number];

export const IAMetaFormatArr = ['TV', 'MOVIE', 'SPECIAL', 'OVA', 'ONA', 'MUSIC', 'MANGA'] as const;

export const IAnimeCategoryArr = ['TV', 'MOVIE', 'SPECIALS', 'OVA', 'ONA'] as const;

export const IAnimeSeasonsArr = ['WINTER', 'SPRING', 'SUMMER', 'FALL'] as const;

const Locales = [
  'en-US',
  'en-CA',
  'es-MX',
  'pt-BR',
  'es-US',
  'fr-CA',

  'en-GB',
  'de-DE',
  'fr-FR',
  'it-IT',
  'es-ES',
  'nl-NL',
  'pt-PT',
  'de-CH',
  'fr-CH',
  'de-AT',
  'nl-BE',
  'fr-BE',

  'ru-RU',
  'pl-PL',
  'sv-SE',
  'da-DK',
  'nb-NO',
  'fi-FI',
  'cs-CZ',
  'hu-HU',
  'uk-UA',
  'ro-RO',
  'el-GR',

  'ja-JP',
  'ko-KR',
  'zh-CN',
  'zh-TW',
  'zh-HK',
  'en-AU',
  'en-NZ',
  'en-SG',
  'en-IN',
  'hi-IN',
  'th-TH',
  'vi-VN',
  'id-ID',
  'ms-MY',
  'tl-PH',

  'ar-SA',
  'ar-EG',
  'he-IL',
  'tr-TR',
  'fa-IR',
  'en-ZA',
  'ar-AE',
];
export const allowedProviders = ['hianime', 'animepahe', 'anizone', 'kaido', 'animekai'];

export interface ClientConfig {
  /**
   * Proxy URL to route all requests through.
   *
   * @default undefined
   */
  proxyUrl?: string;

  /**
   * Session token
   * * @default undefined
   */
  token?: string;

  headerGeneratorOptions?: {
    browsers?: Array<{ name: BrowserName; minVersion?: number; maxVersion?: number }>;
    devices?: DeviceType[];
    locales?: Locale[];
    operatingSystems?: OperatingSystem[];
  };

  /**
   * Whether to use HTTP/2 protocol
   * @default true
   */
  http2?: boolean;

  /**
   * Request timeout in milliseconds
   * @default 15000 (15 seconds)
   */
  timeout?: number;

  /**
   * Delay between consecutive requests in milliseconds
   * @default 400
   */
  delayBetweenRequests?: number;

  /**
   * Number of automatic retries on network/timeout errors
   * @default 2
   */
  retries?: number;
}
