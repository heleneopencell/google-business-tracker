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
      // Hide webdriver property completely
      // @ts-ignore - browser context
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
        configurable: true
      });
      
      // @ts-ignore - browser context
      delete (navigator as any).webdriver;
      
      // Add plugins to appear more human
      // @ts-ignore - browser context
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5],
        configurable: true
      });
      
      // Set languages
      // @ts-ignore - browser context
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en'],
        configurable: true
      });
      
      // Add chrome runtime to appear like real Chrome
      // @ts-ignore - browser context
      if (typeof window !== 'undefined') {
        // @ts-ignore - browser context
        (window as any).chrome = {
          runtime: {}
        };
      }
      
      // Override permissions API to appear more human
      // @ts-ignore - browser context
      if (window.navigator && window.navigator.permissions && window.navigator.permissions.query) {
        // @ts-ignore - browser context
        const originalQuery = window.navigator.permissions.query;
        // @ts-ignore - browser context
        window.navigator.permissions.query = (parameters: any) => (
          parameters.name === 'notifications' ?
            // @ts-ignore - browser context
            Promise.resolve({ state: (window as any).Notification?.permission || 'default' } as any) :
            originalQuery(parameters)
        );
      }
    }
  });
}

