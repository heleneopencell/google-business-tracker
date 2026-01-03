import { Router } from 'express';
import { SessionService } from '../../services/session';

export function createSessionRouter(sessionService: SessionService): Router {
  const router = Router();

  router.get('/status', async (req, res) => {
    try {
      const loggedIn = await sessionService.checkLoggedIn();
      res.json({ loggedIn });
    } catch (e) {
      res.status(500).json({ error: 'PAGE_LOAD_FAILED' });
    }
  });

  router.post('/open-login', async (req, res) => {
    try {
      await sessionService.openLoginPage();
      res.json({ success: true });
    } catch (e: any) {
      console.error('Error opening login page:', e);
      console.error('Error stack:', e?.stack);
      const errorMessage = e?.message || 'Unknown error';
      res.status(500).json({ 
        error: 'Failed to open login page',
        details: errorMessage
      });
    }
  });

  return router;
}

