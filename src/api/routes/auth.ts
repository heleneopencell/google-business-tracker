import { Router } from 'express';
import { GoogleAuthService } from '../../services/google-auth';

export function createAuthRouter(authService: GoogleAuthService): Router {
  const router = Router();

  router.get('/status', async (req, res) => {
    try {
      const authenticated = await authService.isAuthenticated();
      res.json({ authenticated });
    } catch (e) {
      res.json({ authenticated: false });
    }
  });

  router.get('/url', (req, res) => {
    try {
      const url = authService.getAuthUrl();
      res.json({ url });
    } catch (e) {
      res.status(500).json({ error: 'OAuth not configured' });
    }
  });

  router.get('/callback', async (req, res) => {
    try {
      const { code } = req.query;
      if (!code || typeof code !== 'string') {
        return res.status(400).send('Missing authorization code');
      }

      await authService.getToken(code);
      res.send('<html><body><h1>Authentication successful!</h1><p>You can close this window.</p></body></html>');
    } catch (e) {
      res.status(500).send('<html><body><h1>Authentication failed</h1></body></html>');
    }
  });

  return router;
}

