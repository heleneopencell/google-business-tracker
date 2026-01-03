export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3
}

class Logger {
  private level: LogLevel = process.env.NODE_ENV === 'production' 
    ? LogLevel.INFO 
    : LogLevel.DEBUG;

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  debug(message: string, ...args: any[]): void {
    if (this.level <= LogLevel.DEBUG) {
      console.log(`[DEBUG] ${message}`, ...args);
    }
  }

  info(message: string, ...args: any[]): void {
    if (this.level <= LogLevel.INFO) {
      console.log(`[INFO] ${message}`, ...args);
    }
  }

  warn(message: string, ...args: any[]): void {
    if (this.level <= LogLevel.WARN) {
      console.warn(`[WARN] ${message}`, ...args);
    }
  }

  error(message: string, ...args: any[]): void {
    console.error(`[ERROR] ${message}`, ...args);
  }

  performance(operation: string, duration: number, threshold: number = 1000): void {
    if (duration > threshold) {
      this.warn(`${operation} took ${duration}ms - this is slow!`);
    } else {
      this.debug(`${operation} took ${duration}ms`);
    }
  }

  performanceWarning(operation: string, duration: number, threshold: number = 1000): void {
    if (duration > threshold) {
      this.warn(`[Performance] WARNING: ${operation} took ${duration}ms - this is very slow!`);
    }
  }
}

export const logger = new Logger();

