import { logger } from './logger';

export class AppError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500
  ) {
    super(message);
    this.name = 'AppError';
    Error.captureStackTrace(this, this.constructor);
  }
}

export function handleError(error: unknown, context: string): AppError {
  if (error instanceof AppError) {
    logger.error(`[${context}] ${error.code}: ${error.message}`);
    return error;
  }
  
  const message = error instanceof Error ? error.message : 'Unknown error';
  const appError = new AppError(message, 'UNKNOWN_ERROR');
  logger.error(`[${context}] Unexpected error:`, error);
  return appError;
}

export function safeAsync<T>(
  fn: () => Promise<T>,
  defaultValue: T,
  context: string
): Promise<T> {
  return fn().catch((error) => {
    logger.error(`[${context}] Error in safeAsync:`, error);
    return defaultValue;
  });
}

