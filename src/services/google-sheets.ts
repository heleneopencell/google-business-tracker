import { google } from 'googleapis';
import { GoogleAuthService } from './google-auth';
import { Snapshot } from '../types/snapshot';

export class GoogleSheetsService {
  private authService: GoogleAuthService;

  constructor(authService: GoogleAuthService) {
    this.authService = authService;
  }

  async findSpreadsheetInFolder(folderId: string, spreadsheetName: string): Promise<string | null> {
    await this.authService.refreshTokenIfNeeded();
    const auth = this.authService.getAuthClient();
    const drive = google.drive({ version: 'v3', auth });

    try {
      const existing = await drive.files.list({
        q: `name='${spreadsheetName.replace(/'/g, "\\'")}' and '${folderId}' in parents and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`,
        fields: 'files(id, name)',
        pageSize: 1
      });

      if (existing.data.files && existing.data.files.length > 0) {
        const existingId = existing.data.files[0].id;
        if (existingId) {
          console.log(`[Sheets] Found existing spreadsheet "${spreadsheetName}" with ID: ${existingId}`);
          return existingId;
        }
      }
    } catch (e: any) {
      console.error('[Sheets] Error checking for existing spreadsheet:', e.message);
    }

    return null;
  }

  async verifySpreadsheetExists(spreadsheetId: string): Promise<boolean> {
    await this.authService.refreshTokenIfNeeded();
    const auth = this.authService.getAuthClient();
    const sheets = google.sheets({ version: 'v4', auth });

    try {
      await sheets.spreadsheets.get({
        spreadsheetId,
        fields: 'spreadsheetId'
      });
      return true;
    } catch (e: any) {
      console.log(`[Sheets] Spreadsheet ${spreadsheetId} does not exist or is inaccessible: ${e.message}`);
      return false;
    }
  }

  async createSpreadsheet(name: string, folderId: string | null = null): Promise<string> {
    console.log(`[Sheets] Creating spreadsheet "${name || 'Unknown Business'}"${folderId ? ` in folder ${folderId}` : ''}...`);
    await this.authService.refreshTokenIfNeeded();
    const auth = this.authService.getAuthClient();
    const sheets = google.sheets({ version: 'v4', auth });

    console.log(`[Sheets] Calling sheets.spreadsheets.create...`);
    const spreadsheet = await sheets.spreadsheets.create({
      requestBody: {
        properties: {
          title: name || 'Unknown Business'
        },
        sheets: [{
          properties: {
            title: 'Snapshots'
          }
        }]
      }
    });
    console.log(`[Sheets] Spreadsheet created.`);

    const spreadsheetId = spreadsheet.data.spreadsheetId;
    if (!spreadsheetId) {
      throw new Error('Failed to create spreadsheet');
    }
    console.log(`[Sheets] Spreadsheet ID: ${spreadsheetId}`);

    // Move spreadsheet to business folder if provided
    if (folderId) {
      try {
        console.log(`[Sheets] Moving spreadsheet to folder ${folderId}...`);
        const drive = google.drive({ version: 'v3', auth });
        // First get the current parents
        const file = await drive.files.get({
          fileId: spreadsheetId,
          fields: 'parents'
        });
        
        const previousParents = file.data.parents?.join(',') || '';
        console.log(`[Sheets] Previous parents: ${previousParents}`);
        
        // Move to new folder
        await drive.files.update({
          fileId: spreadsheetId,
          addParents: folderId,
          removeParents: previousParents,
          fields: 'id, parents'
        });
        console.log(`[Sheets] Spreadsheet moved to folder.`);
      } catch (e: any) {
        console.error('[Sheets] Failed to move spreadsheet to folder:', e.message);
        // Continue even if move fails
      }
    }

    // Set up headers
    console.log(`[Sheets] Setting up headers...`);
    await this.setupHeaders(spreadsheetId);
    console.log(`[Sheets] Headers set up.`);

    return spreadsheetId;
  }

