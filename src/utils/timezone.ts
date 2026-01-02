/**
 * Timezone utilities for Europe/Dublin
 */

export function getDublinDate(date: Date = new Date()): string {
  // Format: YYYY-MM-DD in Europe/Dublin timezone
  const dublinDate = new Date(date.toLocaleString('en-US', { timeZone: 'Europe/Dublin' }));
  const year = dublinDate.getFullYear();
  const month = String(dublinDate.getMonth() + 1).padStart(2, '0');
  const day = String(dublinDate.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getDublinDateTime(date: Date = new Date()): Date {
  // Convert to Dublin timezone
  const dublinString = date.toLocaleString('en-US', { timeZone: 'Europe/Dublin' });
  return new Date(dublinString);
}

export function isSameDublinDay(date1: Date, date2: Date): boolean {
  return getDublinDate(date1) === getDublinDate(date2);
}

