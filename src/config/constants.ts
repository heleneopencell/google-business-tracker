import path from 'path';

export const CONFIG = {
  TIMEOUTS: {
    PAGE_LOAD: 30000,
    SELECTOR_WAIT: 10000,
    EXTRACTION_FUNCTION: 10000,
    LOGIN_CHECK: 5000,
    LOGIN_MAX_WAIT: 600000, // 10 minutes
    VISIBILITY_CHECK: 300,
    TEXT_CONTENT: 1000,
    WEBPAGE_EXTRACTION: 500,
    OPEN_HOURS_CHECK: 300,
  },
  PERFORMANCE: {
    SLOW_THRESHOLD: 1000,
    VERY_SLOW_THRESHOLD: 5000,
    PARALLEL_EXTRACTION_SLOW: 10000,
    PAGE_GOTO_SLOW: 5000,
    WAIT_SELECTOR_SLOW: 5000,
  },
  STORAGE: {
    PROFILE_PATH: path.join(process.cwd(), 'data', 'playwright-profile'),
    STORAGE_FILE: 'storage.json',
    STORAGE_RELOAD_AGE: 5000, // 5 seconds
  },
  BROWSER: {
    VIEWPORT: { width: 1280, height: 800 },
    LOCALE: 'en-US',
    USER_AGENT: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  },
  EXTRACTION: {
    MAX_ELEMENTS_TO_ITERATE: 50,
    REVIEW_CHECK_INTERVAL: 5000, // 5 seconds
  }
} as const;

