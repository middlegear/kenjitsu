import axios from 'axios';
import * as cheerio from 'cheerio';
import { ANIKOTO_BASE_URL, ANIKOTO_DEFAULT_HEADERS } from './constants.js';

/**
 * Fetch an HTML page from anikoto.net and return a Cheerio instance.
 */
export async function fetchPage(path: string): Promise<cheerio.CheerioAPI> {
  const url = path.startsWith('http') ? path : `${ANIKOTO_BASE_URL}${path}`;
  const { data } = await axios.get(url, {
    headers: ANIKOTO_DEFAULT_HEADERS,
    timeout: 15_000,
  });
  return cheerio.load(data);
}

/**
 * Fetch JSON from anikoto.net's internal AJAX endpoints.
 */
export async function fetchJson<T = unknown>(path: string): Promise<T> {
  const url = path.startsWith('http') ? path : `${ANIKOTO_BASE_URL}${path}`;
  const { data } = await axios.get<T>(url, {
    headers: {
      ...ANIKOTO_DEFAULT_HEADERS,
      Accept: 'application/json, text/javascript, */*',
      'X-Requested-With': 'XMLHttpRequest',
    },
    timeout: 15_000,
  });
  return data;
}
