import { Database } from '../db/schema';
import { PlaywrightService } from './playwright';
import { GoogleSheetsService } from './google-sheets';
import { GoogleDriveService } from './google-drive';
import { GoogleAuthService } from './google-auth';
import { Snapshot, ExtractedData } from '../types/snapshot';
import { getDublinDate } from '../utils/timezone';
import { normalizeGoogleMapsUrl, extractPlaceId, extractCid, deriveCanonicalBusinessKey } from '../utils/url';
import { detectChanges } from './change-detection';
import path from 'path';
import fs from 'fs';

export class BusinessService {
  private db: Database;
  private playwright: PlaywrightService;
  private sheetsService: GoogleSheetsService;
  private driveService: GoogleDriveService;
  private authService: GoogleAuthService;

  constructor(
    db: Database,
    playwright: PlaywrightService,
    sheetsService: GoogleSheetsService,
    driveService: GoogleDriveService,
    authService: GoogleAuthService
  ) {
    this.db = db;
    this.playwright = playwright;
    this.sheetsService = sheetsService;
    this.driveService = driveService;
    this.authService = authService;
  }

  async createBusiness(url: string): Promise<{ id: number; canonicalBusinessKey: string }> {
    // Validate and normalize URL
    let normalizedUrl: string;
    try {
      normalizedUrl = normalizeGoogleMapsUrl(url);
      new URL(normalizedUrl); // Validate
    } catch (e) {
      throw new Error('INVALID_URL');
    }

    // Extract place_id and cid
    const placeId = extractPlaceId(normalizedUrl);
    const cid = extractCid(normalizedUrl);
    const canonicalBusinessKey = deriveCanonicalBusinessKey(normalizedUrl, placeId, cid);

    // Check if business already exists
    const existing = await this.db.get<{ id: number }>(
      'SELECT id FROM businesses WHERE canonicalBusinessKey = ?',
      canonicalBusinessKey
    );

    if (existing) {
      return { id: existing.id, canonicalBusinessKey };
    }

    // Check for duplicate placeId or cid
    if (placeId) {
      const dupPlaceId = await this.db.get<{ id: number }>(
        'SELECT id FROM businesses WHERE placeId = ?',
        placeId
      );
      if (dupPlaceId) {
        throw new Error('Duplicate placeId');
      }
    }

    if (cid) {
      const dupCid = await this.db.get<{ id: number }>(
        'SELECT id FROM businesses WHERE cid = ?',
        cid
      );
      if (dupCid) {
        throw new Error('Duplicate cid');
      }
    }

    // Check if logged in
    const loggedIn = await this.playwright.checkLoggedIn();
    if (!loggedIn) {
      throw new Error('NOT_LOGGED_IN');
    }

    // Extract initial data
    const extracted = await this.playwright.extractBusinessData(normalizedUrl);

    // Insert business first to get the ID
    const result = await this.db.run(
      `INSERT INTO businesses (canonicalBusinessKey, placeId, cid, url, name, spreadsheetId, folderId)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      canonicalBusinessKey, placeId, cid, normalizedUrl, extracted.name, null, null
    );

    const businessId = result.lastID;

    // Create Drive folder structure and Sheet
    let folderId: string | null = null;
    let spreadsheetId: string | null = null;

    try {
      const isAuthenticated = await this.authService.isAuthenticated();
      if (isAuthenticated) {
        // Get or create main "Google Business Tracker" folder
        const mainFolderId = await this.driveService.getOrCreateMainFolder();
        
        // Create business folder inside main folder
        const businessName = extracted.name || 'Unknown Business';
        folderId = await this.driveService.createBusinessFolder(businessName, mainFolderId);
        
        // Create screenshots folder inside business folder
        console.log(`Creating screenshots folder in business folder ${folderId}...`);
        await this.driveService.getOrCreateScreenshotsFolder(folderId);
        console.log(`Screenshots folder created.`);
        
        // Create spreadsheet in business folder
        spreadsheetId = await this.sheetsService.createSpreadsheet(businessName, folderId);
        
        // Update business with spreadsheet and folder IDs
        await this.db.run(
          'UPDATE businesses SET spreadsheetId = ?, folderId = ? WHERE id = ?',
          spreadsheetId, folderId, businessId
        );
      }
    } catch (e) {
      // Auth failure - continue without Sheet
      console.error('Failed to create spreadsheet/folder:', e);
    }

    // Create first snapshot
    if (spreadsheetId) {
      const snapshot = this.createSnapshot(normalizedUrl, extracted, null);
      await this.sheetsService.appendSnapshot(spreadsheetId, snapshot);

      // Update lastCheckedDate and lastCheckedAt
      const today = getDublinDate();
      const now = new Date().toISOString();
      await this.db.run(
        'UPDATE businesses SET lastCheckedDate = ?, lastCheckedAt = ? WHERE id = ?',
        today, now, businessId
      );
    }

    return { id: businessId, canonicalBusinessKey };
  }

  async runCheck(businessId: number, force: boolean = false): Promise<void> {
    // Get business
    const business = await this.db.get<any>(
      'SELECT * FROM businesses WHERE id = ?',
      businessId
    );

    if (!business) {
      throw new Error('Business not found');
    }

    // Check if already checked today (unless forced)
    const today = getDublinDate();
    if (!force && business.lastCheckedDate === today) {
      console.log(`Business ${businessId} already checked today (${today}), skipping...`);
      return; // Already checked today
    }
    
    console.log(`Running check for business ${businessId} (${business.name || 'Unknown'})...`);

    // Check if logged in
    const loggedIn = await this.playwright.checkLoggedIn();
    if (!loggedIn) {
      throw new Error('NOT_LOGGED_IN');
    }

    // Check if authenticated with Google
    const isAuthenticated = await this.authService.isAuthenticated();
    if (!isAuthenticated) {
      throw new Error('SHEETS_AUTH_REQUIRED');
    }

    // Get URL from business record
    const url = business.url;
    if (!url) {
      throw new Error('INVALID_URL');
    }

    // Extract data
    const extracted = await this.playwright.extractBusinessData(url);

    // Get baseline for change detection
    let baseline: Snapshot | null = null;
    if (business.spreadsheetId) {
      baseline = await this.sheetsService.getLastSnapshot(business.spreadsheetId);
    }

    // Ensure business has folderId and spreadsheetId before capturing screenshot
    // This is critical for new businesses that might not have these set yet
    if (!business.folderId || !business.spreadsheetId) {
      console.log(`Business ${businessId} missing folderId or spreadsheetId, ensuring they exist...`);
      try {
        // Get or create main folder
        const mainFolderId = await this.driveService.getOrCreateMainFolder();
        
        // Get or create business folder
        const businessName = extracted.name || 'Unknown Business';
        const folderId = business.folderId || await this.driveService.createBusinessFolder(businessName, mainFolderId);
        
        // Ensure screenshots folder exists
        await this.driveService.getOrCreateScreenshotsFolder(folderId);
        
        // Check if spreadsheet already exists in the folder
        let spreadsheetId: string | null = business.spreadsheetId;
        if (!spreadsheetId) {
          const existingSpreadsheetId = await this.sheetsService.findSpreadsheetInFolder(folderId, businessName);
          if (existingSpreadsheetId) {
            spreadsheetId = existingSpreadsheetId;
          } else {
            spreadsheetId = await this.sheetsService.createSpreadsheet(businessName, folderId);
          }
        }
        
        // Update business record with folder and spreadsheet IDs
        await this.db.run(
          'UPDATE businesses SET spreadsheetId = ?, folderId = ? WHERE id = ?',
          spreadsheetId, folderId, businessId
        );
        
        // Update local business object
        business.folderId = folderId;
        business.spreadsheetId = spreadsheetId;
        console.log(`Business ${businessId} now has folderId=${folderId} and spreadsheetId=${spreadsheetId}`);
      } catch (e: any) {
        console.error('Failed to ensure folder/spreadsheet for business:', e);
        // Continue - screenshot will be skipped but check can still proceed
      }
    } else {
      // Verify spreadsheet still exists
      const exists = await this.sheetsService.verifySpreadsheetExists(business.spreadsheetId);
      if (!exists) {
        console.log(`Spreadsheet ${business.spreadsheetId} no longer exists, will recreate...`);
        await this.db.run('UPDATE businesses SET spreadsheetId = NULL WHERE id = ?', businessId);
        business.spreadsheetId = null;
        // Recursively ensure folder/spreadsheet (will be handled in next iteration)
      } else {
        // Ensure screenshots folder exists
        await this.driveService.getOrCreateScreenshotsFolder(business.folderId);
      }
    }

    // Create snapshot first to get checkedAt timestamp for filename
    const snapshot = this.createSnapshot(url, extracted, baseline);
    
    // Capture screenshot
    let screenshotLink: string | null = null;
    console.log(`Screenshot capture check: folderId=${business.folderId}, errorCode=${extracted.errorCode}`);
    
    if (business.folderId && !extracted.errorCode) {
      try {
        console.log(`[Screenshot] Starting screenshot capture for business ${businessId}...`);
        console.log(`[Screenshot] Business folder ID: ${business.folderId}`);
        
        // Use checkedAt timestamp for filename (format: 2026-01-02T17:16:01.382Z -> 2026-01-02T17-16-01-382Z.png)
        const timestampForFilename = snapshot.checkedAt.replace(/:/g, '-').replace(/\./g, '-').replace('Z', '');
        const fileName = `${timestampForFilename}.png`;
        
        const screenshotPath = path.join(
          process.cwd(),
          'data',
          'screenshots',
          `${business.id}-${timestampForFilename}.png`
        );
        
        const screenshotDir = path.dirname(screenshotPath);
        if (!fs.existsSync(screenshotDir)) {
          fs.mkdirSync(screenshotDir, { recursive: true });
          console.log(`[Screenshot] Created screenshot directory: ${screenshotDir}`);
        }

        console.log(`[Screenshot] Local screenshot path: ${screenshotPath}`);
        console.log(`[Screenshot] Target filename in Drive: ${fileName}`);
        console.log(`[Screenshot] Calling captureScreenshot...`);
        
        const success = await this.playwright.captureScreenshot(url, screenshotPath);
        console.log(`[Screenshot] captureScreenshot returned: ${success}`);
        
        if (success) {
          // Verify file exists
          if (fs.existsSync(screenshotPath)) {
            const stats = fs.statSync(screenshotPath);
            console.log(`[Screenshot] File exists, size: ${stats.size} bytes`);
          } else {
            console.error(`[Screenshot] ERROR: File was not created at ${screenshotPath}`);
          }
          
          console.log(`[Screenshot] Uploading to Drive in business folder ${business.folderId}...`);
          screenshotLink = await this.driveService.uploadScreenshot(
            screenshotPath,
            business.folderId,
            fileName
          );
          console.log(`[Screenshot] Upload complete, link: ${screenshotLink}`);
          
          // Clean up local file
          if (fs.existsSync(screenshotPath)) {
            fs.unlinkSync(screenshotPath);
            console.log(`[Screenshot] Local file cleaned up`);
          }
        } else {
          console.error(`[Screenshot] Screenshot capture returned false - capture failed`);
        }
      } catch (e: any) {
        console.error(`[Screenshot] Exception during screenshot capture:`, e);
        console.error(`[Screenshot] Error stack:`, e.stack);
        // Screenshot failure doesn't block
      }
    } else {
      if (!business.folderId) {
        console.log(`[Screenshot] SKIPPED: No folderId for business ${businessId}`);
      }
      if (extracted.errorCode) {
        console.log(`[Screenshot] SKIPPED: Extraction error code ${extracted.errorCode}`);
      }
    }

    snapshot.screenshotLink = screenshotLink;
    console.log(`[BusinessService] Snapshot screenshotLink set to: ${snapshot.screenshotLink || '(null/empty)'}`);
    console.log(`[BusinessService] Screenshot link value:`, screenshotLink);

    // Append to Sheet
    // Note: folderId and spreadsheetId should already be set above, but verify one more time
    if (!business.spreadsheetId) {
      throw new Error('SHEETS_WRITE_FAILED: No spreadsheet ID available for business');
    }
    console.log(`Appending snapshot to spreadsheet ${business.spreadsheetId}...`);
    try {
      await this.sheetsService.appendSnapshot(business.spreadsheetId!, snapshot);
      console.log(`Successfully appended snapshot to spreadsheet`);
    } catch (e: any) {
      console.error(`Failed to append snapshot:`, e.message);
      throw new Error(`SHEETS_WRITE_FAILED: ${e.message}`);
    }

    // Update lastCheckedDate and lastCheckedAt
    const now = new Date().toISOString();
    await this.db.run(
      'UPDATE businesses SET lastCheckedDate = ?, lastCheckedAt = ? WHERE id = ?',
      today, now, businessId
    );
    console.log(`Updated lastCheckedDate to ${today} and lastCheckedAt to ${now}`);
  }

  private createSnapshot(
    url: string,
    extracted: ExtractedData,
    baseline: Snapshot | null
  ): Snapshot {
    const today = getDublinDate();
    const now = new Date().toISOString();

    // Determine activity
    let activity = '';
    if (extracted.errorCode === 'EXTRACTION_FAILED') {
      activity = 'EXTRACTION_FAILED';
    } else if (baseline) {
      activity = detectChanges(baseline, {
        date: today,
        checkedAt: now,
        link: extracted.link,
        name: extracted.name,
        address: extracted.address,
        webpage: extracted.webpage,
        phone: extracted.phone,
        openClosedStatus: extracted.openClosedStatus,
        reviewCount: extracted.reviewCount,
        starRating: extracted.starRating,
        activity: '',
        errorCode: extracted.errorCode,
        screenshotLink: null
      });
    }

    return {
      date: today,
      checkedAt: now,
      link: extracted.link,
      name: extracted.name,
      address: extracted.address,
      webpage: extracted.webpage,
      phone: extracted.phone,
      openClosedStatus: extracted.openClosedStatus,
      reviewCount: extracted.reviewCount,
      starRating: extracted.starRating,
      activity,
      errorCode: extracted.errorCode,
      screenshotLink: null
    };
  }

  async getAllBusinesses(): Promise<any[]> {
    return await this.db.all('SELECT * FROM businesses ORDER BY createdAt DESC');
  }

  async getBusiness(id: number): Promise<any> {
    return await this.db.get('SELECT * FROM businesses WHERE id = ?', id);
  }

  async deleteBusiness(id: number): Promise<void> {
    // Check if business exists
    const business = await this.db.get('SELECT * FROM businesses WHERE id = ?', id);
    if (!business) {
      throw new Error('Business not found');
    }

    // Delete from database
    await this.db.run('DELETE FROM businesses WHERE id = ?', id);
    
    // Note: We don't delete the Google Sheet or Drive folder
    // They remain in Google Drive for historical data
  }
}
