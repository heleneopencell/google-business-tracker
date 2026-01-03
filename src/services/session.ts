import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { BROWSER_ARGS, BROWSER_CONFIG, addAntiDetectionScripts } from '../utils/browser-config';
import { loadStorageState, saveStorageState, getStorageStateAge, ensureProfileDirectory } from '../utils/storage-state';
import { CONFIG } from '../config/constants';
import { logger } from '../utils/logger';
import { safeLocatorCheck, safePageOperation } from '../utils/promise-helpers';

export class SessionService {
  private headlessBrowser: Browser | null = null; // For status checks (headless)
  private visibleBrowser: Browser | null = null; // For manual login (visible)
  private headlessContext: BrowserContext | null = null;
  private loginContext: BrowserContext | null = null;
  private statusCheckPage: Page | null = null; // Reusable page for status checks
  private loginInProgress: boolean = false;

  // Headless context for status checks (no visible windows)
  async getHeadlessContext(): Promise<BrowserContext> {
    if (this.headlessContext) {
      return this.headlessContext;
    }

    if (!this.headlessBrowser) {
      this.headlessBrowser = await chromium.launch({
        headless: true, // HEADLESS for status checks
        channel: 'chromium',
        args: BROWSER_ARGS
      });
    }

    ensureProfileDirectory();
    const storageState = loadStorageState();

    this.headlessContext = await this.headlessBrowser.newContext({
      ...BROWSER_CONFIG,
      storageState: storageState
    });
    
    await addAntiDetectionScripts(this.headlessContext);

    return this.headlessContext;
  }

  // Visible context for manual login (opens visible window)
  async getLoginContext(): Promise<BrowserContext> {
    if (this.loginContext) {
      return this.loginContext;
    }

    if (!this.visibleBrowser) {
      this.visibleBrowser = await chromium.launch({
        headless: false, // VISIBLE for manual login
        channel: 'chromium',
        args: BROWSER_ARGS
      });
    }

    ensureProfileDirectory();
    const storageState = loadStorageState();

    this.loginContext = await this.visibleBrowser.newContext({
      ...BROWSER_CONFIG,
      storageState: storageState
    });
    
    await addAntiDetectionScripts(this.loginContext);

    return this.loginContext;
  }

  async saveStorageState(): Promise<void> {
    // Save from visible context if available (has most recent cookies), otherwise headless
    const context = this.loginContext || this.headlessContext;
    if (context) {
      await saveStorageState(context);
    }
  }

  async reloadLoginContext(): Promise<void> {
    // Force reload headless context (for status checks) with latest storage state
    if (this.headlessContext) {
      await this.headlessContext.close().catch(() => {});
      this.headlessContext = null;
    }
    // Close status check page if it exists
    if (this.statusCheckPage) {
      await this.statusCheckPage.close().catch(() => {});
      this.statusCheckPage = null;
    }
    // Next getHeadlessContext() call will create new context with latest storage
  }

  async checkLoggedIn(): Promise<boolean> {
    // Only reload context if storage file was recently updated
    const age = getStorageStateAge();
    if (age !== null && age < CONFIG.STORAGE.STORAGE_RELOAD_AGE) {
      await this.reloadLoginContext();
    }
    
    // Use HEADLESS context for status checks (no visible windows)
    const context = await this.getHeadlessContext();
    
    // Reuse status check page if it exists and is not closed
    let page: Page;
    if (this.statusCheckPage && !this.statusCheckPage.isClosed()) {
      page = this.statusCheckPage;
      // Navigate to a blank page first to clear any previous state
      try {
        await page.goto('about:blank', { waitUntil: 'domcontentloaded', timeout: CONFIG.TIMEOUTS.LOGIN_CHECK });
      } catch (e) {
        // If page is invalid, create a new one
        page = await context.newPage();
        this.statusCheckPage = page;
      }
    } else {
      page = await context.newPage();
      this.statusCheckPage = page;
    }
    
    try {
      await page.goto('https://www.google.com/maps', { 
        waitUntil: 'domcontentloaded', 
        timeout: CONFIG.TIMEOUTS.PAGE_LOAD 
      });
      await page.waitForTimeout(2000); // Reduced wait time since we're reusing page
      
      // Multiple ways to check if logged in
      const checks = await Promise.all([
        // Check for account avatar/button
        safeLocatorCheck(page.locator('[data-value="Account"], button[aria-label*="Account"], [aria-label*="Google Account"]').first(), CONFIG.TIMEOUTS.VISIBILITY_CHECK),
        // Check for profile picture
        safeLocatorCheck(page.locator('img[alt*="Account"], img[alt*="Profile"]').first(), CONFIG.TIMEOUTS.VISIBILITY_CHECK),
        // Check for account menu
        safeLocatorCheck(page.locator('[role="button"][aria-label*="Account"]').first(), CONFIG.TIMEOUTS.VISIBILITY_CHECK),
        // Check cookies for logged-in indicators
        safePageOperation(
          () => page.evaluate(() => {
            // @ts-ignore - browser context
            return (typeof document !== 'undefined' && 
              // @ts-ignore - browser context
              (document.cookie.includes('SID') || 
               // @ts-ignore - browser context
               document.cookie.includes('HSID') || 
               // @ts-ignore - browser context
               document.cookie.includes('SSID'))) || false;
          }),
          false,
          'checkLoggedIn-cookies'
        )
      ]);
      
      const isLoggedIn = checks.some((check: boolean | undefined) => check === true);
      
      // Check for sign in button (logged out indicator)
      const signInVisible = await safeLocatorCheck(
        page.locator('text=/sign in/i, button:has-text("Sign in")').first(),
        CONFIG.TIMEOUTS.VISIBILITY_CHECK
      );
      
      // Don't close the page - keep it for reuse
      
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
      // If error, close page and create new one next time
      if (this.statusCheckPage === page) {
        await page.close().catch(() => {});
        this.statusCheckPage = null;
      } else {
        await page.close().catch(() => {});
      }
      logger.error('Error checking login status:', e);
      return false;
    }
  }

