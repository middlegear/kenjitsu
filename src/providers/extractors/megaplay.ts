import crypto from 'node:crypto';
import * as cheerio from 'cheerio';
import { BaseClass, type ClientConfig } from '../models/base.js';
import type { IResponse, IVideoSource } from '../../types/base.js';

export class MegaPlay extends BaseClass {
  private baseUrl = 'https://megaplay.buzz/stream';

  constructor(options: ClientConfig) {
    super(options);
  }

  private parseMediaId($: cheerio.CheerioAPI) {
    const selector = 'body div.mg3-player > div.fix-area';

    return (
      $(selector).attr('data-id')?.trim() ??
      $('title')
        .text()
        .match(/File\s+(\d+)/i)?.[1] ??
      null
    );
  }

  private processSource(enc?: string, source?: string): string | null {
    let m3u8 = source ?? null;

    if (enc) {
      try {
        const key = Buffer.alloc(32);
        Buffer.from('i?LMTAx0Q6,:}50U', 'utf8').copy(key);

        const iv = Buffer.from("W0;27ToaUpl_P%'c", 'utf8');
        const encrypted = Buffer.from(enc, 'base64url');

        if (!encrypted.length || encrypted.length % 16 !== 0) {
          return null;
        }

        const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);

        const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);

        const data = JSON.parse(decrypted.toString('utf8'));

        if (typeof data?.file === 'string') {
          m3u8 = data.file;
        }
      } catch {
        return null;
      }
    }

    if (!m3u8) {
      return null;
    }

    if (/[?&]token=/i.test(m3u8)) {
      return m3u8;
    }

    const match = m3u8.match(/\/([a-f0-9]{32})\/([a-f0-9]{32})\//i);

    if (!match) {
      return m3u8;
    }

    const pathKey = `${match[1].toLowerCase()}/${match[2].toLowerCase()}`;
    const payload = `${Math.floor(Date.now() / 1000) + 90}|${pathKey}`;
    const secret = 'MpCdnT0k3n!9f2K#xQ7vL5mR8wN1pY4s';

    const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');

    const token = `${Buffer.from(payload, 'utf8').toString('base64url')}.${signature}`;

    const url = new URL(m3u8);
    url.searchParams.set('token', token);

    return url.href;
  }

  private buildGetSourcesUrl(videoUrl: URL, id: string): string {
    const url = new URL(`${this.baseUrl}/getSources`);
    url.searchParams.set('id', id);

    const serverParam = videoUrl.searchParams.get('s');
    if (serverParam) {
      url.searchParams.set('s', serverParam);
    }

    return url.href;
  }

  async extract(videoUrl: URL, referer: string): Promise<IResponse<IVideoSource | null>> {
    const extractedData: IVideoSource = {
      intro: { start: 0, end: 0 },
      outro: { start: 0, end: 0 },
      subtitles: [],
      sources: [],
    };

    try {
      const initialResponse = await this.client.fetch(videoUrl.href, {
        method: 'GET',
        headers: {
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'X-Requested-With': 'XMLHttpRequest',
          'Accept-Encoding': 'gzip, deflate, br, zstd',
          Referer: `${referer}/`,
        },
      });

      if (!initialResponse.ok) {
        return {
          data: null,
          error: initialResponse.statusText,
          status: initialResponse.status,
        };
      }

      const initialResult = await initialResponse.text();
      const id = this.parseMediaId(cheerio.load(initialResult));

      if (!id) {
        return {
          data: null,
          error: 'Failed to find media ID',
          status: 500,
        };
      }

      const getSourcesUrl = this.buildGetSourcesUrl(videoUrl, id);
      console.log(getSourcesUrl);

      const response = await this.client.fetch(getSourcesUrl, {
        method: 'GET',
        headers: {
          Accept: 'application/json,*/*',
          'Accept-Encoding': 'gzip, deflate, br, zstd',
          'X-Requested-With': 'XMLHttpRequest',
          Referer: videoUrl.href,
        },
      });

      if (!response.ok) {
        return {
          data: null,
          error: response.statusText,
          status: response.status,
        };
      }

      const result: any = await response.json();

      const source = this.processSource(result?.enc, result?.sources?.file ?? result?.sources);

      if (!source) {
        return {
          data: null,
          error: 'Failed to decrypt/find source',
          status: 500,
        };
      }

      extractedData.sources.push({
        url: source,
        isM3u8: /\.m3u8(?:$|[?#])/i.test(source),
        type: /\.m3u8(?:$|[?#])/i.test(source) ? 'hls' : 'unknown',
      });

      extractedData.intro = result?.intro ?? extractedData.intro;
      extractedData.outro = result?.outro ?? extractedData.outro;

      extractedData.subtitles = (result?.tracks ?? [])
        .filter((item: any) => item.label?.toLowerCase().includes('english'))
        .map((item: any) => ({
          url: item.file,
          lang: item.label,
          default: !!item.default,
        }));

      return {
        data: extractedData,
      };
    } catch (error) {
      return {
        data: null,
        error: error instanceof Error ? error.message : 'Unknown Error',
        status: 500,
      };
    }
  }
}
