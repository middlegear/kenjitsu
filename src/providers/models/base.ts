import { type ClientOptions, Client } from '../../config/client.js';

export interface ClientConfig extends ClientOptions {}

export abstract class BaseClass {
  protected readonly client: Client;
  protected readonly STATUS_TEXT_MAP: Record<number, string> = {
    100: 'Continue',
    101: 'Switching Protocols',
    102: 'Processing',
    103: 'Early Hints',

    200: 'OK',
    201: 'Created',
    202: 'Accepted',
    203: 'Non-Authoritative Information',
    204: 'No Content',
    205: 'Reset Content',
    206: 'Partial Content',
    207: 'Multi-Status',
    208: 'Already Reported',
    226: 'IM Used',

    300: 'Multiple Choices',
    301: 'Moved Permanently',
    302: 'Found',
    303: 'See Other',
    304: 'Not Modified',
    305: 'Use Proxy',
    306: 'unused',
    307: 'Temporary Redirect',
    308: 'Permanent Redirect',

    400: 'Bad Request',
    401: 'Unauthorized',
    402: 'Payment Required',
    403: 'Forbidden',
    404: 'Not Found',
    405: 'Method Not Allowed',
    406: 'Not Acceptable',
    407: 'Proxy Authentication Required',
    408: 'Request Timeout',
    409: 'Conflict',
    410: 'Gone',
    411: 'Length Required',
    412: 'Precondition Failed',
    413: 'Payload Too Large',
    414: 'URI Too Long',
    415: 'Unsupported Media Type',
    416: 'Range Not Satisfiable',
    417: 'Expectation Failed',
    418: "I'm a teapot",
    421: 'Misdirected Request',
    422: 'Unprocessable Entity',
    423: 'Locked',
    424: 'Failed Dependency',
    425: 'Too Early',
    426: 'Upgrade Required',
    428: 'Precondition Required',
    429: 'Too Many Requests',
    431: 'Request Header Fields Too Large',
    444: 'No Response',
    451: 'Unavailable For Legal Reasons',
    499: 'Client Closed Request',

    500: 'Internal Server Error',
    501: 'Not Implemented',
    502: 'Bad Gateway',
    503: 'Service Unavailable',
    504: 'Gateway Timeout',
    505: 'HTTP Version Not Supported',
    506: 'Variant Also Negotiates',
    507: 'Insufficient Storage',
    508: 'Loop Detected',
    509: 'Bandwidth Limit Exceeded',
    510: 'Not Extended',
    511: 'Network Authentication Required',

    520: 'Web Server Returned an Unknown Error',
    521: 'Web Server Is Down',
    522: 'Connection Timed Out',
    523: 'Origin Is Unreachable',
    524: 'A Timeout Occurred',
    525: 'SSL Handshake Failed',
    526: 'Invalid SSL Certificate',
    527: 'Railgun Error',
    530: 'Site Is Frozen',
  };

  constructor(options: ClientConfig = {}) {
    const config: ClientOptions = {
      browser: 'chrome142',
      timeout: 15000,
      ignoreTlsErrors: true,
      ...options,
    };

    this.client = new Client(config);
  }

  protected formatHttpError(statusCode: number, statusText?: string): string {
    const resolvedText = statusText?.trim() || this.STATUS_TEXT_MAP[statusCode] || 'Unknown Error';
    return `Request failed with status: ${statusCode} & message: ${resolvedText}`;
  }

  protected createSlug(text: string): string {
    return text
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
  protected createSearchableTitle(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .join(' ');
  }
  protected normalizeKey(input: string): string {
    return input
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '')
      .replace(/[^a-z0-9]/g, '');
  }

  protected getMappedValue<T extends string, U extends string>(input: T, mapping: Record<string, U>): U {
    const normalized = this.normalizeKey(input);

    const found = Object.entries(mapping).find(([key]) => this.normalizeKey(key) === normalized);

    if (!found) {
      throw new Error(`Invalid: ${input}. Must be one of: ${Object.keys(mapping).join(', ')}`);
    }

    return found[1] as U;
  }
}
