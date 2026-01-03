import express from 'express';
import cors from 'cors';
import path from 'path';
import { initDatabase } from './db/schema';
import { PlaywrightService } from './services/playwright';
import { SessionService } from './services/session';
import { GoogleAuthService } from './services/google-auth';
import { GoogleSheetsService } from './services/google-sheets';
import { GoogleDriveService } from './services/google-drive';
import { BusinessService } from './services/business-service';
import { createSessionRouter } from './api/routes/session';
import { createBusinessesRouter } from './api/routes/businesses';
import { createAuthRouter } from './api/routes/auth';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize services
const db = initDatabase();
const playwright = new PlaywrightService();
const sessionService = new SessionService();
const authService = new GoogleAuthService();
const sheetsService = new GoogleSheetsService(authService);
const driveService = new GoogleDriveService(authService);
const businessService = new BusinessService(
  db,
  playwright,
  sheetsService,
  driveService,
  authService,
  sessionService
);

// Routes
app.use('/api/session', createSessionRouter(sessionService));
app.use('/api/businesses', createBusinessesRouter(businessService));
app.use('/api/auth', createAuthRouter(authService));

// Serve frontend in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../frontend/dist')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/dist/index.html'));
  });
}

// Graceful shutdown
process.on('SIGINT', async () => {
  await playwright.close();
  await sessionService.close();
  db.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await playwright.close();
  await sessionService.close();
  db.close();
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

