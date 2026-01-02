import { Router } from 'express';
import { BusinessService } from '../../services/business-service';
import { withLock } from '../../utils/lock';

export function createBusinessesRouter(businessService: BusinessService): Router {
  const router = Router();

  router.post('/', async (req, res) => {
    try {
      const { url } = req.body;
      if (!url) {
        return res.status(400).json({ error: 'INVALID_URL' });
      }

      const result = await withLock(async () => {
        return await businessService.createBusiness(url);
      });

      res.json(result);
    } catch (e: any) {
      if (e.message === 'RUN_IN_PROGRESS') {
        return res.status(409).json({ error: 'RUN_IN_PROGRESS' });
      }
      res.status(400).json({ error: e.message || 'Unknown error' });
    }
  });

  router.get('/', async (req, res) => {
    try {
      const businesses = businessService.getAllBusinesses();
      res.json(businesses);
    } catch (e) {
      res.status(500).json({ error: 'Failed to get businesses' });
    }
  });

  router.get('/:id', async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const business = businessService.getBusiness(id);
      if (!business) {
        return res.status(404).json({ error: 'Business not found' });
      }
      res.json(business);
    } catch (e) {
      res.status(500).json({ error: 'Failed to get business' });
    }
  });

  router.post('/:id/check', async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      
      await withLock(async () => {
        await businessService.runCheck(id);
      });

      res.json({ success: true });
    } catch (e: any) {
      if (e.message === 'RUN_IN_PROGRESS') {
        return res.status(409).json({ error: 'RUN_IN_PROGRESS' });
      }
      res.status(400).json({ error: e.message || 'Unknown error' });
    }
  });

  return router;
}

