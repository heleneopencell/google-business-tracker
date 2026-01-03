#!/usr/bin/env node

import { initDatabase } from './src/db/schema';
import { PlaywrightService } from './src/services/playwright';
import { SessionService } from './src/services/session';
import { GoogleAuthService } from './src/services/google-auth';
import { GoogleSheetsService } from './src/services/google-sheets';
import { GoogleDriveService } from './src/services/google-drive';
import { BusinessService } from './src/services/business-service';

async function testCheck() {
  console.log('=== Starting Test Check ===\n');
  
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
    // Get business ID 7
    const businessId = 7;
    console.log(`1. Getting business ${businessId}...`);
    const business = await businessService.getBusiness(businessId);
    if (!business) {
      console.error('Business not found!');
      return;
    }
    console.log(`   Business found: ${business.name || 'Unknown'}`);
    console.log(`   URL: ${business.url}`);
    console.log(`   SpreadsheetId: ${business.spreadsheetId || 'None'}`);
    console.log(`   FolderId: ${business.folderId || 'None'}`);
    console.log(`   LastCheckedDate: ${business.lastCheckedDate || 'Never'}\n`);

    // Check login
    console.log('2. Checking Google Maps login...');
    const loggedIn = await sessionService.checkLoggedIn();
    console.log(`   Logged in: ${loggedIn}\n`);
    if (!loggedIn) {
      console.error('ERROR: Not logged into Google Maps!');
      return;
    }

    // Check Google auth
    console.log('3. Checking Google OAuth...');
    const isAuthenticated = await authService.isAuthenticated();
    console.log(`   Authenticated: ${isAuthenticated}\n`);
    if (!isAuthenticated) {
      console.error('ERROR: Not authenticated with Google Sheets/Drive!');
      return;
    }

    // Run check
    console.log('4. Running check (force=true)...');
    await businessService.runCheck(businessId, true);
    console.log('   Check completed successfully!\n');

    // Verify spreadsheet
    if (business.spreadsheetId) {
      console.log('5. Verifying spreadsheet...');
      const lastSnapshot = await sheetsService.getLastSnapshot(business.spreadsheetId);
      console.log(`   Last snapshot date: ${lastSnapshot?.date || 'None'}`);
      console.log(`   Last snapshot name: ${lastSnapshot?.name || 'None'}\n`);
    }

    console.log('=== Test Check Complete ===');
  } catch (e: any) {
    console.error('\n=== ERROR ===');
    console.error('Message:', e.message);
    console.error('Stack:', e.stack);
  } finally {
    await playwright.close();
    await sessionService.close();
    db.close();
  }
}

testCheck().catch(console.error);

