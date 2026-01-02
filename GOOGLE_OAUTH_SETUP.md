# Google OAuth Setup Guide

## Step 1: Create OAuth 2.0 Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the required APIs:
   - Go to "APIs & Services" > "Library"
   - Search for and enable:
     - **Google Sheets API**
     - **Google Drive API**

4. Create OAuth 2.0 credentials:
   - Go to "APIs & Services" > "Credentials"
   - Click "Create Credentials" > "OAuth client ID"
   - If prompted, configure the OAuth consent screen first:
     - Choose "External" (unless you have a Google Workspace)
     - Fill in required fields (App name, User support email, Developer contact)
     - Add scopes:
       - `https://www.googleapis.com/auth/spreadsheets`
       - `https://www.googleapis.com/auth/drive.file`
     - Add test users (your email) if in testing mode
   - Application type: **Desktop app**
   - Name: "Google Business Tracker"
   - Click "Create"
   - Copy the **Client ID** and **Client Secret**

## Step 2: Configure the Application

### Option A: Using credentials.json file (Recommended)

Create `data/credentials.json`:

```json
{
  "client_id": "YOUR_CLIENT_ID_HERE",
  "client_secret": "YOUR_CLIENT_SECRET_HERE",
  "redirect_uri": "http://localhost:3000/api/auth/callback"
}
```

**Important:** Make sure the `data/` directory exists and the file is not committed to git (it's in `.gitignore`).

### Option B: Using Environment Variables

Set these environment variables:

```bash
export GOOGLE_CLIENT_ID=your_client_id_here
export GOOGLE_CLIENT_SECRET=your_client_secret_here
export GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/callback
```

## Step 3: Authenticate

1. Start the application:
   ```bash
   npm start
   ```

2. Open the frontend (http://localhost:3000 or http://localhost:5173 in dev mode)

3. Click "Authenticate with Google" button

4. Complete the OAuth flow:
   - You'll be redirected to Google's consent screen
   - Grant permissions for Sheets and Drive
   - You'll be redirected back to the app
   - The token will be saved to `data/token.json`

## Step 4: Verify Authentication

- The UI should show "Google Sheets: Authenticated"
- You can now add businesses and they will be tracked in Google Sheets

## Troubleshooting

### "SHEETS_AUTH_REQUIRED" error
- Make sure you've completed the OAuth flow
- Check that `data/token.json` exists
- Try re-authenticating

### "Invalid redirect URI" error
- Make sure the redirect URI in your OAuth credentials matches exactly:
  - `http://localhost:3000/api/auth/callback`
- If running on a different port, update both the OAuth credentials and the application

### Token expired
- The application will attempt to refresh tokens automatically
- If refresh fails, you'll need to re-authenticate

### OAuth consent screen issues
- If in testing mode, make sure your email is added as a test user
- For production, you may need to publish the app (requires verification for sensitive scopes)

## Notes

- The token is stored locally in `data/token.json`
- The same token is used for both Sheets and Drive APIs
- Tokens are automatically refreshed when needed
- Never commit `data/token.json` or `data/credentials.json` to git