  async openLoginPage(): Promise<void> {
    // Prevent multiple simultaneous login attempts
    if (this.loginInProgress) {
      logger.info('Login already in progress. Please wait...');
      return;
    }
    
    this.loginInProgress = true;
    
    try {
      // First check if already logged in
      const alreadyLoggedIn = await this.checkLoggedIn();
      if (alreadyLoggedIn) {
        logger.info('Already logged in!');
        this.loginInProgress = false;
        return;
      }
      
      const context = await this.getLoginContext();
      const page = await context.newPage();
      
      try {
        // Navigate to Google Maps
        await page.goto('https://www.google.com/maps', { 
          waitUntil: 'domcontentloaded', 
          timeout: CONFIG.TIMEOUTS.PAGE_LOAD 
        });
        await page.waitForTimeout(3000); // Wait for page to fully render
        
        // Check if already logged in on this page
        const checks = await Promise.all([
          safeLocatorCheck(page.locator('[data-value="Account"], button[aria-label*="Account"]').first(), CONFIG.TIMEOUTS.VISIBILITY_CHECK),
          safeLocatorCheck(page.locator('img[alt*="Account"], img[alt*="Profile"]').first(), CONFIG.TIMEOUTS.VISIBILITY_CHECK),
          safePageOperation(
            () => page.evaluate(() => {
              // @ts-ignore - browser context
              return (typeof document !== 'undefined' && 
                // @ts-ignore - browser context
                (document.cookie.includes('SID') || 
                 // @ts-ignore - browser context
                 document.cookie.includes('HSID'))) || false;
            }),
            false,
            'openLoginPage-cookies'
          )
        ]);
        
        if (checks.some((check: boolean | undefined) => check === true)) {
          await this.saveStorageState();
          this.loginInProgress = false;
          await page.close();
          return;
        }
        
        // Try to find and click sign in button
        const signInButton = page.locator('text=/sign in/i, button:has-text("Sign in")').first();
        const signInVisible = await safeLocatorCheck(signInButton, CONFIG.TIMEOUTS.VISIBILITY_CHECK);
        
        if (signInVisible) {
          await signInButton.click();
          await page.waitForTimeout(2000);
        }
        
        // Keep the page open and wait for user to complete login
        // Check periodically if user has logged in
        let loggedIn = false;
        const maxWaitTime = CONFIG.TIMEOUTS.LOGIN_MAX_WAIT;
        const checkInterval = CONFIG.EXTRACTION.REVIEW_CHECK_INTERVAL;
        const startTime = Date.now();
        
        logger.info('Browser window opened. Please log in to your Google account.');
        logger.info('The app will automatically detect when you are logged in.');
        
        while (!loggedIn && (Date.now() - startTime) < maxWaitTime) {
          await page.waitForTimeout(checkInterval);
          
          // Check if we're logged in using multiple methods
          try {
            const loginChecks = await Promise.all([
              safeLocatorCheck(page.locator('[data-value="Account"], button[aria-label*="Account"]').first(), CONFIG.TIMEOUTS.VISIBILITY_CHECK),
              safeLocatorCheck(page.locator('img[alt*="Account"], img[alt*="Profile"]').first(), CONFIG.TIMEOUTS.VISIBILITY_CHECK),
              safePageOperation(
                () => page.evaluate(() => {
                  // @ts-ignore - browser context
                  return (typeof document !== 'undefined' && 
                    // @ts-ignore - browser context
                    (document.cookie.includes('SID') || 
                     // @ts-ignore - browser context
                     document.cookie.includes('HSID') || 
                     // @ts-ignore - browser context
                     document.cookie.includes('SSID'))) || false;
                }),
                false,
                'openLoginPage-polling'
              )
            ]);
            
            if (loginChecks.some((check: boolean) => check === true)) {
              loggedIn = true;
              logger.info('Login detected! Saving session...');
              break;
            }
          } catch (e) {
            // Continue waiting
          }
        }
        
        // Save storage state after login (or timeout)
        if (loggedIn) {
          await this.saveStorageState();
          // Reload headless context to pick up new cookies for status checks
          await this.reloadLoginContext();
          logger.info('Session saved successfully!');
        } else {
          logger.warn('Login timeout. Please try again.');
        }
        
        // Don't close the page - let user close it manually
        if (loggedIn) {
          logger.info('You can now close the browser window and return to the app.');
        }
      } catch (e) {
        // If there's an error, still try to save state
        await this.saveStorageState().catch(() => {});
        await page.close().catch(() => {});
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

  async close(): Promise<void> {
    if (this.statusCheckPage) {
      await this.statusCheckPage.close().catch(() => {});
      this.statusCheckPage = null;
    }
    if (this.headlessContext) {
      await this.headlessContext.close().catch(() => {});
      this.headlessContext = null;
    }
    if (this.loginContext) {
      await this.loginContext.close().catch(() => {});
      this.loginContext = null;
    }
    if (this.headlessBrowser) {
      await this.headlessBrowser.close().catch(() => {});
      this.headlessBrowser = null;
    }
    if (this.visibleBrowser) {
      await this.visibleBrowser.close().catch(() => {});
      this.visibleBrowser = null;
    }
  }
}

