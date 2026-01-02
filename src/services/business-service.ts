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

    // Create Drive folder and Sheet
    let folderId: string | null = null;
    let spreadsheetId: string | null = null;

    try {
      const isAuthenticated = await this.authService.isAuthenticated();
      if (isAuthenticated) {
        folderId = await this.driveService.createFolder(extracted.name || 'Unknown');
        spreadsheetId = await this.sheetsService.createSpreadsheet(extracted.name || 'Unknown');
      }
    } catch (e) {
      // Auth failure - continue without Sheet
    }

    // Insert business
    const result = await this.db.run(
      `INSERT INTO businesses (canonicalBusinessKey, placeId, cid, url, name, spreadsheetId, folderId)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      canonicalBusinessKey, placeId, cid, normalizedUrl, extracted.name, spreadsheetId, folderId
    );

    const businessId = result.lastID;

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

  async runCheck(businessId: number): Promise<void> {
    // Get business
    const business = await this.db.get<any>(
      'SELECT * FROM businesses WHERE id = ?',
      businessId
    );

    if (!business) {
      throw new Error('Business not found');
    }

    // Check if already checked today
    const today = getDublinDate();
    if (business.lastCheckedDate === today) {
      return; // Already checked today
    }

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

    // Create snapshot
    const snapshot = this.createSnapshot(url, extracted, baseline);

    // Capture screenshot
    let screenshotLink: string | null = null;
    if (business.folderId && !extracted.errorCode) {
      try {
        const screenshotPath = path.join(
          process.cwd(),
          'data',
          'screenshots',
          `${business.id}-${Date.now()}.png`
        );
        
        const screenshotDir = path.dirname(screenshotPath);
        if (!fs.existsSync(screenshotDir)) {
          fs.mkdirSync(screenshotDir, { recursive: true });
        }

        const success = await this.playwright.captureScreenshot(url, screenshotPath);
        if (success) {
          const fileName = `screenshot-${Date.now()}.png`;
          screenshotLink = await this.driveService.uploadScreenshot(
            screenshotPath,
            business.folderId,
            fileName
          );
          // Clean up local file
          fs.unlinkSync(screenshotPath);
        }
      } catch (e) {
        // Screenshot failure doesn't block
      }
    }

    snapshot.screenshotLink = screenshotLink;

    // Append to Sheet
    if (!business.spreadsheetId) {
      // Create Sheet if it doesn't exist
      const folderId = business.folderId || await this.driveService.createFolder(extracted.name || 'Unknown');
      const spreadsheetId = await this.sheetsService.createSpreadsheet(extracted.name || 'Unknown');
      
      await this.db.run(
        'UPDATE businesses SET spreadsheetId = ?, folderId = ? WHERE id = ?',
        spreadsheetId, folderId, businessId
      );
      
      business.spreadsheetId = spreadsheetId;
      business.folderId = folderId;
    }

    await this.sheetsService.appendSnapshot(business.spreadsheetId!, snapshot);

    // Update lastCheckedDate and lastCheckedAt
    const now = new Date().toISOString();
    await this.db.run(
      'UPDATE businesses SET lastCheckedDate = ?, lastCheckedAt = ? WHERE id = ?',
      today, now, businessId
    );
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
}
