#!/usr/bin/env node

import { initDatabase } from './db/schema';
import { PlaywrightService } from './services/playwright';
import { GoogleAuthService } from './services/google-auth';
import { GoogleSheetsService } from './services/google-sheets';
import { GoogleDriveService } from './services/google-drive';
import { BusinessService } from './services/business-service';
import { withLock } from './utils/lock';

async function runDailyCheck() {
  const db = initDatabase();
  const playwright = new PlaywrightService();
  const authService = new GoogleAuthService();
  const sheetsService = new GoogleSheetsService(authService);
  const driveService = new GoogleDriveService(authService);
  const businessService = new BusinessService(
    db,
    playwright,
    sheetsService,
    driveService,
    authService
  );

  try {
    await withLock(async () => {
      // Check session
      const loggedIn = await playwright.checkLoggedIn();
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
          await businessService.runCheck(business.id);
          successCount++;
        } catch (e: any) {
          console.error(`Failed to check business ${business.id}: ${e.message}`);
          failureCount++;
          // Extraction failures don't fail the run
          if (e.message !== 'EXTRACTION_FAILED') {
            // But other failures might
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

