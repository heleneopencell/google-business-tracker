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
    // Only reload context if storage file was recently updated (within last 5 seconds)
    const storageStatePath = path.join(PROFILE_PATH, 'storage.json');
    if (fs.existsSync(storageStatePath)) {
      const stats = fs.statSync(storageStatePath);
      const age = Date.now() - stats.mtimeMs;
      // If storage was updated recently, reload context
      if (age < 5000) {
        await this.reloadContext();
      }
    }
    
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
      console.error('Error checking login status:', e);
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
      // Navigate to the URL
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      
      // Wait for initial page load
      await page.waitForTimeout(3000);
      
      // Wait for business panel to appear - this is critical
      // Google Maps loads the business panel after the main map
      try {
        // Wait for the business name/header to appear - this indicates the business panel is loaded
        await page.waitForSelector('h1.DUwDvf, h1.lfPIob, [data-value="title"], h1[class*="DUwDvf"], [aria-label*="title"]', { 
          timeout: 15000,
          state: 'visible'
        });
        console.log('Business panel detected');
      } catch (e) {
        console.log('Business panel not found, trying alternative selectors...');
        // Try alternative selectors
        try {
          await page.waitForSelector('h1, [role="main"], [data-value="Overview"]', { timeout: 5000 });
        } catch (e2) {
          console.log('No business panel found');
        }
      }
      
      // Additional wait for dynamic content to load (address, phone, etc.)
      await page.waitForTimeout(3000);
      
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

      // Debug: Log page structure (can be removed in production)
      try {
        const pageTitle = await page.title();
        const url = page.url();
        console.log(`Extracting from page: ${pageTitle} (${url})`);
      } catch (e) {
        // Ignore
      }

      // Try accessibility snapshot first
      let a11ySnapshot: any = null;
      try {
        // Playwright accessibility API
        a11ySnapshot = await (page as any).accessibility?.snapshot();
      } catch (e) {
        // Accessibility not available, use DOM fallback
      }
      
      // Extract data
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
      
      // Log extraction results for debugging
      console.log('Extraction results:', {
        name: extracted.name,
        address: extracted.address ? 'Found' : 'Not found',
        webpage: extracted.webpage,
        phone: extracted.phone ? 'Found' : 'Not found',
        reviewCount: extracted.reviewCount,
        starRating: extracted.starRating
      });

      // Check for extraction failure
      if (extracted.link && !extracted.name && !extracted.address && !extracted.webpage && !extracted.phone) {
        extracted.errorCode = 'EXTRACTION_FAILED';
      }

      return extracted;
    } catch (e) {
      console.error('Extraction error:', e);
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
    // Try Google Maps specific selectors first (based on actual structure)
    // The business name is typically in h1 with class "DUwDvf lfPIob" or similar
    const selectors = [
      'h1.DUwDvf.lfPIob',  // Most common - exact class match
      'h1.DUwDvf',         // Just DUwDvf class
      'h1.lfPIob',         // Just lfPIob class
      'h1[class*="DUwDvf"]', // Contains DUwDvf
      '[data-value="title"]',
      '[data-attrid="title"]',
      'h1[data-attrid="title"]',
      '[aria-label*="title"]:not([aria-label*="reviews"])',
      'h1:not([aria-label*="reviews"])'
    ];

    for (const selector of selectors) {
      try {
        const element = await page.locator(selector).first();
        const text = await element.textContent().catch(() => null);
        if (text) {
          const cleaned = text.trim();
          // Filter out common non-name text
          if (cleaned && 
              !cleaned.toLowerCase().includes('reviews') && 
              !cleaned.toLowerCase().includes('stars') &&
              !cleaned.toLowerCase().includes('directions') &&
              !cleaned.toLowerCase().includes('google maps') &&
              cleaned.length > 2 && 
              cleaned.length < 200) {
            console.log(`Extracted name using selector "${selector}": ${cleaned}`);
            return cleaned;
          }
        }
      } catch (e) {
        // Continue to next selector
      }
    }

    // Try accessibility heading
    if (a11ySnapshot) {
      const heading = this.findA11yHeading(a11ySnapshot);
      if (heading && 
          !heading.toLowerCase().includes('reviews') && 
          !heading.toLowerCase().includes('stars') &&
          heading.length > 2 && 
          heading.length < 200) {
        return heading;
      }
    }

    // Try h1
    const h1 = await page.locator('h1').first().textContent().catch(() => null);
    if (h1) {
      const cleaned = h1.trim();
      if (cleaned && 
          !cleaned.toLowerCase().includes('reviews') && 
          !cleaned.toLowerCase().includes('stars') &&
          cleaned.length > 2 && 
          cleaned.length < 200) {
        return cleaned;
      }
    }

    // Try document title (last resort)
    const title = await page.title();
    if (title) {
      // Remove common suffixes
      const cleaned = title
        .replace(/\s*-\s*Google\s+Maps.*$/i, '')
        .replace(/\s*-\s*.*reviews.*$/i, '')
        .trim();
      if (cleaned && 
          cleaned.length > 2 && 
          cleaned.length < 200 &&
          !cleaned.toLowerCase().includes('google maps')) {
        return cleaned;
      }
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
    // Try multiple Google Maps address selectors
    // Address is typically in a button with data-item-id="address" and aria-label="Address: ..."
    const selectors = [
      'button[data-item-id="address"]',  // Most common - button with address
      '[data-item-id="address"]',        // Any element with address
      'button[data-item-id*="address"]', // Partial match
      '[data-item-id*="address"]',       // Partial match
      'button[aria-label*="Address"]',   // Button with aria-label containing "Address"
      '[aria-label*="Address"]'          // Any element with aria-label containing "Address"
    ];

    for (const selector of selectors) {
      try {
        const element = await page.locator(selector).first();
        
        // First priority: Extract from aria-label (most reliable)
        // Format: "Address: 105 Rue La Fayette, 75010 Paris, France"
        const ariaLabel = await element.getAttribute('aria-label').catch(() => null);
        if (ariaLabel) {
          // Remove "Address: " prefix if present
          let cleaned = ariaLabel.trim();
          if (cleaned.startsWith('Address:')) {
            cleaned = cleaned.substring(8).trim(); // Remove "Address: " prefix
          } else if (cleaned.startsWith('Address')) {
            cleaned = cleaned.substring(7).trim(); // Remove "Address" prefix
          }
          // Address should be substantial (at least street number and name)
          if (cleaned && cleaned.length > 5) {
            console.log(`Extracted address from aria-label using selector "${selector}": ${cleaned}`);
            return cleaned;
          }
        }
        
        // Second priority: Try text content
        const text = await element.textContent().catch(() => null);
        if (text) {
          const cleaned = text.trim();
          // Address should be substantial (at least street number and name)
          if (cleaned && cleaned.length > 5) {
            console.log(`Extracted address using selector "${selector}": ${cleaned}`);
            return cleaned;
          }
        }
        
        // Third priority: Try innerHTML to get full address structure
        const innerHTML = await element.innerHTML().catch(() => null);
        if (innerHTML) {
          // Extract text from HTML
          const textMatch = innerHTML.match(/>([^<]+)</);
          if (textMatch && textMatch[1]) {
            const cleaned = textMatch[1].trim();
            if (cleaned && cleaned.length > 5) {
              console.log(`Extracted address from innerHTML: ${cleaned}`);
              return cleaned;
            }
          }
        }
      } catch (e) {
        // Continue to next selector
      }
    }

    // Heuristic fallback - look for address-like text in business panel
    try {
      const businessPanel = page.locator('[data-value="Overview"], [role="main"]').first();
      const panelText = await businessPanel.textContent().catch(() => '');
      
      // More flexible address pattern
      const addressPatterns = [
        /(\d+[\s\w]+(?:street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|way|circle|cir|place|pl)[^,]*,\s*[^,]+)/i,
        /([A-Za-z0-9\s]+,\s*[A-Za-z\s]+,\s*[A-Za-z\s]+(?:\d{5})?)/, // City, State format
        /(\d+\s+[A-Za-z\s]+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln)[^,]*,\s*[^,]+)/i
      ];

      if (panelText) {
        for (const pattern of addressPatterns) {
          const match = panelText.match(pattern);
          if (match && match[1]) {
            return match[1].trim();
          }
        }
      }
    } catch (e) {
      // Fallback to body text
    }

    // Last resort - body text
    const bodyText = await page.textContent('body').catch(() => '');
    const addressPattern = /(\d+[\s\w]+(?:street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|way|circle|cir)[^,]*,\s*[^,]+)/i;
    const match = bodyText?.match(addressPattern);
    if (match) {
      return match[1].trim();
    }

    return null;
  }

  private async extractWebpage(page: Page): Promise<string | null> {
    // Try multiple Google Maps website selectors
    // Website is typically in an <a> tag with data-item-id="authority" and aria-label="Website: ..."
    const selectors = [
      'a[data-item-id="authority"]',     // Most common - link with authority data-item-id
      '[data-item-id="authority"]',      // Any element with authority
      'a[data-item-id="website"]',       // Alternative selector
      'button[data-item-id="website"]',  // Button variant
      '[data-item-id="website"] a',      // Nested link
      'a[aria-label*="Website"]',        // Link with aria-label containing "Website"
      'button[aria-label*="website"]',   // Button with aria-label
      '[aria-label*="website"] a'        // Nested link with aria-label
    ];

    for (const selector of selectors) {
      try {
        const element = await page.locator(selector).first();
        
        // First priority: Extract from href attribute (most reliable)
        const href = await element.getAttribute('href').catch(() => null);
        if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
          try {
            const url = new URL(href);
            const hostname = url.hostname.replace('www.', '');
            console.log(`Extracted webpage from href using selector "${selector}": ${hostname}`);
            return hostname;
          } catch (e) {
            // If URL parsing fails, try to extract domain from href
            const domainMatch = href.match(/https?:\/\/(?:www\.)?([^\/]+)/);
            if (domainMatch && domainMatch[1]) {
              const hostname = domainMatch[1].replace('www.', '');
              console.log(`Extracted webpage from href (parsed): ${hostname}`);
              return hostname;
            }
          }
        }
        
        // Second priority: Extract from aria-label
        // Format: "Website: monconcepthabitation.com"
        const ariaLabel = await element.getAttribute('aria-label').catch(() => null);
        if (ariaLabel && ariaLabel.toLowerCase().includes('website')) {
          // Remove "Website: " prefix if present
          let cleaned = ariaLabel.trim();
          if (cleaned.toLowerCase().startsWith('website:')) {
            cleaned = cleaned.substring(8).trim(); // Remove "Website: " prefix
          } else if (cleaned.toLowerCase().startsWith('website')) {
            cleaned = cleaned.substring(7).trim(); // Remove "Website" prefix
          }
          // Remove any trailing slashes or paths
          cleaned = cleaned.split('/')[0].split('?')[0];
          if (cleaned && cleaned.length > 3) {
            console.log(`Extracted webpage from aria-label using selector "${selector}": ${cleaned}`);
            return cleaned.replace('www.', '');
          }
        }
        
        // Third priority: Try text content that might be a URL
        const text = await element.textContent().catch(() => null);
        if (text && (text.startsWith('http://') || text.startsWith('https://'))) {
          try {
            const url = new URL(text);
            const hostname = url.hostname.replace('www.', '');
            console.log(`Extracted webpage from text content: ${hostname}`);
            return hostname;
          } catch (e) {
            // Try to extract domain from text
            const domainMatch = text.match(/https?:\/\/(?:www\.)?([^\/\s]+)/);
            if (domainMatch && domainMatch[1]) {
              const hostname = domainMatch[1].replace('www.', '');
              console.log(`Extracted webpage from text (parsed): ${hostname}`);
              return hostname;
            }
          }
        }
      } catch (e) {
        // Continue to next selector
      }
    }

    // Try finding link near "Website" text
    try {
      const websiteButton = await page.locator('button:has-text("Website"), [aria-label*="Website"]').first();
      const parent = websiteButton.locator('..');
      const link = await parent.locator('a[href^="http"]').first().getAttribute('href').catch(() => null);
      if (link) {
        try {
          const url = new URL(link);
          const hostname = url.hostname.replace('www.', '');
          console.log(`Extracted webpage from nearby link: ${hostname}`);
          return hostname;
        } catch (e) {
          return link;
        }
      }
    } catch (e) {
      // Continue
    }

    // URL regex fallback in business panel
    try {
      const businessPanel = page.locator('[data-value="Overview"], [role="main"]').first();
      const panelText = await businessPanel.textContent().catch(() => null);
      if (panelText) {
        const urlPattern = /https?:\/\/(?:www\.)?([a-zA-Z0-9-]+\.[a-zA-Z]{2,})/;
        const match = panelText.match(urlPattern);
        if (match) {
          return match[1];
        }
      }
    } catch (e) {
      // Fallback to body
    }

    return null;
  }

  private async extractPhone(page: Page): Promise<string | null> {
    // Try multiple Google Maps phone selectors
    // Phone is typically in a button with data-item-id="phone:tel:..." and aria-label="Phone: ..."
    const selectors = [
      'button[data-item-id^="phone"]',  // Most common - button with phone data-item-id
      '[data-item-id^="phone"]',        // Any element with phone data-item-id
      'button[data-item-id*="phone"]',  // Partial match
      '[data-item-id*="phone"]',        // Partial match
      'button[aria-label*="Phone"]',    // Button with aria-label containing "Phone"
      '[aria-label*="phone"]',          // Any element with aria-label containing "phone"
      'a[href^="tel:"]',                // Link with tel: href
      'button[aria-label*="phone"]'     // Button with phone in aria-label
    ];

    for (const selector of selectors) {
      try {
        const element = await page.locator(selector).first();
        
        // First priority: Extract from data-item-id
        // Format: "phone:tel:+33781315377"
        const dataItemId = await element.getAttribute('data-item-id').catch(() => null);
        if (dataItemId && dataItemId.includes('phone')) {
          // Extract phone number from data-item-id
          // Format: "phone:tel:+33781315377" or "phone:tel:1234567890"
          const telMatch = dataItemId.match(/tel:([+\d]+)/);
          if (telMatch && telMatch[1]) {
            // Return digits only (remove + and other non-digits)
            const digits = telMatch[1].replace(/\D/g, '');
            if (digits.length >= 10) {
              console.log(`Extracted phone from data-item-id using selector "${selector}": ${digits}`);
              return digits;
            }
          }
        }
        
        // Second priority: Extract from aria-label
        // Format: "Phone: +33 7 81 31 53 77"
        const ariaLabel = await element.getAttribute('aria-label').catch(() => null);
        if (ariaLabel && ariaLabel.toLowerCase().includes('phone')) {
          // Remove "Phone: " prefix if present
          let cleaned = ariaLabel.trim();
          if (cleaned.toLowerCase().startsWith('phone:')) {
            cleaned = cleaned.substring(6).trim(); // Remove "Phone: " prefix
          } else if (cleaned.toLowerCase().startsWith('phone')) {
            cleaned = cleaned.substring(5).trim(); // Remove "Phone" prefix
          }
          // Extract all digits (including + for international numbers)
          const digits = cleaned.replace(/\D/g, '');
          if (digits.length >= 10) {
            console.log(`Extracted phone from aria-label using selector "${selector}": ${digits}`);
            return digits;
          }
        }
        
        // Third priority: Try href="tel:..." 
        const telHref = await element.getAttribute('href').catch(() => null);
        if (telHref && telHref.startsWith('tel:')) {
          const digits = telHref.replace('tel:', '').replace(/\D/g, '');
          if (digits.length >= 10) {
            console.log(`Extracted phone from href: ${digits}`);
            return digits;
          }
        }
        
        // Fourth priority: Try text content
        const text = await element.textContent().catch(() => null);
        if (text) {
          const digits = text.replace(/\D/g, '');
          if (digits.length >= 10) {
            console.log(`Extracted phone from text content: ${digits}`);
            return digits;
          }
        }
      } catch (e) {
        // Continue to next selector
      }
    }

    // Regex fallback in business panel
    try {
      const businessPanel = page.locator('[data-value="Overview"], [role="main"]').first();
      const panelText = await businessPanel.textContent().catch(() => null);
      if (panelText) {
        const phonePattern = /(\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/;
        const match = panelText.match(phonePattern);
        if (match && match[0]) {
          return match[0].replace(/\D/g, '');
        }
      }
    } catch (e) {
      // Fallback to body
    }

    return null;
  }

  private async extractOpenClosedStatus(page: Page): Promise<OpenClosedStatus> {
    // First, check for the "Show open hours for the week" indicator (business is active/open)
    try {
      const openHoursButton = await page.locator('[aria-label*="Show open hours"], [aria-label*="show open hours"]').first();
      const ariaLabel = await openHoursButton.getAttribute('aria-label').catch(() => null);
      if (ariaLabel && ariaLabel.toLowerCase().includes('show open hours')) {
        console.log('Found "Show open hours" indicator - business is OPEN');
        return 'OPEN';
      }
    } catch (e) {
      // Continue to other checks
    }
    
    // Check body text for closed status
    const bodyText = (await page.textContent('body').catch(() => '') || '').toLowerCase();
    
    // Check for permanently closed
    if (bodyText.includes('permanently closed')) {
      console.log('Found "permanently closed" - business is PERMANENTLY_CLOSED');
      return 'PERMANENTLY_CLOSED';
    }

    // Check for temporarily closed
    if (bodyText.includes('temporarily closed')) {
      console.log('Found "temporarily closed" - business is TEMPORARILY_CLOSED');
      return 'TEMPORARILY_CLOSED';
    }
    
    // Check for open hours text patterns that indicate business is open
    if (bodyText.includes('open') && (bodyText.includes('hours') || bodyText.includes('closes') || bodyText.includes('opens'))) {
      console.log('Found open hours information - business is likely OPEN');
      return 'OPEN';
    }

    // Check for any activity signal (hours, open now, etc.)
    if (bodyText.includes('open') || bodyText.includes('hours') || bodyText.includes('closed')) {
      return 'OPEN';
    }

    return 'UNKNOWN';
  }

  private async extractReviewCount(page: Page): Promise<number | null> {
    // Try multiple selectors for review count
    // Review count is typically in a span with role="img" and aria-label="208 reviews"
    const selectors = [
      'span[role="img"][aria-label*="review"]',  // Most common - span with role="img" and aria-label
      '[role="img"][aria-label*="review"]',       // Any element with role="img" and aria-label
      'span[aria-label*="review"]',              // Span with aria-label
      'button[aria-label*="review"]',           // Button with aria-label
      '[data-value*="review"]',                 // Element with data-value
      'button[aria-label*="reviews"]'           // Button with "reviews" in aria-label
    ];

    for (const selector of selectors) {
      try {
        const element = await page.locator(selector).first();
        
        // First priority: Extract from aria-label
        // Format: "208 reviews" or "1,234 reviews"
        const ariaLabel = await element.getAttribute('aria-label').catch(() => null);
        if (ariaLabel && ariaLabel.toLowerCase().includes('review')) {
          // Extract number from aria-label like "208 reviews" or "1,234 reviews"
          const reviewMatch = ariaLabel.match(/(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?)\s*reviews?/i);
          if (reviewMatch && reviewMatch[1]) {
            const numStr = reviewMatch[1].replace(/[.,]/g, '');
            const num = parseInt(numStr, 10);
            if (!isNaN(num) && num > 0) {
              console.log(`Extracted review count from aria-label using selector "${selector}": ${num}`);
              return num;
            }
          }
          // Try with K/M/B suffix (e.g., "1.2k reviews")
          const suffixMatch = ariaLabel.match(/(\d+(?:[.,]\d+)?)\s*([kmb])\s*reviews?/i);
          if (suffixMatch && suffixMatch[1] && suffixMatch[2]) {
            const num = parseFloat(suffixMatch[1]);
            const suffix = suffixMatch[2].toLowerCase();
            let multiplier = 1;
            if (suffix === 'k') multiplier = 1000;
            else if (suffix === 'm') multiplier = 1000000;
            else if (suffix === 'b') multiplier = 1000000000;
            const result = Math.round(num * multiplier);
            console.log(`Extracted review count from aria-label with suffix: ${result}`);
            return result;
          }
        }
        
        // Second priority: Extract from text content
        // Format: "(208)" or "208"
        const text = await element.textContent().catch(() => null);
        if (text) {
          // Try to extract number from text like "(208)" or "208"
          const textMatch = text.match(/(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?)/);
          if (textMatch && textMatch[1]) {
            const numStr = textMatch[1].replace(/[.,]/g, '');
            const num = parseInt(numStr, 10);
            if (!isNaN(num) && num > 0) {
              console.log(`Extracted review count from text content: ${num}`);
              return num;
            }
          }
        }
      } catch (e) {
        // Continue to next selector
      }
    }

    // Try business panel text
    try {
      const businessPanel = page.locator('[data-value="Overview"], [role="main"]').first();
      const panelText = await businessPanel.textContent().catch(() => '');
      
      // Look for review count patterns
      const patterns = [
        /(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?)\s*reviews?/i,
        /(\d+(?:[.,]\d+)?)\s*reviews?/i,
        /reviews?[:\s]+(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?)/i
      ];

      if (panelText) {
        for (const pattern of patterns) {
          const match = panelText.match(pattern);
          if (match) {
            const numStr = match[1].replace(/[.,]/g, '');
            const num = parseInt(numStr, 10);
            if (!isNaN(num)) {
              return num;
            }
          }
        }

        // Try K, M, B suffixes
        const suffixPattern = /(\d+(?:[.,]\d+)?)\s*([kmb])\s*reviews?/i;
        const suffixMatch = panelText.match(suffixPattern);
        if (suffixMatch) {
          const num = parseFloat(suffixMatch[1]);
          const suffix = suffixMatch[2].toLowerCase();
          let multiplier = 1;
          if (suffix === 'k') multiplier = 1000;
          else if (suffix === 'm') multiplier = 1000000;
          else if (suffix === 'b') multiplier = 1000000000;
          return Math.round(num * multiplier);
        }
      }
    } catch (e) {
      // Fallback to body
    }

    // Last resort - body text
    const bodyText = await page.textContent('body').catch(() => '');
    if (!bodyText) return null;

    const patterns = [
      /(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?)\s*reviews?/i,
      /(\d+(?:[.,]\d+)?)\s*reviews?/i
    ];

    for (const pattern of patterns) {
      const match = bodyText.match(pattern);
      if (match) {
        const numStr = match[1].replace(/[.,]/g, '');
        const num = parseInt(numStr, 10);
        if (!isNaN(num)) {
          return num;
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
    // Try multiple selectors for star rating
    // Star rating is typically in a span with role="img" and aria-label="4.5 stars "
    const selectors = [
      'span[role="img"][aria-label*="star"]',  // Most common - span with role="img" and aria-label
      '[role="img"][aria-label*="star"]',       // Any element with role="img" and aria-label
      'span[aria-label*="star"]',              // Span with aria-label
      'button[aria-label*="star"]',            // Button with aria-label
      '[aria-label*="rating"]',                // Element with rating in aria-label
      '[data-value*="rating"]',                // Element with data-value
      'button[aria-label*="stars"]'            // Button with "stars" in aria-label
    ];

    for (const selector of selectors) {
      try {
        const element = await page.locator(selector).first();
        
        // First priority: Extract from aria-label
        // Format: "4.5 stars " or "4.5 stars" or "Rating: 4.5"
        const ariaLabel = await element.getAttribute('aria-label').catch(() => null);
        if (ariaLabel && (ariaLabel.toLowerCase().includes('star') || ariaLabel.toLowerCase().includes('rating'))) {
          // Parse from aria-label like "4.5 stars " or "4.5 stars" or "Rating: 4.5"
          const ratingMatch = ariaLabel.match(/(\d+(?:[.,]\d)?)\s*(?:star|rating)/i);
          if (ratingMatch && ratingMatch[1]) {
            const numStr = ratingMatch[1].replace(',', '.');
            const num = parseFloat(numStr);
            if (!isNaN(num) && num >= 0 && num <= 5) {
              const rounded = Math.round(num * 10) / 10;
              console.log(`Extracted star rating from aria-label using selector "${selector}": ${rounded}`);
              return rounded;
            }
          }
        }
      } catch (e) {
        // Continue to next selector
      }
    }

    // Try business panel text
    try {
      const businessPanel = page.locator('[data-value="Overview"], [role="main"]').first();
      const panelText = await businessPanel.textContent().catch(() => null);
      if (panelText) {
        const pattern = /(\d+(?:[.,]\d)?)\s*stars?/i;
        const match = panelText.match(pattern);
        if (match) {
          const numStr = match[1].replace(',', '.');
          const num = parseFloat(numStr);
          if (!isNaN(num) && num >= 0 && num <= 5) {
            return Math.round(num * 10) / 10;
          }
        }
      }
    } catch (e) {
      // Fallback
    }

    // Last resort - body text
    const bodyText = await page.textContent('body').catch(() => '');
    if (bodyText) {
      const pattern = /(\d+(?:[.,]\d)?)\s*stars?/i;
      const match = bodyText.match(pattern);
      if (match) {
        const numStr = match[1].replace(',', '.');
        const num = parseFloat(numStr);
        if (!isNaN(num) && num >= 0 && num <= 5) {
          return Math.round(num * 10) / 10;
        }
      }
    }

    return null;
  }

  async captureScreenshot(url: string, outputPath: string): Promise<boolean> {
    console.log(`[Screenshot] captureScreenshot called with url: ${url}, outputPath: ${outputPath}`);
    const context = await this.getContext();
    const page = await context.newPage();
    
    try {
      console.log(`[Screenshot] Navigating to URL: ${url}...`);
      // Use 'domcontentloaded' - same as extractBusinessData, more reliable for Google Maps
      // Google Maps has continuous network activity, so 'networkidle' or 'load' may timeout
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      console.log(`[Screenshot] Page DOM loaded`);
      
      // Wait for page to fully load and business panel to appear
      console.log(`[Screenshot] Waiting for page to stabilize...`);
      await page.waitForTimeout(5000); // Increased wait time
      
      // Wait for business panel to appear - this is critical
      console.log(`[Screenshot] Waiting for business panel to appear...`);
      try {
        await page.waitForSelector('h1.DUwDvf, h1.lfPIob, [data-value="Overview"], [role="main"]', { 
          timeout: 20000, // Increased timeout
          state: 'visible'
        });
        console.log('[Screenshot] Business panel detected');
      } catch (e: any) {
        console.log(`[Screenshot] Business panel not found with waitForSelector: ${e.message}, continuing...`);
      }
      
      // Additional wait for dynamic content to fully render
      await page.waitForTimeout(3000);
      
      // Set viewport to a reasonable size for Google Maps
      // This ensures consistent screenshot dimensions
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.waitForTimeout(500);
      
      // Capture full page screenshot
      // This will include the left panel (408px wide) plus the map on the right
      console.log(`[Screenshot] Taking full browser window screenshot...`);
      await page.screenshot({ 
        path: outputPath, 
        type: 'png',
        fullPage: false // Capture viewport only (1280x800)
      });
      
      // Verify file was created
      if (fs.existsSync(outputPath)) {
        const stats = fs.statSync(outputPath);
        console.log(`[Screenshot] Screenshot saved successfully to ${outputPath} (${stats.size} bytes)`);
        console.log(`[Screenshot] Screenshot dimensions: 1280x800 (full browser window)`);
        return true;
      } else {
        console.error(`[Screenshot] ERROR: Screenshot file was not created at ${outputPath}`);
        return false;
      }
    } catch (e: any) {
      console.error('[Screenshot] Error capturing screenshot:', e.message);
      console.error('[Screenshot] Error stack:', e.stack);
      return false;
    } finally {
      await page.close();
      console.log(`[Screenshot] Page closed`);
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

