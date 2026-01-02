import { google } from 'googleapis';
import { GoogleAuthService } from './google-auth';
import { Snapshot } from '../types/snapshot';

export class GoogleSheetsService {
  private authService: GoogleAuthService;

  constructor(authService: GoogleAuthService) {
    this.authService = authService;
  }

  async createSpreadsheet(name: string): Promise<string> {
    await this.authService.refreshTokenIfNeeded();
    const auth = this.authService.getAuthClient();
    const sheets = google.sheets({ version: 'v4', auth });

    const spreadsheet = await sheets.spreadsheets.create({
      requestBody: {
        properties: {
          title: `Google Business - ${name || 'Unknown'}`
        },
        sheets: [{
          properties: {
            title: 'Snapshots'
          }
        }]
      }
    });

    const spreadsheetId = spreadsheet.data.spreadsheetId;
    if (!spreadsheetId) {
      throw new Error('Failed to create spreadsheet');
    }

    // Set up headers
    await this.setupHeaders(spreadsheetId);

    return spreadsheetId;
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

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'Snapshots!A:M',
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [row]
      }
    });

    // Format date column (all rows)
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{
          repeatCell: {
            range: {
              sheetId: 0,
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

