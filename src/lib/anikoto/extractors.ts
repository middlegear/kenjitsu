import axios from 'axios';
import { ANIKOTO_DEFAULT_HEADERS } from './constants.js';

export interface SubtitleTrack {
  file: string;
  label?: string;
  kind?: string;
  default?: boolean;
}

export interface ExtractedStream {
  m3u8: string;
  referer: string;
  tracks: SubtitleTrack[];
}

export async function extractMegaplay(embedUrl: string): Promise<ExtractedStream | null> {
  try {
    const host = new URL(embedUrl).host;
    const referer = 'https://' + host + '/';

    const { data: html } = await axios.get(embedUrl, {
      headers: { ...ANIKOTO_DEFAULT_HEADERS, Referer: referer },
    });

    const match = (html as string).match(/<title>File ([0-9]+)/);
    if (!match) return null;

    const id = match[1];
    const { data } = await axios.get(`https://${host}/stream/getSources?id=${id}`, {
      headers: { ...ANIKOTO_DEFAULT_HEADERS, 'X-Requested-With': 'XMLHttpRequest', Referer: referer },
    });

    const m3u8 = (data as any)?.sources?.file;
    const tracks = (data as any)?.tracks || [];
    return m3u8 ? { m3u8, referer, tracks } : null;
  } catch (err) {
    console.error('Megaplay extraction failed:', err);
    return null;
  }
}

export async function extractMegacloud(embedUrl: string): Promise<ExtractedStream | null> {
  try {
    const origin = new URL(embedUrl).origin;
    const referer = origin + '/';

    const { data: html } = await axios.get(embedUrl, {
      headers: { ...ANIKOTO_DEFAULT_HEADERS, Referer: referer },
    });

    const match1 = (html as string).match(/\b[a-zA-Z0-9]{48}\b/);
    const match2 = (html as string).match(/\b([a-zA-Z0-9]{16})\b.*?\b([a-zA-Z0-9]{16})\b.*?\b([a-zA-Z0-9]{16})\b/);
    const nonce = match1?.[0] || (match2 ? match2[1] + match2[2] + match2[3] : null);

    if (!nonce) return null;

    const sId =
      embedUrl.split('/e-1/')[1]?.split('?')[0] ??
      embedUrl.split('/').pop()?.split('?')[0];
    const url = `${origin}/embed-2/v3/e-1/getSources?id=${sId}&_k=${nonce}`;

    const { data } = await axios.get(url, {
      headers: { ...ANIKOTO_DEFAULT_HEADERS, Accept: '*/*', 'X-Requested-With': 'XMLHttpRequest', Referer: referer },
    });

    const tracks = (data as any)?.tracks || [];

    if (!(data as any).encrypted || ((data as any).sources && (data as any).sources[0]?.file.includes('.m3u8'))) {
      return (data as any).sources[0]?.file ? { m3u8: (data as any).sources[0].file, referer, tracks } : null;
    }

    const { data: keys } = await axios.get(
      'https://raw.githubusercontent.com/yogesh-hacker/MegacloudKeys/refs/heads/main/keys.json',
    );
    const secret = (keys as any)['mega'];

    const decryptUrl = `https://megacloud-api-nine.vercel.app/?encrypted_data=${encodeURIComponent((data as any).sources[0].file)}&nonce=${encodeURIComponent(nonce)}&secret=${encodeURIComponent(secret)}`;
    const { data: decrypted } = await axios.get(decryptUrl);

    const m3u8 = (typeof decrypted === 'string' ? decrypted : JSON.stringify(decrypted)).match(/"file":"(.*?)"/)?.[1];
    return m3u8 ? { m3u8, referer, tracks } : null;
  } catch (err) {
    console.error('Megacloud extraction failed:', err);
    return null;
  }
}

export async function extractStreamUrl(embedUrl: string): Promise<ExtractedStream | null> {
  let currentUrl = embedUrl;
  let html = '';

  for (let i = 0; i < 3; i++) {
    try {
      let host = new URL(currentUrl).host;
      let referer = 'https://' + host + '/';
      let response;

      try {
        response = await axios.get(currentUrl, {
          headers: { ...ANIKOTO_DEFAULT_HEADERS, Referer: referer },
          timeout: 8000,
        });
      } catch (err) {
        if (currentUrl.includes('vidwish.live') || currentUrl.includes('megacloud.bloggy.click')) {
          const fallbackUrl = currentUrl
            .replace('vidwish.live', 'megaplay.buzz')
            .replace('megacloud.bloggy.click', 'megaplay.buzz');
          host = new URL(fallbackUrl).host;
          referer = 'https://' + host + '/';
          response = await axios.get(fallbackUrl, {
            headers: { ...ANIKOTO_DEFAULT_HEADERS, Referer: referer },
            timeout: 8000,
          });
          currentUrl = fallbackUrl;
        } else {
          throw err;
        }
      }

      html = response.data as string;

      const isErrorPage =
        html.includes('Error -') ||
        html.includes('error-container') ||
        html.includes("doesn't exist");
      if (isErrorPage && (currentUrl.includes('vidwish.live') || currentUrl.includes('megacloud.bloggy.click'))) {
        const fallbackUrl = currentUrl
          .replace('vidwish.live', 'megaplay.buzz')
          .replace('megacloud.bloggy.click', 'megaplay.buzz');
        host = new URL(fallbackUrl).host;
        referer = 'https://' + host + '/';
        response = await axios.get(fallbackUrl, {
          headers: { ...ANIKOTO_DEFAULT_HEADERS, Referer: referer },
          timeout: 8000,
        });
        currentUrl = fallbackUrl;
        html = response.data as string;
      }

      const iframeMatch = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
      if (iframeMatch) {
        const iframeSrc = iframeMatch[1];
        const resolvedUrl = new URL(iframeSrc, currentUrl).toString();
        if (resolvedUrl !== currentUrl) {
          currentUrl = resolvedUrl;
          continue;
        }
      }
    } catch (err) {
      console.error(`[extractStreamUrl] Failed to fetch or parse HTML for ${currentUrl}:`, err);
      if (
        !currentUrl.includes('megaplay.buzz') &&
        (currentUrl.includes('vidwish.live') || currentUrl.includes('megacloud.bloggy.click'))
      ) {
        try {
          const fallbackUrl = currentUrl
            .replace('vidwish.live', 'megaplay.buzz')
            .replace('megacloud.bloggy.click', 'megaplay.buzz');
          currentUrl = fallbackUrl;
          i--;
          continue;
        } catch (e) {
          // ignore
        }
      }
    }
    break;
  }

  const host = new URL(currentUrl).hostname;

  if (host.includes('megaplay.buzz') || host.includes('vidwish.live')) {
    return extractMegaplay(currentUrl);
  } else if (host.includes('megacloud.blog')) {
    return extractMegacloud(currentUrl);
  }

  return null;
}
