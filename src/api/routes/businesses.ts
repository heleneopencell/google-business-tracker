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

        // Process all businesses in parallel for maximum speed
        // All businesses will be checked simultaneously
        const CONCURRENCY = allBusinesses.length;
        const results: Array<{ success: boolean; id: number; name: string | null; error?: string }> = [];
        
        // Process with concurrency limit - start next business as soon as one finishes
        const processBusiness = async (business: any): Promise<void> => {
          try {
            console.log(`[Check All] Checking business ${business.id} (${business.name || 'Unknown'})...`);
            await businessService.runCheck(business.id, force);
            console.log(`[Check All] Successfully checked business ${business.id}`);
            results.push({ success: true, id: business.id, name: business.name });
          } catch (e: any) {
            const errorMsg = e.message || 'Unknown error';
            console.error(`[Check All] Failed to check business ${business.id}: ${errorMsg}`);
            results.push({ success: false, id: business.id, name: business.name, error: errorMsg });
          }
        };

        // Process all businesses with concurrency limit
        const workers: Promise<void>[] = [];
        let index = 0;

        const runWorker = async (): Promise<void> => {
          while (index < allBusinesses.length) {
            const businessIndex = index++;
            if (businessIndex < allBusinesses.length) {
              await processBusiness(allBusinesses[businessIndex]);
            }
          }
        };

        // Start workers (up to CONCURRENCY limit)
        for (let i = 0; i < Math.min(CONCURRENCY, allBusinesses.length); i++) {
          workers.push(runWorker());
        }

        // Wait for all workers to complete
        await Promise.all(workers);

        // Process results
        for (const result of results) {
          if (result.success) {
            checked++;
          } else {
            failed++;
            errors.push({ 
              id: result.id, 
              name: result.name, 
              error: result.error || 'Unknown error' 
            });
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

