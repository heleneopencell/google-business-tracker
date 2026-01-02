import { chromium, Browser, BrowserContext, Page } from 'playwright';
import path from 'path';
import fs from 'fs';
import { ExtractedData, OpenClosedStatus, ErrorCode } from '../types/snapshot';

const PROFILE_PATH = path.join(process.cwd(), 'data', 'playwright-profile');

export class PlaywrightService {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private loginInProgress: boolean = false;

  async getContext(): Promise<BrowserContext> {
    if (this.context) {
      return this.context;
    }

    if (!this.browser) {
      this.browser = await chromium.launch({
        headless: false, // Required for logged-in session
        channel: 'chromium',
        args: [
          '--disable-blink-features=AutomationControlled',
          '--disable-dev-shm-usage',
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-web-security',
          '--disable-features=IsolateOrigins,site-per-process'
        ]
      });
    }

    // Ensure profile directory exists
    if (!fs.existsSync(PROFILE_PATH)) {
      fs.mkdirSync(PROFILE_PATH, { recursive: true });
    }

    const storageStatePath = path.join(PROFILE_PATH, 'storage.json');
    let storageState: any = undefined;
    if (fs.existsSync(storageStatePath)) {
      try {
        storageState = JSON.parse(fs.readFileSync(storageStatePath, 'utf-8'));
      } catch (e) {
        // Invalid storage state, ignore
      }
    }

    this.context = await this.browser.newContext({
      viewport: { width: 1280, height: 800 },
      locale: 'en-US',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      storageState: storageState,
      // Remove automation indicators
      ignoreHTTPSErrors: true
    });
    
    // Remove webdriver property
    await this.context.addInitScript(() => {
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

    return this.context;
  }

  async saveStorageState(): Promise<void> {
    if (this.context) {
      const storageState = await this.context.storageState();
      fs.writeFileSync(
        path.join(PROFILE_PATH, 'storage.json'),
        JSON.stringify(storageState, null, 2)
      );
    }
  }

  async reloadContext(): Promise<void> {
    // Force reload context with latest storage state
    if (this.context) {
      await this.context.close().catch(() => {});
      this.context = null;
    }
    // Next getContext() call will create new context with latest storage
  }

  async checkLoggedIn(): Promise<boolean> {
    // Reload context to get latest storage state
    await this.reloadContext();
    const context = await this.getContext();
    const page = await context.newPage();
    
    try {
      await page.goto('https://www.google.com/maps', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(3000); // Wait for page to fully render
      
      // Multiple ways to check if logged in
      const checks = await Promise.all([
        // Check for account avatar/button
        page.locator('[data-value="Account"], button[aria-label*="Account"], [aria-label*="Google Account"]').first().isVisible().catch(() => false),
        // Check for profile picture
        page.locator('img[alt*="Account"], img[alt*="Profile"]').first().isVisible().catch(() => false),
        // Check for account menu
        page.locator('[role="button"][aria-label*="Account"]').first().isVisible().catch(() => false),
        // Check cookies for logged-in indicators
        page.evaluate(() => {
          // @ts-ignore - browser context
          return (typeof document !== 'undefined' && (document.cookie.includes('SID') || document.cookie.includes('HSID') || document.cookie.includes('SSID'))) || false;
        }).catch(() => false)
      ]);
      
      const isLoggedIn = checks.some((check: boolean | undefined) => check === true);
      
      // Check for sign in button (logged out indicator)
      const signInVisible = await page.locator('text=/sign in/i, button:has-text("Sign in")').first().isVisible().catch(() => false);
      
      await page.close();
      
      if (isLoggedIn) {
        // Save state when we detect login (in case it wasn't saved)
        await this.saveStorageState();
        return true;
      }
      
      if (signInVisible) {
        return false;
      }
      
      // If we can't determine, assume not logged in
      return false;
    } catch (e) {
      await page.close();
      return false;
    }
  }

  async openLoginPage(): Promise<void> {
    // Prevent multiple simultaneous login attempts
    if (this.loginInProgress) {
      console.log('Login already in progress. Please wait...');
      return;
    }
    
    this.loginInProgress = true;
    
    try {
      // First check if already logged in
      const alreadyLoggedIn = await this.checkLoggedIn();
      if (alreadyLoggedIn) {
        console.log('Already logged in!');
        this.loginInProgress = false;
        return;
      }
      
      const context = await this.getContext();
      const page = await context.newPage();
      
      try {
        // Navigate to Google Maps
        await page.goto('https://www.google.com/maps', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(3000); // Wait for page to fully render
        
        // Check if already logged in on this page
        const checks = await Promise.all([
          page.locator('[data-value="Account"], button[aria-label*="Account"]').first().isVisible().catch(() => false),
          page.locator('img[alt*="Account"], img[alt*="Profile"]').first().isVisible().catch(() => false),
              page.evaluate(() => {
                // @ts-ignore - browser context
                return (typeof document !== 'undefined' && (document.cookie.includes('SID') || document.cookie.includes('HSID'))) || false;
              }).catch(() => false)
        ]);
        
        if (checks.some((check: boolean | undefined) => check === true)) {
          await this.saveStorageState();
          this.loginInProgress = false;
          return;
        }
        
        // Try to find and click sign in button
        const signInButton = page.locator('text=/sign in/i, button:has-text("Sign in")').first();
        const signInVisible = await signInButton.isVisible().catch(() => false);
        
        if (signInVisible) {
          await signInButton.click();
          await page.waitForTimeout(2000);
        }
        
        // Keep the page open and wait for user to complete login
        // Check periodically if user has logged in
        let loggedIn = false;
        const maxWaitTime = 600000; // 10 minutes max
        const checkInterval = 5000; // Check every 5 seconds
        const startTime = Date.now();
        
        console.log('Browser window opened. Please log in to your Google account.');
        console.log('The app will automatically detect when you are logged in.');
        
        while (!loggedIn && (Date.now() - startTime) < maxWaitTime) {
          await page.waitForTimeout(checkInterval);
          
          // Check if we're logged in using multiple methods
          try {
            const loginChecks = await Promise.all([
              page.locator('[data-value="Account"], button[aria-label*="Account"]').first().isVisible().catch(() => false),
              page.locator('img[alt*="Account"], img[alt*="Profile"]').first().isVisible().catch(() => false),
              page.evaluate(() => {
                // @ts-ignore - browser context
                return (typeof document !== 'undefined' && (document.cookie.includes('SID') || document.cookie.includes('HSID') || document.cookie.includes('SSID'))) || false;
              }).catch(() => false)
            ]);
            
            if (loginChecks.some((check: boolean) => check === true)) {
              loggedIn = true;
              console.log('Login detected! Saving session...');
              break;
            }
          } catch (e) {
            // Continue waiting
          }
        }
        
        // Save storage state after login (or timeout)
        if (loggedIn) {
          await this.saveStorageState();
          console.log('Session saved successfully!');
        } else {
          console.log('Login timeout. Please try again.');
        }
        
        // Don't close the page - let user close it manually
        if (loggedIn) {
          console.log('You can now close the browser window and return to the app.');
        }
      } catch (e) {
        // If there's an error, still try to save state
        await this.saveStorageState().catch(() => {});
        throw e;
      } finally {
        this.loginInProgress = false;
      }
      // Note: We intentionally don't close the page here so user can continue using it
    } catch (e) {
      this.loginInProgress = false;
      throw e;
    }
  }

  async detectInterstitial(page: Page): Promise<ErrorCode | null> {
    // Check for cookie/consent screen
    const consentVisible = await page.locator('text=/cookie|consent|accept/i').isVisible().catch(() => false);
    if (consentVisible) {
      return 'CONSENT_REQUIRED';
    }

    // Check for captcha
    const captchaVisible = await page.locator('[data-callback], iframe[src*="recaptcha"]').isVisible().catch(() => false);
    if (captchaVisible) {
      return 'BOT_DETECTED';
    }

    // Check for "Before you continue to Google"
    const beforeContinue = await page.locator('text=/before you continue/i').isVisible().catch(() => false);
    if (beforeContinue) {
      return 'BOT_DETECTED';
    }

    return null;
  }

  async extractBusinessData(url: string): Promise<ExtractedData> {
    const context = await this.getContext();
    const page = await context.newPage();
    
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      
      // Check for interstitials first
      const interstitialError = await this.detectInterstitial(page);
      if (interstitialError) {
        return {
          link: url,
          name: null,
          address: null,
          webpage: null,
          phone: null,
          openClosedStatus: 'UNKNOWN',
          reviewCount: null,
          starRating: null,
          errorCode: interstitialError
        };
      }

      // Try accessibility snapshot first
      let a11ySnapshot: any = null;
      try {
        // Playwright accessibility API
        a11ySnapshot = await (page as any).accessibility?.snapshot();
      } catch (e) {
        // Accessibility not available, use DOM fallback
      }
      
      // Fallback to DOM
      const extracted: ExtractedData = {
        link: url,
        name: await this.extractName(page, a11ySnapshot),
        address: await this.extractAddress(page),
        webpage: await this.extractWebpage(page),
        phone: await this.extractPhone(page),
        openClosedStatus: await this.extractOpenClosedStatus(page),
        reviewCount: await this.extractReviewCount(page),
        starRating: await this.extractStarRating(page),
        errorCode: null
      };

      // Check for extraction failure
      if (extracted.link && !extracted.name && !extracted.address && !extracted.webpage && !extracted.phone) {
        extracted.errorCode = 'EXTRACTION_FAILED';
      }

      return extracted;
    } catch (e) {
      return {
        link: url,
        name: null,
        address: null,
        webpage: null,
        phone: null,
        openClosedStatus: 'UNKNOWN',
        reviewCount: null,
        starRating: null,
        errorCode: 'PAGE_LOAD_FAILED'
      };
    } finally {
      await page.close();
    }
  }

  private async extractName(page: Page, a11ySnapshot: any): Promise<string | null> {
    // Try accessibility heading first
    if (a11ySnapshot) {
      const heading = this.findA11yHeading(a11ySnapshot);
      if (heading && !heading.toLowerCase().includes('reviews') && !heading.toLowerCase().includes('stars')) {
        return heading;
      }
    }

    // Try h1
    const h1 = await page.locator('h1').first().textContent().catch(() => null);
    if (h1 && !h1.toLowerCase().includes('reviews') && !h1.toLowerCase().includes('stars')) {
      return h1.trim();
    }

    // Try document title
    const title = await page.title();
    if (title && !title.toLowerCase().includes('reviews') && !title.toLowerCase().includes('stars')) {
      return title.trim();
    }

    return null;
  }

  private findA11yHeading(node: any): string | null {
    if (node.role === 'heading' && node.name) {
      return node.name;
    }
    if (node.children) {
      for (const child of node.children) {
        const result = this.findA11yHeading(child);
        if (result) return result;
      }
    }
    return null;
  }

  private async extractAddress(page: Page): Promise<string | null> {
    // Try data-item-id="address"
    const addressElement = await page.locator('[data-item-id="address"]').first().textContent().catch(() => null);
    if (addressElement) {
      return addressElement.trim();
    }

    // Heuristic fallback - look for address-like text
    const addressPattern = /(\d+[\s\w]+(?:street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|way|circle|cir)[^,]*,\s*[^,]+)/i;
    const bodyText = await page.textContent('body').catch(() => '');
    const match = bodyText?.match(addressPattern);
    if (match) {
      return match[1].trim();
    }

    return null;
  }

  private async extractWebpage(page: Page): Promise<string | null> {
    // Try "Website" label
    const websiteLink = await page.locator('text=/^website$/i').locator('..').locator('a').first().getAttribute('href').catch(() => null);
    if (websiteLink) {
      try {
        const url = new URL(websiteLink);
        return url.hostname;
      } catch (e) {
        return websiteLink;
      }
    }

    // URL regex fallback
    const urlPattern = /https?:\/\/(?:www\.)?([a-zA-Z0-9-]+\.[a-zA-Z]{2,})/;
    const bodyText = await page.textContent('body').catch(() => '');
    const match = bodyText?.match(urlPattern);
    if (match) {
      return match[1];
    }

    return null;
  }

  private async extractPhone(page: Page): Promise<string | null> {
    // Try data-item-id="phone:*"
    const phoneElement = await page.locator('[data-item-id^="phone:"]').first().textContent().catch(() => null);
    if (phoneElement) {
      return phoneElement.replace(/\D/g, '');
    }

    // Regex fallback
    const phonePattern = /(\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/;
    const bodyText = await page.textContent('body').catch(() => '');
    const match = bodyText?.match(phonePattern);
    if (match && match[0]) {
      return match[0].replace(/\D/g, '');
    }

    return null;
  }

  private async extractOpenClosedStatus(page: Page): Promise<OpenClosedStatus> {
    const bodyText = (await page.textContent('body').catch(() => '') || '').toLowerCase();
    
    // Check for permanently closed
    if (bodyText.includes('permanently closed')) {
      return 'PERMANENTLY_CLOSED';
    }

    // Check for temporarily closed
    if (bodyText.includes('temporarily closed')) {
      return 'TEMPORARILY_CLOSED';
    }

    // Check for any activity signal (hours, open now, etc.)
    if (bodyText.includes('open') || bodyText.includes('hours') || bodyText.includes('closed')) {
      return 'OPEN';
    }

    return 'UNKNOWN';
  }

  private async extractReviewCount(page: Page): Promise<number | null> {
    const bodyText = await page.textContent('body').catch(() => '');
    if (!bodyText) return null;

    // Look for review count patterns
    const patterns = [
      /(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?)\s*reviews?/i,
      /(\d+(?:[.,]\d+)?)\s*reviews?/i,
      /reviews?[:\s]+(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?)/i
    ];

    for (const pattern of patterns) {
      const match = bodyText.match(pattern);
      if (match) {
        const numStr = match[1].replace(/[.,]/g, (m, offset, str) => {
          // If it's the last separator, it's decimal; otherwise thousands
          const after = str.substring(offset + 1);
          if (after.match(/^\d{1,2}[^0-9]/)) {
            return '.'; // Decimal separator
          }
          return ''; // Thousands separator
        });
        
        const num = parseFloat(numStr);
        if (!isNaN(num)) {
          return Math.round(num);
        }
      }
    }

    // Try K, M, B suffixes
    const suffixPattern = /(\d+(?:[.,]\d+)?)\s*([kmb])\s*reviews?/i;
    const suffixMatch = bodyText.match(suffixPattern);
    if (suffixMatch) {
      const num = parseFloat(suffixMatch[1]);
      const suffix = suffixMatch[2].toLowerCase();
      let multiplier = 1;
      if (suffix === 'k') multiplier = 1000;
      else if (suffix === 'm') multiplier = 1000000;
      else if (suffix === 'b') multiplier = 1000000000;
      
      return Math.round(num * multiplier);
    }

    return null;
  }

  private async extractStarRating(page: Page): Promise<number | null> {
    const bodyText = await page.textContent('body').catch(() => '');
    if (!bodyText) return null;

    // Look for star rating patterns
    const pattern = /(\d+(?:[.,]\d)?)\s*stars?/i;
    const match = bodyText.match(pattern);
    if (match) {
      const numStr = match[1].replace(',', '.');
      const num = parseFloat(numStr);
      if (!isNaN(num) && num >= 0 && num <= 5) {
        return Math.round(num * 10) / 10; // Round to 1 decimal
      }
    }

    return null;
  }

  async captureScreenshot(url: string, outputPath: string): Promise<boolean> {
    const context = await this.getContext();
    const page = await context.newPage();
    
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      
      // Find business overview panel
      const panelLocator = page.locator('[data-value="Overview"], [role="main"]').first();
      const panelExists = await panelLocator.count() > 0;
      
      if (!panelExists) {
        return false;
      }

      // Set width to 500px if needed
      const box = await panelLocator.boundingBox().catch(() => null);
      if (box) {
        await page.setViewportSize({ width: Math.max(500, box.width), height: box.height + 100 });
      }

      // Capture screenshot clipped to container
      await panelLocator.screenshot({ path: outputPath, type: 'png' });
      return true;
    } catch (e) {
      return false;
    } finally {
      await page.close();
    }
  }

  async close(): Promise<void> {
    if (this.context) {
      await this.context.close();
      this.context = null;
    }
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}

