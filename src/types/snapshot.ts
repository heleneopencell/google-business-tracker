/**
 * Snapshot schema for business data
 */

export type OpenClosedStatus = 'OPEN' | 'TEMPORARILY_CLOSED' | 'PERMANENTLY_CLOSED' | 'UNKNOWN';

export type ErrorCode =
  | 'INVALID_URL'
  | 'NOT_LOGGED_IN'
  | 'PAGE_LOAD_FAILED'
  | 'EXTRACTION_FAILED'
  | 'CONSENT_REQUIRED'
  | 'BOT_DETECTED'
  | 'SHEETS_AUTH_REQUIRED'
  | 'SHEETS_WRITE_FAILED'
  | 'DRIVE_AUTH_REQUIRED'
  | 'DRIVE_WRITE_FAILED'
  | 'RUN_IN_PROGRESS';

export interface Snapshot {
  date: string; // YYYY-MM-DD (Europe/Dublin)
  checkedAt: string; // ISO-8601 UTC
  link: string | null;
  name: string | null;
  address: string | null;
  webpage: string | null;
  phone: string | null;
  openClosedStatus: OpenClosedStatus;
  reviewCount: number | null;
  starRating: number | null;
  activity: string;
  errorCode: string | null;
  screenshotLink: string | null;
}

export interface ExtractedData {
  link: string | null;
  name: string | null;
  address: string | null;
  webpage: string | null;
  phone: string | null;
  openClosedStatus: OpenClosedStatus;
  reviewCount: number | null;
  starRating: number | null;
  errorCode: ErrorCode | null;
}

