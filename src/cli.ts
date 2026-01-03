#!/usr/bin/env node

import { initDatabase } from './db/schema';
import { PlaywrightService } from './services/playwright';
import { SessionService } from './services/session';
import { GoogleAuthService } from './services/google-auth';
import { GoogleSheetsService } from './services/google-sheets';
import { GoogleDriveService } from './services/google-drive';
import { BusinessService } from './services/business-service';
import { withLock } from './utils/lock';

async function runDailyCheck() {
  const db = initDatabase();
  const playwright = new PlaywrightService();
  const sessionService = new SessionService();
  const authService = new GoogleAuthService();
  const sheetsService = new GoogleSheetsService(authService);
  const driveService = new GoogleDriveService(authService);
  const businessService = new BusinessService(
    db,
    playwright,
    sheetsService,
    driveService,
    authService,
    sessionService
  );

  try {
    await withLock(async () => {
      // Check session
      const loggedIn = await sessionService.checkLoggedIn();
      if (!loggedIn) {
        throw new Error('NOT_LOGGED_IN');
      }

      // Check auth
      const authenticated = await authService.isAuthenticated();
      if (!authenticated) {
        throw new Error('SHEETS_AUTH_REQUIRED');
      }

      // Get all businesses
      const businesses = await businessService.getAllBusinesses();
      
      let successCount = 0;
      let failureCount = 0;

      for (const business of businesses) {
        try {
          // Force check even if already checked today - scheduled runs should always execute
          await businessService.runCheck(business.id, true);
          successCount++;
          
          // Add random delay between businesses to simulate human behavior (3-6 seconds)
          // This helps avoid bot detection from rapid sequential requests
          if (businesses.indexOf(business) < businesses.length - 1) {
            const delay = 3000 + Math.random() * 3000; // 3-6 seconds
            console.log(`Waiting ${Math.round(delay)}ms before next business...`);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        } catch (e: any) {
          console.error(`Failed to check business ${business.id}: ${e.message}`);
          failureCount++;
          // Extraction failures don't fail the run
          if (e.message !== 'EXTRACTION_FAILED') {
            // But other failures might
          }
          
          // Even on error, add delay before next business
          if (businesses.indexOf(business) < businesses.length - 1) {
            const delay = 2000 + Math.random() * 2000; // 2-4 seconds on error
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      }

      // Update run_state
      const now = new Date().toISOString();
      const status = failureCount === 0 ? 'SUCCESS' : 'PARTIAL';
      await db.run(
        'UPDATE run_state SET lastRunAt = ?, lastRunStatus = ?, lastRunError = NULL WHERE id = 1',
        now, status
      );

      console.log(`Daily check completed: ${successCount} successful, ${failureCount} failed`);
    }, true); // Allow override of stale locks
  } catch (e: any) {
    // Update run_state with error
    const now = new Date().toISOString();
    await db.run(
      "UPDATE run_state SET lastRunAt = ?, lastRunStatus = 'FAILED', lastRunError = ? WHERE id = 1",
      now, e.message
    );

    console.error(`Daily check failed: ${e.message}`);
    process.exit(1);
  } finally {
    await playwright.close();
    await sessionService.close();
    db.close();
  }
}

// CLI command handling
const command = process.argv[2];

if (command === 'run-daily-check') {
  runDailyCheck().catch(e => {
    console.error(e);
    process.exit(1);
  });
} else {
  console.error('Unknown command. Use: run-daily-check');
  process.exit(1);
}