  async getSheetId(spreadsheetId: string, sheetName: string = 'Snapshots'): Promise<number> {
    await this.authService.refreshTokenIfNeeded();
    const auth = this.authService.getAuthClient();
    const sheets = google.sheets({ version: 'v4', auth });

    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: 'sheets.properties'
    });

    const sheet = spreadsheet.data.sheets?.find(s => s.properties?.title === sheetName);
    if (!sheet || sheet.properties?.sheetId === undefined || sheet.properties.sheetId === null) {
      // Fallback to first sheet
      const firstSheet = spreadsheet.data.sheets?.[0];
      if (firstSheet?.properties?.sheetId !== undefined && firstSheet.properties.sheetId !== null) {
        return firstSheet.properties.sheetId;
      }
      throw new Error(`Sheet "${sheetName}" not found`);
    }

    return sheet.properties.sheetId;
  }

  private async setupHeaders(spreadsheetId: string): Promise<void> {
    await this.authService.refreshTokenIfNeeded();
    const auth = this.authService.getAuthClient();
    const sheets = google.sheets({ version: 'v4', auth });

    const headers = [
      'Date',
      'CheckedAt',
      'Link',
      'Name',
      'Address',
      'Webpage',
      'Phone',
      'OpenClosedStatus',
      'ReviewCount',
      'StarRating',
      'Activity',
      'ErrorCode',
      'ScreenshotLink'
    ];

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: 'Snapshots!A1:M1',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [headers]
      }
    });

    // Format header row
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{
          repeatCell: {
            range: {
              sheetId: 0,
              startRowIndex: 0,
              endRowIndex: 1
            },
            cell: {
              userEnteredFormat: {
                textFormat: { bold: true },
                backgroundColor: { red: 0.9, green: 0.9, blue: 0.9 }
              }
            },
            fields: 'userEnteredFormat(textFormat,backgroundColor)'
          }
        }]
      }
    });
  }

  async appendSnapshot(spreadsheetId: string, snapshot: Snapshot): Promise<void> {
    await this.authService.refreshTokenIfNeeded();
    const auth = this.authService.getAuthClient();
    const sheets = google.sheets({ version: 'v4', auth });

    const row = [
      snapshot.date, // Date (YYYY-MM-DD, Sheets will parse as date)
      snapshot.checkedAt, // CheckedAt (ISO timestamp)
      snapshot.link || '', // Link
      snapshot.name || '', // Name
      snapshot.address || '', // Address
      snapshot.webpage || '', // Webpage
      snapshot.phone || '', // Phone
      snapshot.openClosedStatus, // OpenClosedStatus
      snapshot.reviewCount !== null ? snapshot.reviewCount : '', // ReviewCount
      snapshot.starRating !== null ? snapshot.starRating : '', // StarRating
      snapshot.activity || '', // Activity
      snapshot.errorCode || '', // ErrorCode
      snapshot.screenshotLink || '' // ScreenshotLink
    ];

    console.log(`[Sheets] Appending row to spreadsheet ${spreadsheetId}`);
    console.log(`[Sheets] Row data:`, {
      date: row[0],
      checkedAt: row[1],
      name: row[3],
      screenshotLink: row[12] || '(empty)'
    });
    console.log(`[Sheets] Full row:`, row);
    
    try {
      const response = await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: 'Snapshots!A:M',
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: {
          values: [row]
        }
      });
      
      console.log(`Successfully appended row. Updated range: ${response.data.updates?.updatedRange}`);
    } catch (e: any) {
      console.error(`Failed to append snapshot to spreadsheet:`, e.message);
      if (e.response?.data) {
        console.error(`Google Sheets API error:`, JSON.stringify(e.response.data, null, 2));
      }
      throw e;
    }

    // Format date column (all rows) - get actual sheet ID
    try {
      const sheetId = await this.getSheetId(spreadsheetId, 'Snapshots');
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{
            repeatCell: {
              range: {
                sheetId: sheetId,
                startRowIndex: 1,
                endRowIndex: 10000,
                startColumnIndex: 0,
                endColumnIndex: 1
              },
              cell: {
                userEnteredFormat: {
                  numberFormat: {
                    type: 'DATE',
                    pattern: 'yyyy-mm-dd'
                  }
                }
              },
              fields: 'userEnteredFormat.numberFormat'
            }
          }]
        }
      });
    } catch (e) {
      // If date formatting fails, continue - it's not critical
      console.error('Failed to format date column:', e);
    }
  }

  async getLastSnapshot(spreadsheetId: string): Promise<Snapshot | null> {
    await this.authService.refreshTokenIfNeeded();
    const auth = this.authService.getAuthClient();
    const sheets = google.sheets({ version: 'v4', auth });

    try {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: 'Snapshots!A2:M'
      });

      const rows = response.data.values || [];
      
      // Find most recent row where ErrorCode is empty and name is not null
      for (let i = rows.length - 1; i >= 0; i--) {
        const row = rows[i];
        if (row.length >= 13) {
          const errorCode = row[11] || '';
          const name = row[3] || '';
          
          if (!errorCode && name) {
            return this.rowToSnapshot(row);
          }
        }
      }

      return null;
    } catch (e) {
      return null;
    }
  }

  private rowToSnapshot(row: any[]): Snapshot {
    return {
      date: row[0] || '',
      checkedAt: row[1] || '',
      link: row[2] || null,
      name: row[3] || null,
      address: row[4] || null,
      webpage: row[5] || null,
      phone: row[6] || null,
      openClosedStatus: (row[7] || 'UNKNOWN') as any,
      reviewCount: row[8] ? parseFloat(row[8]) : null,
      starRating: row[9] ? parseFloat(row[9]) : null,
      activity: row[10] || '',
      errorCode: row[11] || null,
      screenshotLink: row[12] || null
    };
  }

}

