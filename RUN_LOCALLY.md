# Step-by-Step: Running the App Locally

## Step 1: Set Up Google OAuth Credentials

### 1.1 Go to Google Cloud Console
1. Open https://console.cloud.google.com/
2. Sign in with your Google account
3. Create a new project (or select existing):
   - Click the project dropdown at the top
   - Click "New Project"
   - Name it "Google Business Tracker"
   - Click "Create"

### 1.2 Enable Required APIs
1. In the left menu, go to **"APIs & Services"** > **"Library"**
2. Search for **"Google Sheets API"** and click it
   - Click **"Enable"**
3. Search for **"Google Drive API"** and click it
   - Click **"Enable"**

### 1.3 Configure OAuth Consent Screen
1. Go to **"APIs & Services"** > **"OAuth consent screen"**
2. Choose **"External"** (unless you have Google Workspace)
3. Click **"Create"**
4. Fill in the form:
   - **App name**: Google Business Tracker
   - **User support email**: Your email
   - **Developer contact information**: Your email
   - Click **"Save and Continue"**
5. **Scopes** (Step 2):
   - Click **"Add or Remove Scopes"**
   - Add these scopes:
     - `https://www.googleapis.com/auth/spreadsheets`
     - `https://www.googleapis.com/auth/drive.file`
   - Click **"Update"** then **"Save and Continue"**
6. **Test users** (Step 3):
   - Click **"Add Users"**
   - Add your email address
   - Click **"Save and Continue"**
7. Click **"Back to Dashboard"**

### 1.4 Create OAuth Credentials
1. Go to **"APIs & Services"** > **"Credentials"**
2. Click **"Create Credentials"** > **"OAuth client ID"**
3. If prompted, choose **"Desktop app"** as application type
4. Name it: **"Google Business Tracker"**
5. Click **"Create"**
6. **IMPORTANT**: Copy both:
   - **Client ID** (looks like: `123456789-abcdefg.apps.googleusercontent.com`)
   - **Client Secret** (looks like: `GOCSPX-xxxxxxxxxxxxx`)

### 1.5 Create credentials.json File
Create the file `data/credentials.json` with this content:

```json
{
  "client_id": "PASTE_YOUR_CLIENT_ID_HERE",
  "client_secret": "PASTE_YOUR_CLIENT_SECRET_HERE",
  "redirect_uri": "http://localhost:3000/api/auth/callback"
}
```

Replace `PASTE_YOUR_CLIENT_ID_HERE` and `PASTE_YOUR_CLIENT_SECRET_HERE` with the values you copied.

## Step 2: Start the Backend Server

Open Terminal and run:

```bash
cd "/Users/helenesteiner/google business tracker"
npm run dev
```

You should see:
```
Server running on port 3000
```

**Keep this terminal open!** The server needs to keep running.

## Step 3: Start the Frontend (New Terminal)

Open a **NEW Terminal window** and run:

```bash
cd "/Users/helenesteiner/google business tracker"
npm run frontend:dev
```

You should see:
```
VITE v5.x.x  ready in xxx ms
➜  Local:   http://localhost:5173/
```

## Step 4: Open the Application

1. Open your web browser
2. Go to: **http://localhost:5173**
3. You should see the Google Business Tracker interface

## Step 5: Login to Google Maps

1. In the browser, click the **"Open Login"** button
2. A new browser window will open
3. Log into your Google account in that window
4. Complete any security checks
5. Once logged in, close that window (or keep it open)
6. Go back to the main app window
7. The status should now show: **"Google Maps: Logged In"** ✅

## Step 6: Authenticate with Google Sheets/Drive

1. Click the **"Authenticate with Google"** button
2. A new browser window/tab will open
3. You'll see Google's consent screen
4. Click **"Continue"** to grant permissions
5. You may see a warning about the app not being verified - click **"Advanced"** > **"Go to Google Business Tracker (unsafe)"**
6. After granting permissions, you'll see "Authentication successful!"
7. Close that window
8. Go back to the main app
9. The status should now show: **"Google Sheets: Authenticated"** ✅

## Step 7: Add Your First Business

1. In the "Google Maps Business URL" field, paste a Google Maps business URL
   - Example: `https://www.google.com/maps/place/Some+Business+Name`
   - Or any Google Maps business listing URL
2. Click **"Add Business"**
3. The app will:
   - Extract business data
   - Create a Google Sheet
   - Create a Google Drive folder
   - Add the first snapshot
4. You should see a success message
5. The business will appear in the list below

## Step 8: View Your Data

1. Click **"View Sheet"** next to any business
2. This opens the Google Sheet with all snapshots
3. You can also find the folder in Google Drive

## Troubleshooting

### "NOT_LOGGED_IN" error
- Make sure you completed Step 5 (Login to Google Maps)
- Try clicking "Open Login" again

### "SHEETS_AUTH_REQUIRED" error
- Make sure you completed Step 6 (Authenticate with Google)
- Try clicking "Authenticate with Google" again

### Port already in use
- If port 3000 is busy, stop other applications using it
- Or change PORT in your environment: `PORT=3001 npm run dev`

### Can't find credentials.json
- Make sure the file is at: `data/credentials.json`
- Check the file has valid JSON format
- Make sure you replaced the placeholder values

### OAuth redirect error
- Make sure the redirect URI in `credentials.json` matches exactly:
  - `http://localhost:3000/api/auth/callback`
- Make sure the same URI is in your Google Cloud Console OAuth credentials

## Quick Commands Reference

```bash
# Start backend (Terminal 1)
npm run dev

# Start frontend (Terminal 2)
npm run frontend:dev

# Build for production
npm run build
npm start

# Run daily check manually
npm run cli run-daily-check
```

## You're All Set! 🎉

Your app is now running and ready to track businesses!

