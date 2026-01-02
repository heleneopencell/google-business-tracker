import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';

const TOKEN_PATH = path.join(process.cwd(), 'data', 'token.json');
const CREDENTIALS_PATH = path.join(process.cwd(), 'data', 'credentials.json');

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file'
];

export interface OAuthCredentials {
  client_id: string;
  client_secret: string;
  redirect_uri: string;
}

export class GoogleAuthService {
  private oauth2Client: any;
  private credentials: OAuthCredentials | null = null;

  constructor() {
    this.loadCredentials();
  }

  private loadCredentials(): void {
    if (fs.existsSync(CREDENTIALS_PATH)) {
      this.credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf-8'));
    } else if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
      this.credentials = {
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/auth/callback'
      };
    }

    if (this.credentials) {
      this.oauth2Client = new google.auth.OAuth2(
        this.credentials.client_id,
        this.credentials.client_secret,
        this.credentials.redirect_uri
      );

      // Load existing token
      if (fs.existsSync(TOKEN_PATH)) {
        const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
        this.oauth2Client.setCredentials(token);
      }
    }
  }

  getAuthUrl(): string {
    if (!this.oauth2Client) {
      throw new Error('OAuth credentials not configured');
    }

    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      prompt: 'consent'
    });
  }

  async getToken(code: string): Promise<void> {
    if (!this.oauth2Client) {
      throw new Error('OAuth credentials not configured');
    }

    const { tokens } = await this.oauth2Client.getToken(code);
    this.oauth2Client.setCredentials(tokens);
    
    // Save token
    const dataDir = path.dirname(TOKEN_PATH);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
  }

  async isAuthenticated(): Promise<boolean> {
    if (!this.oauth2Client) {
      return false;
    }

    try {
      const token = this.oauth2Client.credentials;
      if (!token || !token.access_token) {
        return false;
      }

      // Check if token is valid by making a simple API call
      this.oauth2Client.setCredentials(token);
      const drive = google.drive({ version: 'v3', auth: this.oauth2Client });
      await drive.files.list({ pageSize: 1 });
      return true;
    } catch (e) {
      return false;
    }
  }

  getAuthClient(): any {
    if (!this.oauth2Client) {
      throw new Error('OAuth credentials not configured');
    }

    const token = this.oauth2Client.credentials;
    if (!token || !token.access_token) {
      throw new Error('SHEETS_AUTH_REQUIRED');
    }

    return this.oauth2Client;
  }

  async refreshTokenIfNeeded(): Promise<void> {
    if (!this.oauth2Client) {
      throw new Error('OAuth credentials not configured');
    }

    const token = this.oauth2Client.credentials;
    if (!token) {
      throw new Error('SHEETS_AUTH_REQUIRED');
    }

    // Check if token is expired
    if (token.expiry_date && token.expiry_date <= Date.now()) {
      try {
        const { credentials } = await this.oauth2Client.refreshAccessToken();
        this.oauth2Client.setCredentials(credentials);
        fs.writeFileSync(TOKEN_PATH, JSON.stringify(credentials, null, 2));
      } catch (e) {
        throw new Error('SHEETS_AUTH_REQUIRED');
      }
    }
  }
}

