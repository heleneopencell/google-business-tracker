import { chromium, Browser, BrowserContext, Page } from 'playwright';
import path from 'path';
import fs from 'fs';
import { ExtractedData, OpenClosedStatus, ErrorCode } from '../types/snapshot';

const PROFILE_PATH = path.join(process.cwd(), 'data', 'playwright-profile');

export class PlaywrightService {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;

  async getContext(): Promise<BrowserContext> {
    if (this.context) {
      return this.context;
    }

    if (!this.browser) {
      this.browser = await chromium.launch({
        headless: false, // Required for logged-in session
        channel: 'chromium'
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
      storageState: storageState
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

  async checkLoggedIn(): Promise<boolean> {
    const context = await this.getContext();
    const page = await context.newPage();
    
    try {
      await page.goto('https://www.google.com/maps', { waitUntil: 'networkidle', timeout: 30000 });
      
      // Check for account avatar (logged in)
      const avatarVisible = await page.locator('[data-value="Account"]').isVisible().catch(() => false);
      
      // Check for "Sign in" button (logged out)
      const signInVisible = await page.locator('text=Sign in').isVisible().catch(() => false);
      
      await page.close();
      
      if (avatarVisible) return true;
      if (signInVisible) return false;
      
      // Neither visible - page load may have failed
      return false;
    } catch (e) {
      await page.close();
      return false;
    }
  }

  async openLoginPage(): Promise<void> {
    const context = await this.getContext();
    const page = await context.newPage();
    
    try {
      await page.goto('https://accounts.google.com/signin', { waitUntil: 'networkidle' });
      // User will log in manually
      // Wait a bit for user to complete login
      await page.waitForTimeout(5000);
      await this.saveStorageState();
    } finally {
      await page.close();
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
      const a11ySnapshot = await page.accessibility.snapshot();
      
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
    if (match) {
      return match[0].replace(/\D/g, '');
    }

    return null;
  }

  private async extractOpenClosedStatus(page: Page): Promise<OpenClosedStatus> {
    const bodyText = (await page.textContent('body').catch(() => '')).toLowerCase();
    
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
      const panel = await page.locator('[data-value="Overview"], [role="main"]').first().waitFor({ timeout: 5000 }).catch(() => null);
      
      if (!panel) {
        return false;
      }

      // Set width to 500px if needed
      const box = await panel.boundingBox();
      if (box) {
        await page.setViewportSize({ width: Math.max(500, box.width), height: box.height + 100 });
      }

      // Capture screenshot clipped to container
      await panel.screenshot({ path: outputPath, type: 'png' });
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

