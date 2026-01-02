import { google } from 'googleapis';
import { GoogleAuthService } from './google-auth';
import fs from 'fs';

export class GoogleDriveService {
  private authService: GoogleAuthService;
  private mainFolderId: string | null = null;

  constructor(authService: GoogleAuthService) {
    this.authService = authService;
  }

  async getOrCreateMainFolder(): Promise<string> {
    if (this.mainFolderId) {
      return this.mainFolderId;
    }

    await this.authService.refreshTokenIfNeeded();
    const auth = this.authService.getAuthClient();
    const drive = google.drive({ version: 'v3', auth });

    const folderName = 'Google Business Tracker';
    
    // Check if main folder already exists
    try {
      const existing = await drive.files.list({
        q: `name='${folderName.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
        fields: 'files(id, name)',
        pageSize: 1
      });

      if (existing.data.files && existing.data.files.length > 0) {
        const existingId = existing.data.files[0].id;
        if (existingId) {
          this.mainFolderId = existingId;
          return existingId;
        }
      }
    } catch (e) {
      console.error('Error checking for main folder:', e);
    }

    // Create main folder if it doesn't exist
    const folder = await drive.files.create({
      requestBody: {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder'
      },
      fields: 'id'
    });

    const folderId = folder.data.id;
    if (!folderId) {
      throw new Error('Failed to create main folder');
    }

    this.mainFolderId = folderId;
    return folderId;
  }

  async createBusinessFolder(businessName: string, mainFolderId: string): Promise<string> {
    await this.authService.refreshTokenIfNeeded();
    const auth = this.authService.getAuthClient();
    const drive = google.drive({ version: 'v3', auth });

    const folderName = businessName || 'Unknown Business';
    
    // Check if business folder already exists in main folder
    try {
      const existing = await drive.files.list({
        q: `name='${folderName.replace(/'/g, "\\'")}' and '${mainFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
        fields: 'files(id, name)',
        pageSize: 1
      });

      if (existing.data.files && existing.data.files.length > 0) {
        const existingId = existing.data.files[0].id;
        if (existingId) {
          return existingId;
        }
      }
    } catch (e) {
      console.error('Error checking for existing business folder:', e);
    }

    // Create new business folder inside main folder
    const folder = await drive.files.create({
      requestBody: {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [mainFolderId]
      },
      fields: 'id'
    });

    const folderId = folder.data.id;
    if (!folderId) {
      throw new Error('Failed to create business folder');
    }

    return folderId;
  }

  async getOrCreateScreenshotsFolder(businessFolderId: string): Promise<string> {
    await this.authService.refreshTokenIfNeeded();
    const auth = this.authService.getAuthClient();
    const drive = google.drive({ version: 'v3', auth });

    const folderName = 'screenshots';
    
    // Check if screenshots folder already exists in business folder
    try {
      const existing = await drive.files.list({
        q: `name='${folderName}' and '${businessFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
        fields: 'files(id, name)',
        pageSize: 1
      });

      if (existing.data.files && existing.data.files.length > 0) {
        const existingId = existing.data.files[0].id;
        if (existingId) {
          return existingId;
        }
      }
    } catch (e) {
      console.error('Error checking for screenshots folder:', e);
    }

    // Create screenshots folder inside business folder
    const folder = await drive.files.create({
      requestBody: {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [businessFolderId]
      },
      fields: 'id'
    });

    const folderId = folder.data.id;
    if (!folderId) {
      throw new Error('Failed to create screenshots folder');
    }

    return folderId;
  }

  async uploadScreenshot(filePath: string, businessFolderId: string, fileName: string): Promise<string> {
    await this.authService.refreshTokenIfNeeded();
    const auth = this.authService.getAuthClient();
    const drive = google.drive({ version: 'v3', auth });

    // Get or create screenshots folder inside business folder
    const screenshotsFolderId = await this.getOrCreateScreenshotsFolder(businessFolderId);

    const fileMetadata = {
      name: fileName,
      parents: [screenshotsFolderId]
    };

    const media = {
      mimeType: 'image/png',
      body: fs.createReadStream(filePath)
    };

    const file = await drive.files.create({
      requestBody: fileMetadata,
      media: media,
      fields: 'id, webViewLink'
    });

    // Make file accessible to anyone with the link
    await drive.permissions.create({
      fileId: file.data.id!,
      requestBody: {
        role: 'reader',
        type: 'anyone'
      }
    });

    return file.data.webViewLink || '';
  }
}

