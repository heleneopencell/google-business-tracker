import { chromium, Browser, BrowserContext, Page } from 'playwright';
import fs from 'fs';
import { ExtractedData, OpenClosedStatus, ErrorCode } from '../types/snapshot';
import { BROWSER_ARGS, BROWSER_CONFIG, addAntiDetectionScripts } from '../utils/browser-config';
import { loadStorageState, saveStorageState, ensureProfileDirectory } from '../utils/storage-state';
import { CONFIG } from '../config/constants';
import { logger } from '../utils/logger';
import { safeLocatorCheck, safePageOperation } from '../utils/promise-helpers';

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
        channel: 'chromium',
        args: BROWSER_ARGS
      });
    }

    ensureProfileDirectory();
    const storageState = loadStorageState();

    this.context = await this.browser.newContext({
      ...BROWSER_CONFIG,
      storageState: storageState
    });
    
    await addAntiDetectionScripts(this.context);

    return this.context;
  }

  async saveStorageState(): Promise<void> {
    if (this.context) {
      await saveStorageState(this.context);
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

  async extractBusinessData(url: string): Promise<{ extracted: ExtractedData; page: Page | null }> {
    const extractionStartTime = Date.now();
    const context = await this.getContext();
    const page = await context.newPage();
    
    try {
      // Navigate to the URL
      const navStartTime = Date.now();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      const navElapsed = Date.now() - navStartTime;
      if (navElapsed > 5000) {
        logger.performanceWarning('page.goto', navElapsed, CONFIG.PERFORMANCE.PAGE_GOTO_SLOW);
      }
      
      // Wait for business panel to appear - this is critical
      // Google Maps loads the business panel after the main map
      // Use a single wait with reduced timeout
      const waitStartTime = Date.now();
      try {
        await page.waitForSelector('h1.DUwDvf, h1.lfPIob, [data-value="title"], h1[class*="DUwDvf"], [aria-label*="title"], h1, [role="main"]', { 
          timeout: 10000,
          state: 'visible'
        });
        const waitElapsed = Date.now() - waitStartTime;
        logger.debug(`Business panel detected (waited ${waitElapsed}ms)`);
        logger.performance('waitForSelector', waitElapsed, CONFIG.PERFORMANCE.WAIT_SELECTOR_SLOW);
      } catch (e) {
        const waitElapsed = Date.now() - waitStartTime;
        logger.debug(`Business panel not found after ${waitElapsed}ms, continuing anyway...`);
      }
      
      // Reduced wait - just enough for dynamic content
      await page.waitForTimeout(1500);
      
      // Check for interstitials first
      const interstitialError = await this.detectInterstitial(page);
      if (interstitialError) {
        return {
          extracted: {
            link: url,
            name: null,
            address: null,
            webpage: null,
            phone: null,
            openClosedStatus: 'UNKNOWN',
            reviewCount: null,
            starRating: null,
            errorCode: interstitialError
          },
          page: null
        };
      }

      // Debug: Log page structure (can be removed in production)
      try {
        const pageTitle = await page.title();
        const url = page.url();
        logger.debug(`Extracting from page: ${pageTitle} (${url})`);
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
      
      // Extract name first
      const name = await this.extractName(page, a11ySnapshot);
      
      // Find the main business container using aria-label="[company name]"
      // This is much more efficient - all business data is inside this container
      const containerStartTime = Date.now();
      let businessContainer: any = null;
      if (name) {
        try {
          // Try to find element with aria-label matching the business name
          // This is typically the main business panel container
          const containerSelector = `[aria-label="${name}"], [aria-label*="${name}"]`;
          const container = page.locator(containerSelector).first();
          const isVisible = await Promise.race([
            container.isVisible(),
            new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 500))
          ]).catch(() => false);
          
          if (isVisible) {
            businessContainer = container;
            const containerElapsed = Date.now() - containerStartTime;
            logger.debug(`[Optimization] Found business container with aria-label="${name}" (took ${containerElapsed}ms)`);
          } else {
            // Fallback: Try role="main" with aria-label containing name
            const mainContainer = page.locator('[role="main"][aria-label*]').first();
            const mainAriaLabel = await mainContainer.getAttribute('aria-label').catch(() => null);
            if (mainAriaLabel && mainAriaLabel.includes(name)) {
              businessContainer = mainContainer;
              const containerElapsed = Date.now() - containerStartTime;
              logger.debug(`[Optimization] Found business container via role="main" with matching aria-label (took ${containerElapsed}ms)`);
            } else {
              const containerElapsed = Date.now() - containerStartTime;
              logger.debug(`[Optimization] Could not find business container (took ${containerElapsed}ms), will search whole page`);
            }
          }
        } catch (e) {
          const containerElapsed = Date.now() - containerStartTime;
          logger.debug(`[Optimization] Error finding business container (took ${containerElapsed}ms), will search whole page`);
        }
      }
      
      // Cache business name element for star rating extraction (optimization)
      let cachedNameElement: any = null;
      if (name && businessContainer) {
        try {
          // Find name element within the container
          const nameSelectors = [
            'h1.DUwDvf.lfPIob',
            'h1.DUwDvf',
            'h1.lfPIob',
            'h1[class*="DUwDvf"]',
            '[data-value="title"]',
            'h1'
          ];
          
          for (const selector of nameSelectors) {
            try {
              const nameElement = businessContainer.locator(selector).first();
              const isVisible = await nameElement.isVisible().catch(() => false);
              if (isVisible) {
                cachedNameElement = nameElement;
                break;
              }
            } catch (e) {
              // Continue to next selector
            }
          }
        } catch (e) {
          // If caching fails, continue without cache
        }
      }
      
      // Extract other data in parallel for better performance
      // Pass businessContainer to scope all searches within it
      // Add individual timeouts to prevent one slow function from blocking everything
      const parallelExtractionStartTime = Date.now();
      const [
        address,
        webpage,
        phone,
        openClosedStatus,
        reviewCount
      ] = await Promise.all([
        Promise.race([
          this.extractAddress(page, businessContainer),
          new Promise<string | null>((resolve) => setTimeout(() => { logger.warn('[Performance] extractAddress timed out after 10s'); resolve(null); }, CONFIG.TIMEOUTS.EXTRACTION_FUNCTION))
        ]),
        Promise.race([
          this.extractWebpage(page, businessContainer),
          new Promise<string | null>((resolve) => setTimeout(() => { logger.warn('[Performance] extractWebpage timed out after 10s'); resolve(null); }, CONFIG.TIMEOUTS.EXTRACTION_FUNCTION))
        ]),
        Promise.race([
          this.extractPhone(page, businessContainer),
          new Promise<string | null>((resolve) => setTimeout(() => { logger.warn('[Performance] extractPhone timed out after 10s'); resolve(null); }, CONFIG.TIMEOUTS.EXTRACTION_FUNCTION))
        ]),
        Promise.race([
          this.extractOpenClosedStatus(page, businessContainer),
          new Promise<any>((resolve) => setTimeout(() => { logger.warn('[Performance] extractOpenClosedStatus timed out after 10s'); resolve('UNKNOWN'); }, CONFIG.TIMEOUTS.EXTRACTION_FUNCTION))
        ]),
        Promise.race([
          this.extractReviewCount(page, businessContainer),
          new Promise<number | null>((resolve) => setTimeout(() => { logger.warn('[Performance] extractReviewCount timed out after 10s'); resolve(null); }, CONFIG.TIMEOUTS.EXTRACTION_FUNCTION))
        ])
      ]);
      const parallelExtractionElapsed = Date.now() - parallelExtractionStartTime;
      logger.performance('Parallel extraction (address, webpage, phone, status, reviews)', parallelExtractionElapsed, CONFIG.PERFORMANCE.PARALLEL_EXTRACTION_SLOW);
      logger.performanceWarning('Parallel extraction', parallelExtractionElapsed, CONFIG.PERFORMANCE.PARALLEL_EXTRACTION_SLOW);
      
      // Extract star rating - if no reviews, there should be no star rating
      // Pass businessContainer and cached name element
      const starRating = reviewCount === null ? null : await this.extractStarRating(page, name, cachedNameElement, businessContainer || undefined);
      
      const extracted: ExtractedData = {
        link: url,
        name,
        address,
        webpage,
        phone,
        openClosedStatus,
        reviewCount,
        starRating,
        errorCode: null
      };
      
      // Log extraction results for debugging
      const extractionElapsed = Date.now() - extractionStartTime;
      logger.debug(`Extraction results (took ${extractionElapsed}ms):`, {
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

      return { extracted, page }; // Return both extracted data and page for reuse
    } catch (e) {
      logger.error('Extraction error:', e);
      return {
        extracted: {
          link: url,
          name: null,
          address: null,
          webpage: null,
          phone: null,
          openClosedStatus: 'UNKNOWN',
          reviewCount: null,
          starRating: null,
          errorCode: 'PAGE_LOAD_FAILED'
        },
        page: null
      };
    }
    // Note: Page is NOT closed here - caller is responsible for closing it
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

  private async extractAddress(page: Page, container?: any): Promise<string | null> {
    // Use container if provided, otherwise search whole page
    const searchContext = container || page;
    
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
        const element = searchContext.locator(selector).first();
        
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

    // Heuristic fallback - look for address-like text in business panel (with timeout)
    // Use container if available, otherwise search for panel
    try {
      const businessPanel = container 
        ? container.locator('[data-value="Overview"]').first() || container
        : page.locator('[data-value="Overview"], [role="main"]').first();
      const panelText = await Promise.race([
        businessPanel.textContent(),
        new Promise<string>((resolve) => setTimeout(() => resolve(''), 1000)) // 1 second timeout
      ]).catch(() => '');
      
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

    // Last resort - container text (with timeout to avoid slow extraction)
    // Only if container is available, otherwise skip (body text is too slow)
    if (container) {
      try {
        const containerText = await Promise.race([
          container.textContent(),
          new Promise<string>((resolve) => setTimeout(() => resolve(''), 1000)) // 1 second timeout
        ]).catch(() => '');
      
        if (containerText) {
          const addressPattern = /(\d+[\s\w]+(?:street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|way|circle|cir)[^,]*,\s*[^,]+)/i;
          const match = containerText.match(addressPattern);
          if (match) {
            return match[1].trim();
          }
        }
      } catch (e) {
        // Timeout or error - skip container text extraction
      }
    }

    return null;
  }

  private async extractWebpage(page: Page, container?: any): Promise<string | null> {
    // Use container if provided, otherwise search whole page
    const searchContext = container || page;
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

    // Try finding link near "Website" text (with timeout)
    try {
      const websiteButton = searchContext.locator('button:has-text("Website"), [aria-label*="Website"]').first();
      const isVisible = await Promise.race([
        websiteButton.isVisible(),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 500))
      ]).catch(() => false);
      
      if (!isVisible) {
        return null; // Website button not found, skip this fallback
      }
      
      const parent = websiteButton.locator('..');
      const link = await Promise.race([
        parent.locator('a[href^="http"]').first().getAttribute('href'),
        new Promise<string | null>((resolve) => setTimeout(() => resolve(null), 500))
      ]).catch(() => null);
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

  private async extractPhone(page: Page, container?: any): Promise<string | null> {
    // Use container if provided, otherwise search whole page
    const searchContext = container || page;
    
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
        const element = searchContext.locator(selector).first();
        
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
    // Use container if available, otherwise search for panel
    try {
      const businessPanel = container 
        ? container.locator('[data-value="Overview"]').first() || container
        : page.locator('[data-value="Overview"], [role="main"]').first();
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

  private async extractOpenClosedStatus(page: Page, container?: any): Promise<OpenClosedStatus> {
    // Use container if provided, otherwise search whole page
    const searchContext = container || page;
    
    // First, check for the "Show open hours for the week" indicator (business is active/open)
    try {
      const openHoursButton = searchContext.locator('[aria-label*="Show open hours"], [aria-label*="show open hours"]').first();
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

  private async extractReviewCount(page: Page, container?: any): Promise<number | null> {
    // Use container if provided, otherwise search whole page
    const searchContext = container || page;
    const startTime = Date.now();
    const functionName = container ? 'extractReviewCount (with container)' : 'extractReviewCount (whole page)';
    
    // Get business name from container's aria-label if available
    let businessName = '';
    if (container) {
      try {
        businessName = await container.getAttribute('aria-label').catch(() => '') || '';
      } catch (e) {
        // Ignore
      }
    }
    // Only extract from aria-label that explicitly contains "review" or "reviews" after the number
    // Format: "1 review" (singular) or "208 reviews" (plural) or "1,234 reviews"
    // Optimization: Use "Directions" button as boundary - only search before it
    // If reviews aren't found before "Directions", return null immediately
    
    // Check if Directions button exists (cache this check)
    let directionsExists = false;
    try {
      const directionsButton = page.locator('button[aria-label="Directions"], button[data-value="Directions"]').first();
      directionsExists = await Promise.race([
        directionsButton.isVisible(),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 300))
      ]).catch(() => false);
    } catch (e) {
      // Directions button not found, continue without boundary
    }
    
    const selectors = [
      'span[role="img"][aria-label*="review"]',  // Most common - try this first
      '[role="img"][aria-label*="review"]',       // Fallback 1
      'span[aria-label*="review"]',              // Fallback 2
      'button[aria-label*="review"]'            // Fallback 3
    ];

    // Try selectors sequentially with early exit - faster for businesses without reviews
    // Optimization: Check all selectors at once using evaluate to find the first valid one before Directions
    if (directionsExists) {
      // If Directions exists, use a single evaluate call to find the first review element before Directions
      try {
        const evalStartTime = Date.now();
        // @ts-ignore - browser context
        const result = await page.evaluate(([selectors, businessName]: [string[], string]) => {
          // @ts-ignore - browser context
          // @ts-ignore - browser context
          // @ts-ignore - browser context
          const searchContainer = businessName 
            // @ts-ignore - browser context
            ? (document.querySelector(`[aria-label="${businessName}"], [aria-label*="${businessName}"]`) || document)
            // @ts-ignore - browser context
            : document;
          
          // @ts-ignore - browser context
          const directionsEl = searchContainer.querySelector('button[aria-label="Directions"], button[data-value="Directions"]');
          if (!directionsEl) return null;
          
          // Try each selector in order - but limit to first 50 elements per selector to avoid slow iteration
          for (const sel of selectors) {
            // @ts-ignore - browser context
            const allElements = searchContainer.querySelectorAll(sel);
            // Limit iteration to first 50 elements to avoid slow processing on pages with many elements
            const maxElements = Math.min(allElements.length, 50);
            for (let i = 0; i < maxElements; i++) {
              // @ts-ignore - browser context
              const element = allElements[i] as Element;
              // Check if element is visible and before Directions
              // @ts-ignore - browser context
              const rect = element.getBoundingClientRect();
              if (rect.width === 0 || rect.height === 0) continue; // Not visible
              
              // Check if element is before Directions using compareDocumentPosition
              // @ts-ignore - browser context
              const isBefore = (element.compareDocumentPosition(directionsEl) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
              if (!isBefore) {
                // If we've passed Directions, no point checking more elements from this selector
                break;
              }
              
              // Get aria-label
              const ariaLabel = element.getAttribute('aria-label');
              if (!ariaLabel || (!ariaLabel.toLowerCase().includes('review') && !ariaLabel.toLowerCase().includes('reviews'))) continue;
              
              // Extract number
              const reviewMatch = ariaLabel.match(/(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?)\s*reviews?/i);
              if (reviewMatch && reviewMatch[1]) {
                const numStr = reviewMatch[1].replace(/[.,]/g, '');
                const num = parseInt(numStr, 10);
                if (!isNaN(num) && num >= 0) {
                  return { selector: sel, count: num, ariaLabel };
                }
              }
              // Try with K/M/B suffix
              const suffixMatch = ariaLabel.match(/(\d+(?:[.,]\d+)?)\s*([kmb])\s*reviews?/i);
              if (suffixMatch && suffixMatch[1] && suffixMatch[2]) {
                const num = parseFloat(suffixMatch[1]);
                const suffix = suffixMatch[2].toLowerCase();
                let multiplier = 1;
                if (suffix === 'k') multiplier = 1000;
                else if (suffix === 'm') multiplier = 1000000;
                else if (suffix === 'b') multiplier = 1000000000;
                const result = Math.round(num * multiplier);
                return { selector: sel, count: result, ariaLabel };
              }
            }
          }
          return null;
        }, [selectors, businessName]).catch(() => null) as { selector: string; count: number; ariaLabel: string } | null;
        const evalElapsed = Date.now() - evalStartTime;
        if (evalElapsed > 1000) {
          console.log(`[Performance] page.evaluate for review count took ${evalElapsed}ms - this is slow!`);
        }
        
        if (result && result.count !== undefined) {
          const elapsed = Date.now() - startTime;
          console.log(`Extracted review count from aria-label using selector "${result.selector}": ${result.count} (took ${elapsed}ms)`);
          return result.count;
        }
      } catch (e) {
        // Fall through to sequential approach
      }
    }
    
    // Fallback: Sequential approach (for when Directions doesn't exist or evaluate failed)
    for (const selector of selectors) {
      try {
        const element = searchContext.locator(selector).first();
        
        // Fast visibility check with timeout
        const isVisible = await Promise.race([
          element.isVisible(),
          new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 200))
        ]).catch(() => false);
        
        if (!isVisible) continue;
        
        // Extract from aria-label - must contain "review" or "reviews" after the number
        const ariaLabel = await element.getAttribute('aria-label').catch(() => null);
        if (ariaLabel && (ariaLabel.toLowerCase().includes('review') || ariaLabel.toLowerCase().includes('reviews'))) {
          // Extract number from aria-label like "1 review" or "208 reviews" or "1,234 reviews"
          const reviewMatch = ariaLabel.match(/(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?)\s*reviews?/i);
          if (reviewMatch && reviewMatch[1]) {
            const numStr = reviewMatch[1].replace(/[.,]/g, '');
            const num = parseInt(numStr, 10);
            if (!isNaN(num) && num >= 0) {
              const elapsed = Date.now() - startTime;
              console.log(`[${functionName}] Extracted review count from aria-label using selector "${selector}": ${num} (took ${elapsed}ms)`);
              if (elapsed > 5000) {
                console.log(`[Performance] WARNING: ${functionName} total time ${elapsed}ms - this is very slow!`);
              }
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
            const elapsed = Date.now() - startTime;
            console.log(`[${functionName}] Extracted review count from aria-label with suffix: ${result} (took ${elapsed}ms)`);
            if (elapsed > 5000) {
              console.log(`[Performance] WARNING: ${functionName} total time ${elapsed}ms - this is very slow!`);
            }
            return result;
          }
        }
      } catch (e) {
        // Continue to next selector
      }
    }

    // No review count found before Directions button - return null
    const elapsed = Date.now() - startTime;
    console.log(`[${functionName}] No review count found before "Directions" button - returning null (took ${elapsed}ms)`);
    if (elapsed > 5000) {
      console.log(`[Performance] WARNING: ${functionName} took ${elapsed}ms - this is very slow!`);
    }
    return null;
  }

  private async extractStarRating(page: Page, businessName: string | null, cachedNameElement?: any, container?: any): Promise<number | null> {
    const startTime = Date.now();
    // Only extract from aria-label that explicitly contains "stars" (plural) after the number
    // Format: "4.5 stars " or "0.0 stars" - must have "stars" (not just "star" or "rating")
    // IMPORTANT: Only look before "Directions" button - if not found before it, return null
    
    // Get business name from container's aria-label if available and businessName is null
    let extractedBusinessName = businessName || '';
    if (!extractedBusinessName && container) {
      try {
        extractedBusinessName = await container.getAttribute('aria-label').catch(() => '') || '';
      } catch (e) {
        // Ignore
      }
    }
    
    // Check if Directions button exists (cache this check)
    let directionsExists = false;
    try {
      const directionsButton = page.locator('button[aria-label="Directions"], button[data-value="Directions"]').first();
      directionsExists = await Promise.race([
        directionsButton.isVisible(),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 300))
      ]).catch(() => false);
    } catch (e) {
      // Directions button not found, continue without boundary
    }
    
    // Determine search context - prioritize business header/top section
    let searchContext: any = null;
    
    // If we have a cached name element, use it directly (optimization)
    if (cachedNameElement) {
      try {
        // Search in parent containers (header section) - max 3 levels up
        const parent = cachedNameElement.locator('..').first();
        const grandParent = parent.locator('..').first();
        const greatGrandParent = grandParent.locator('..').first();
        searchContext = parent; // Start with immediate parent
      } catch (e) {
        // If parent traversal fails, fall back to header section selectors
      }
    }
    
    // If no cached element or parent traversal failed, try to find business header section
    if (!searchContext) {
      // Look for business panel/header section - this is where rating should be
      const headerSelectors = [
        '[data-value="Overview"]',
        '[role="main"]',
        'div[jsaction*="pane"]',
        'div[data-value]'
      ];
      
      for (const headerSelector of headerSelectors) {
        try {
          const headerElement = page.locator(headerSelector).first();
          const isVisible = await headerElement.isVisible().catch(() => false);
          if (isVisible) {
            searchContext = headerElement;
            break;
          }
        } catch (e) {
          // Continue to next selector
        }
      }
    }
    
    // If still no context found, try to find business name element (fallback, but shouldn't happen often)
    if (!searchContext && businessName) {
      try {
        const nameSelectors = [
          'h1.DUwDvf.lfPIob',
          'h1.DUwDvf',
          '[data-value="title"]'
        ];
        
        for (const nameSelector of nameSelectors) {
          try {
            const nameElement = page.locator(nameSelector).first();
            const isVisible = await nameElement.isVisible().catch(() => false);
            if (isVisible) {
              searchContext = nameElement.locator('..').first(); // Use parent
              break;
            }
          } catch (e) {
            // Continue
          }
        }
      } catch (e) {
        // Fall through to use page as last resort
      }
    }
    
    // Final fallback: use page, but this should rarely happen
    if (!searchContext) {
      searchContext = page;
    }
    
    const selectors = [
      'span[role="img"][aria-label*="stars"]',  // Most common - span with role="img" and aria-label containing "stars"
      '[role="img"][aria-label*="stars"]',       // Any element with role="img" and aria-label containing "stars"
      'span[aria-label*="stars"]',              // Span with aria-label containing "stars"
      'button[aria-label*="stars"]'            // Button with "stars" in aria-label
    ];

    // Try all selectors in the header/top section context
    // Optimization: If Directions exists and searching whole page, use a single evaluate call
    if (directionsExists && searchContext === page) {
      try {
        // @ts-ignore - browser context
        const result = await page.evaluate(([selectors, businessName]: [string[], string]) => {
          // @ts-ignore - browser context
          // @ts-ignore - browser context
          // @ts-ignore - browser context
          const searchContainer = businessName 
            // @ts-ignore - browser context
            ? (document.querySelector(`[aria-label="${businessName}"], [aria-label*="${businessName}"]`) || document)
            // @ts-ignore - browser context
            : document;
          
          // @ts-ignore - browser context
          const directionsEl = searchContainer.querySelector('button[aria-label="Directions"], button[data-value="Directions"]');
          if (!directionsEl) return null;
          
          // Try each selector in order
          for (const sel of selectors) {
            // @ts-ignore - browser context
            const elements = Array.from(searchContainer.querySelectorAll(sel));
            for (const el of elements) {
              // @ts-ignore - browser context
              const element = el as Element;
              // Check if element is visible and before Directions
              // @ts-ignore - browser context
              const rect = element.getBoundingClientRect();
              if (rect.width === 0 || rect.height === 0) continue; // Not visible
              
              // Check if element is before Directions using compareDocumentPosition
              // @ts-ignore - browser context
              const isBefore = (element.compareDocumentPosition(directionsEl) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
              if (!isBefore) continue; // After Directions, skip
              
              // Get aria-label
              const ariaLabel = element.getAttribute('aria-label');
              if (!ariaLabel || !ariaLabel.toLowerCase().includes('stars')) continue;
              
              // Parse rating
              const ratingMatch = ariaLabel.match(/^(\d+(?:[.,]\d+)?)\s*stars?\s*(?:\s|$)/i);
              if (ratingMatch && ratingMatch[1]) {
                const numStr = ratingMatch[1].replace(',', '.');
                const num = parseFloat(numStr);
                if (!isNaN(num) && num >= 0 && num <= 5) {
                  const rounded = Math.round(num * 10) / 10;
                  return { selector: sel, rating: rounded, ariaLabel };
                }
              }
            }
          }
          return null;
        }, [selectors, extractedBusinessName]).catch(() => null) as { selector: string; rating: number; ariaLabel: string } | null;
        
        if (result && result.rating !== undefined) {
          const elapsed = Date.now() - startTime;
          console.log(`Extracted star rating from aria-label using selector "${result.selector}": ${result.rating} (aria-label: "${result.ariaLabel}") (took ${elapsed}ms)`);
          return result.rating;
        }
      } catch (e) {
        // Fall through to sequential approach
      }
    }
    
    // Fallback: Sequential approach (for scoped contexts or when evaluate failed)
    for (const selector of selectors) {
      try {
        const element = searchContext.locator(selector).first();
        
        // Fast visibility check with timeout
        const isVisible = await Promise.race([
          element.isVisible(),
          new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 200))
        ]).catch(() => false);
        
        if (!isVisible) continue;
        
        // If Directions button exists, check if this element is before it using fast comparison
        if (directionsExists) {
          try {
            // @ts-ignore - browser context
            const isBeforeDirections = await page.evaluate((sel) => {
              // @ts-ignore - browser context
              const starEl = document.querySelector(sel);
              // @ts-ignore - browser context
              const directionsEl = document.querySelector('button[aria-label="Directions"], button[data-value="Directions"]');
              if (!starEl || !directionsEl) return false;
              // Use compareDocumentPosition - much faster than querySelectorAll('*')
              // DOCUMENT_POSITION_FOLLOWING means directionsEl comes after starEl
              // @ts-ignore - browser context
              return (starEl.compareDocumentPosition(directionsEl) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
            }, selector).catch(() => false);
            
            if (!isBeforeDirections) {
              // Element is after Directions, skip this selector
              continue;
            }
          } catch (e) {
            // If comparison fails, continue checking this element
          }
        }
        
        // Extract from aria-label - must contain "stars" (plural) after the number
        const ariaLabel = await element.getAttribute('aria-label').catch(() => null);
        if (ariaLabel && ariaLabel.toLowerCase().includes('stars')) {
          // Parse from aria-label like "4.5 stars " or "0.0 stars" or "5 stars"
          // Must match pattern: number followed by "stars" (plural), optionally followed by spaces or end of string
          const ratingMatch = ariaLabel.match(/^(\d+(?:[.,]\d+)?)\s*stars?\s*(?:\s|$)/i);
          if (ratingMatch && ratingMatch[1]) {
            const numStr = ratingMatch[1].replace(',', '.');
            const num = parseFloat(numStr);
            // Only accept valid ratings (0.0 to 5.0)
            if (!isNaN(num) && num >= 0 && num <= 5) {
              const rounded = Math.round(num * 10) / 10;
              const elapsed = Date.now() - startTime;
              console.log(`Extracted star rating from aria-label using selector "${selector}": ${rounded} (aria-label: "${ariaLabel}") (took ${elapsed}ms)`);
              return rounded;
            }
          }
        }
      } catch (e) {
        // Continue to next selector
      }
    }
    
    // If we searched in a specific context and didn't find it, try expanding the search
    // but only within the header section (not whole page) - with timeout optimization
    if (searchContext !== page && cachedNameElement) {
      try {
        // Try grandparent and great-grandparent of name element
        const grandParent = cachedNameElement.locator('../..').first();
        const greatGrandParent = cachedNameElement.locator('../../..').first();
        
        for (const expandedContext of [grandParent, greatGrandParent]) {
          for (const selector of selectors) {
            try {
              const element = expandedContext.locator(selector).first();
              
              // First check if element exists (fast check)
              const count = await element.count().catch(() => 0);
              if (count === 0) continue;
              
              // If Directions button exists, check if this element is before it
              if (directionsExists) {
                try {
                  // @ts-ignore - browser context
                  const isBeforeDirections = await page.evaluate((sel) => {
                    // @ts-ignore - browser context
                    const starEl = document.querySelector(sel);
                    // @ts-ignore - browser context
                    const directionsEl = document.querySelector('button[aria-label="Directions"], button[data-value="Directions"]');
                    if (!starEl || !directionsEl) return false;
                    // Use compareDocumentPosition - much faster than querySelectorAll('*')
                    // DOCUMENT_POSITION_FOLLOWING means directionsEl comes after starEl
                    // @ts-ignore - browser context
                    return (starEl.compareDocumentPosition(directionsEl) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
                  }, selector).catch(() => false);
                  
                  if (!isBeforeDirections) {
                    // Element is after Directions, skip
                    continue;
                  }
                } catch (e) {
                  // If comparison fails, continue
                }
              }
              
              // Use timeout for visibility check
              const isVisible = await Promise.race([
                element.isVisible(),
                new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 300))
              ]).catch(() => false);
              
              if (!isVisible) continue;
              
              const ariaLabel = await element.getAttribute('aria-label').catch(() => null);
              if (ariaLabel && ariaLabel.toLowerCase().includes('stars')) {
                const ratingMatch = ariaLabel.match(/^(\d+(?:[.,]\d+)?)\s*stars?\s*(?:\s|$)/i);
                if (ratingMatch && ratingMatch[1]) {
                  const numStr = ratingMatch[1].replace(',', '.');
                  const num = parseFloat(numStr);
                  if (!isNaN(num) && num >= 0 && num <= 5) {
                    const rounded = Math.round(num * 10) / 10;
                    const elapsed = Date.now() - startTime;
                    console.log(`Extracted star rating from expanded context using selector "${selector}": ${rounded} (took ${elapsed}ms)`);
                    return rounded;
                  }
                }
              }
            } catch (e) {
              // Continue
            }
          }
        }
      } catch (e) {
        // If expansion fails, return null
      }
    }

    // No star rating found before Directions button - return null
    const elapsed = Date.now() - startTime;
    console.log(`No star rating found before "Directions" button - returning null (took ${elapsed}ms)`);
    return null;
  }

  async captureScreenshot(url: string, outputPath: string, existingPage?: Page | null): Promise<boolean> {
    console.log(`[Screenshot] captureScreenshot called with url: ${url}, outputPath: ${outputPath}`);
    
    let page: Page | null = null;
    let shouldClosePage = false;
    
    try {
      if (existingPage) {
        // Reuse existing page if provided (from extractBusinessData)
        page = existingPage;
        console.log(`[Screenshot] Reusing existing page, no navigation needed`);
      } else {
        // Create new page if not provided
        const context = await this.getContext();
        page = await context.newPage();
        shouldClosePage = true;
        
        console.log(`[Screenshot] Navigating to URL: ${url}...`);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        console.log(`[Screenshot] Page DOM loaded`);
        
        // Wait for business panel
        try {
          await page.waitForSelector('h1.DUwDvf, h1.lfPIob, [data-value="Overview"], [role="main"]', { 
            timeout: 10000,
            state: 'visible'
          });
          console.log('[Screenshot] Business panel detected');
        } catch (e: any) {
          console.log(`[Screenshot] Business panel not found: ${e.message}, continuing...`);
        }
        
        // Reduced wait time
        await page.waitForTimeout(1500);
      }
      
      // Set viewport to a reasonable size for Google Maps
      // This ensures consistent screenshot dimensions
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.waitForTimeout(300); // Reduced wait
      
      // Capture full page screenshot
      if (!page) {
        console.error('[Screenshot] No page available for screenshot');
        return false;
      }
      
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
      // Only close page if we created it
      if (shouldClosePage && page) {
        await page.close();
        console.log(`[Screenshot] Page closed`);
      }
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


