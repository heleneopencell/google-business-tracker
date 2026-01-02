# Setup Guide

## Quick Start

1. **Install dependencies:**
   ```bash
   npm run install:all
   ```

2. **Install Playwright browsers:**
   ```bash
   npx playwright install chromium
   ```

3. **Set up Google OAuth:**
   
   Option A: Create `data/credentials.json`:
   ```json
   {
     "client_id": "your_client_id",
     "client_secret": "your_client_secret",
     "redirect_uri": "http://localhost:3000/api/auth/callback"
   }
   ```
   
   Option B: Set environment variables:
   ```bash
   export GOOGLE_CLIENT_ID=your_client_id
   export GOOGLE_CLIENT_SECRET=your_client_secret
   export GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/callback
   ```

4. **Build the project:**
   ```bash
   npm run build
   ```

5. **Start the server:**
   ```bash
   npm start
   ```

6. **In another terminal, start the frontend (dev mode):**
   ```bash
   npm run frontend:dev
   ```

7. **Open http://localhost:5173**

## First Time Setup

1. **Login to Google Maps:**
   - Click "Open Login" button
   - Complete login in the browser window
   - Session is automatically saved

2. **Authenticate with Google:**
   - Click "Authenticate with Google" button
   - Complete OAuth flow
   - Token is automatically saved

3. **Add your first business:**
   - Enter a Google Maps URL (e.g., `https://www.google.com/maps/place/...`)
   - Click "Add Business"
   - First snapshot is created automatically

## Daily Checks

### Manual Run
```bash
npm run cli run-daily-check
```

### Automated (macOS LaunchAgent)

1. Edit `com.google-business-tracker.plist.example`:
   - Replace `ABSOLUTE_PATH_TO_PROJECT` with your project path
   - Adjust the time (Hour/Minute) if needed

2. Copy to LaunchAgents:
   ```bash
   cp com.google-business-tracker.plist.example ~/Library/LaunchAgents/com.google-business-tracker.plist
   ```

3. Load the agent:
   ```bash
   launchctl load ~/Library/LaunchAgents/com.google-business-tracker.plist
   ```

4. Check status:
   ```bash
   launchctl list | grep google-business-tracker
   ```

5. Unload (if needed):
   ```bash
   launchctl unload ~/Library/LaunchAgents/com.google-business-tracker.plist
   ```

## Troubleshooting

### "NOT_LOGGED_IN" error
- Use the "Open Login" button to log into Google Maps
- Make sure the browser window completes the login process

### "SHEETS_AUTH_REQUIRED" error
- Use the "Authenticate with Google" button
- Complete the OAuth flow
- Make sure you grant Sheets and Drive permissions

### "RUN_IN_PROGRESS" error
- Another process is currently running
- Wait for it to complete, or remove `data/run.lock` if stale

### Screenshot failures
- Screenshot failures don't block data collection
- Check that Drive authentication is working
- Check that the business folder exists in Drive

### Extraction failures
- Some businesses may have extraction failures due to page structure
- Data is still recorded with `EXTRACTION_FAILED` error code
- Check the Activity column in the Sheet

## Data Locations

- Database: `data/tracker.db`
- OAuth Token: `data/token.json`
- Playwright Profile: `data/playwright-profile/`
- Lock File: `data/run.lock`
- Screenshots: `data/screenshots/` (temporary, uploaded to Drive)

## Notes

- The system enforces one check per business per Dublin day
- Screenshots are uploaded to Google Drive and linked in Sheets
- All timestamps use UTC, dates use Europe/Dublin timezone
- The lock file prevents concurrent runs
- Stale locks (>1 hour) can be overridden

