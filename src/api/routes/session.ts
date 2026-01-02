import { Router } from 'express';
import { PlaywrightService } from '../../services/playwright';

export function createSessionRouter(playwright: PlaywrightService): Router {
  const router = Router();

  router.get('/status', async (req, res) => {
    try {
      const loggedIn = await playwright.checkLoggedIn();
      res.json({ loggedIn });
    } catch (e) {
      res.status(500).json({ error: 'PAGE_LOAD_FAILED' });
    }
  });

  router.post('/open-login', async (req, res) => {
    try {
      await playwright.openLoginPage();
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: 'Failed to open login page' });
    }
  });

  return router;
}

