# Push to GitHub

## Steps

1. **Create a new repository on GitHub:**
   - Go to https://github.com/new
   - Choose a repository name (e.g., `google-business-tracker`)
   - Don't initialize with README, .gitignore, or license
   - Click "Create repository"

2. **Add the remote and push:**
   ```bash
   git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
   git branch -M main
   git push -u origin main
   ```

   Or if you prefer SSH:
   ```bash
   git remote add origin git@github.com:YOUR_USERNAME/YOUR_REPO_NAME.git
   git branch -M main
   git push -u origin main
   ```

Replace `YOUR_USERNAME` and `YOUR_REPO_NAME` with your actual GitHub username and repository name.

