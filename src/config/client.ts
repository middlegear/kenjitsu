import type { BrowserName, ClientConfig, DeviceType, Locale, OperatingSystem } from '../utils/types.js';
import 'dotenv/config';

export const clientOptions: ClientConfig = {
  proxyUrl: process.env.PROXY_URL || undefined,
  token: process.env.SESSION_TOKEN,

  http2: process.env.HTTP2 === 'true',
  timeout: process.env.TIMEOUT ? parseInt(process.env.TIMEOUT, 10) : 15000,
  retries: process.env.RETRIES ? parseInt(process.env.RETRIES, 10) : 2,
  delayBetweenRequests: process.env.DELAY ? parseInt(process.env.DELAY, 10) : 400,

  headerGeneratorOptions: process.env.BROWSER
    ? {
        browsers: [
          {
            name: process.env.BROWSER as BrowserName,
            minVersion: process.env.BROWSER_MIN_VER ? parseInt(process.env.BROWSER_MIN_VER, 10) : undefined,
            maxVersion: process.env.BROWSER_MAX_VER ? parseInt(process.env.BROWSER_MAX_VER, 10) : undefined,
          },
        ],

        devices: process.env.DEVICE_TYPE ? [process.env.DEVICE_TYPE as DeviceType] : undefined,
        operatingSystems: process.env.OS_TYPE ? [process.env.OS_TYPE as OperatingSystem] : undefined,
        locales: process.env.LOCALE ? [process.env.LOCALE as Locale] : undefined,
      }
    : undefined,
};
