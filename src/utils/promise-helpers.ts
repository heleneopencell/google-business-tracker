import { Locator } from 'playwright';
import { logger } from './logger';

export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage: string
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
    )
  ]);
}

export async function safeLocatorCheck(
  locator: Locator,
  timeout: number = 300
): Promise<boolean> {
  try {
    return await Promise.race([
      locator.isVisible(),
      new Promise<boolean>(resolve => setTimeout(() => resolve(false), timeout))
    ]);
  } catch (e) {
    return false;
  }
}

export async function safePageOperation<T>(
  operation: () => Promise<T>,
  defaultValue: T,
  context: string
): Promise<T> {
  try {
    return await operation();
  } catch (e) {
    logger.debug(`[${context}] Operation failed, using default:`, e);
    return defaultValue;
  }
}

