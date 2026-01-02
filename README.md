# Google Business Tracker

Track Google Maps business listings over time and store daily snapshots in Google Sheets.

## Features

- **Automated Tracking**: Daily snapshots of business data from Google Maps
- **Change Detection**: Automatically detects changes in business information
- **Screenshot Capture**: Captures standardized screenshots of business overview panels
- **Google Sheets Integration**: Stores all data in organized Google Sheets
- **Persistent Sessions**: Maintains logged-in Google Maps session
- **Daily Gating**: Ensures at most one check per business per Dublin day

## Prerequisites

- Node.js 18+ and npm
- macOS (for LaunchAgent scheduler)
- Google OAuth credentials (Client ID and Secret)
- Chromium browser (installed via Playwright)

## Installation

1. Install dependencies:
```bash
npm install
cd frontend && npm install && cd ..
```

2. Build the project:
```bash
npm run build
```

3. Set up Google OAuth:
   - Create OAuth 2.0 credentials in Google Cloud Console
   - Add redirect URI: `http://localhost:3000/api/auth/callback`
   - Create `data/credentials.json`:
```json
{
  "client_id": "your_client_id",
  "client_secret": "your_client_secret",
  "redirect_uri": "http://localhost:3000/api/auth/callback"
}
```

   Or set environment variables:
```bash
export GOOGLE_CLIENT_ID=your_client_id
export GOOGLE_CLIENT_SECRET=your_client_secret
export GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/callback
```

## Usage

### Development Mode

1. Start the backend:
```bash
npm run dev
```

2. In another terminal, start the frontend:
```bash
npm run frontend:dev
```

3. Open http://localhost:5173 in your browser

### Production Mode

1. Build everything:
```bash
npm run build
npm run frontend:build
```

2. Start the server:
```bash
npm start
```

3. Open http://localhost:3000 in your browser

### Initial Setup

1. **Login to Google Maps**:
   - Click "Open Login" in the UI
   - Complete login in the browser window that opens
   - Session is saved for future use

2. **Authenticate with Google Sheets/Drive**:
   - Click "Authenticate with Google"
   - Complete OAuth flow in the browser
   - Token is saved for API access

3. **Add a Business**:
   - Enter a Google Maps business URL
   - Click "Add Business"
   - First snapshot is automatically created

### Daily Checks (CLI)

Run daily checks manually:
```bash
npm run cli run-daily-check
```

### macOS LaunchAgent Setup

Create a LaunchAgent to run daily checks automatically:

1. Create `~/Library/LaunchAgents/com.google-business-tracker.plist`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.google-business-tracker</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>/path/to/google-business-tracker/dist/cli.js</string>
        <string>run-daily-check</string>
    </array>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>
        <integer>9</integer>
        <key>Minute</key>
        <integer>0</integer>
    </dict>
    <key>StandardOutPath</key>
    <string>/path/to/google-business-tracker/data/launchd.log</string>
    <key>StandardErrorPath</key>
    <string>/path/to/google-business-tracker/data/launchd.error.log</string>
</dict>
</plist>
```

2. Load the LaunchAgent:
```bash
launchctl load ~/Library/LaunchAgents/com.google-business-tracker.plist
```

## API Endpoints

### Session
- `GET /api/session/status` - Check if logged into Google Maps
- `POST /api/session/open-login` - Open login page

### Authentication
- `GET /api/auth/status` - Check OAuth authentication status
- `GET /api/auth/url` - Get OAuth authorization URL
- `GET /api/auth/callback` - OAuth callback handler

### Businesses
- `GET /api/businesses` - List all businesses
- `GET /api/businesses/:id` - Get business details
- `POST /api/businesses` - Add a new business
- `POST /api/businesses/:id/check` - Run a check for a business

## Data Storage

- **Database**: SQLite at `data/tracker.db`
- **Screenshots**: Temporarily stored, then uploaded to Google Drive
- **Tokens**: OAuth token at `data/token.json`
- **Playwright Profile**: Browser session at `data/playwright-profile/`
- **Lock File**: `data/run.lock` for concurrency control

## Sheet Format

Each business has a Google Sheet with the following columns:
- Date (Europe/Dublin timezone)
- CheckedAt (ISO timestamp UTC)
- Link
- Name
- Address
- Webpage
- Phone
- OpenClosedStatus (OPEN, TEMPORARILY_CLOSED, PERMANENTLY_CLOSED, UNKNOWN)
- ReviewCount
- StarRating
- Activity (change descriptions)
- ErrorCode
- ScreenshotLink

## Error Codes

- `INVALID_URL` - Invalid Google Maps URL
- `NOT_LOGGED_IN` - Not logged into Google Maps
- `PAGE_LOAD_FAILED` - Failed to load page
- `EXTRACTION_FAILED` - Failed to extract business data
- `CONSENT_REQUIRED` - Cookie/consent screen detected
- `BOT_DETECTED` - Captcha or bot detection
- `SHEETS_AUTH_REQUIRED` - OAuth authentication required
- `SHEETS_WRITE_FAILED` - Failed to write to Sheets
- `DRIVE_AUTH_REQUIRED` - OAuth authentication required
- `DRIVE_WRITE_FAILED` - Failed to write to Drive
- `RUN_IN_PROGRESS` - Another run is in progress

## License

ISC

