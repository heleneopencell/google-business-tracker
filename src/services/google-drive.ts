import { google } from 'googleapis';
import { GoogleAuthService } from './google-auth';
import fs from 'fs';

export class GoogleDriveService {
  private authService: GoogleAuthService;

  constructor(authService: GoogleAuthService) {
    this.authService = authService;
  }

  async createFolder(name: string): Promise<string> {
    await this.authService.refreshTokenIfNeeded();
    const auth = this.authService.getAuthClient();
    const drive = google.drive({ version: 'v3', auth });

    const folder = await drive.files.create({
      requestBody: {
        name: `Google Business - ${name || 'Unknown'}`,
        mimeType: 'application/vnd.google-apps.folder'
      },
      fields: 'id'
    });

    const folderId = folder.data.id;
    if (!folderId) {
      throw new Error('Failed to create folder');
    }

    return folderId;
  }

  async uploadScreenshot(filePath: string, folderId: string, fileName: string): Promise<string> {
    await this.authService.refreshTokenIfNeeded();
    const auth = this.authService.getAuthClient();
    const drive = google.drive({ version: 'v3', auth });

    const fileMetadata = {
      name: fileName,
      parents: [folderId]
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

