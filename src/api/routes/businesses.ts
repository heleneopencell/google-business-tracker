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
      const businesses = await businessService.getAllBusinesses();
      res.json(businesses);
    } catch (e) {
      res.status(500).json({ error: 'Failed to get businesses' });
    }
  });

  router.get('/:id', async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const business = await businessService.getBusiness(id);
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
      // Always force manual checks from the UI - allow multiple checks per day
      const force = true;
      
      await withLock(async () => {
        await businessService.runCheck(id, force);
      });

      res.json({ success: true });
    } catch (e: any) {
      const id = parseInt(req.params.id);
      console.error(`Error running check for business ${id}:`, e);
      if (e.message === 'RUN_IN_PROGRESS') {
        return res.status(409).json({ error: 'RUN_IN_PROGRESS' });
      }
      res.status(400).json({ error: e.message || 'Unknown error' });
    }
  });

  router.delete('/:id', async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      
      await businessService.deleteBusiness(id);
      
      res.json({ success: true });
    } catch (e: any) {
      res.status(400).json({ error: e.message || 'Failed to delete business' });
    }
  });

  router.post('/check-all', async (req, res) => {
    try {
      // Always force manual checks from the UI - allow multiple checks per day
      const force = true;
      
      await withLock(async () => {
        // Get all businesses
        const allBusinesses = await businessService.getAllBusinesses();
        
        if (allBusinesses.length === 0) {
          return res.json({ success: true, checked: 0, failed: 0, message: 'No businesses to check' });
        }

        let checked = 0;
        let failed = 0;
        const errors: Array<{ id: number; name: string | null; error: string }> = [];

        console.log(`[Check All] Starting checks for ${allBusinesses.length} businesses...`);

        for (const business of allBusinesses) {
          try {
            console.log(`[Check All] Checking business ${business.id} (${business.name || 'Unknown'})...`);
            await businessService.runCheck(business.id, force);
            checked++;
            console.log(`[Check All] Successfully checked business ${business.id}`);
          } catch (e: any) {
            failed++;
            const errorMsg = e.message || 'Unknown error';
            errors.push({ id: business.id, name: business.name, error: errorMsg });
            console.error(`[Check All] Failed to check business ${business.id}: ${errorMsg}`);
            // Continue with other businesses even if one fails
          }
        }

        console.log(`[Check All] Completed: ${checked} successful, ${failed} failed`);

        res.json({
          success: true,
          checked,
          failed,
          total: allBusinesses.length,
          errors: errors.length > 0 ? errors : undefined
        });
      });
    } catch (e: any) {
      console.error(`[Check All] Error:`, e);
      if (e.message === 'RUN_IN_PROGRESS') {
        return res.status(409).json({ error: 'RUN_IN_PROGRESS' });
      }
      res.status(400).json({ error: e.message || 'Unknown error' });
    }
  });

  return router;
}

