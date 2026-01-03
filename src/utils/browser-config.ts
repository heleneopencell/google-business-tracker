import { BrowserContext } from 'playwright';

export const BROWSER_ARGS: string[] = [
  '--disable-blink-features=AutomationControlled',
  '--disable-dev-shm-usage',
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-web-security',
  '--disable-features=IsolateOrigins,site-per-process'
];

export const BROWSER_CONFIG = {
  viewport: { width: 1280, height: 800 },
  locale: 'en-US',
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  ignoreHTTPSErrors: true
} as const;

export async function addAntiDetectionScripts(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    // @ts-ignore - browser context
    if (typeof navigator !== 'undefined') {
      // @ts-ignore - browser context
      Object.defineProperty(navigator, 'webdriver', {
        get: () => false,
      });
      
      // @ts-ignore - browser context
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5],
      });
      
      // @ts-ignore - browser context
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en'],
      });
    }
  });
}

