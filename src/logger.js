/**
 * Phoenix Echo Structured Logger
 *
 * Features:
 * - JSON-formatted logs
 * - Multiple log levels (DEBUG, INFO, WARN, ERROR, CRITICAL)
 * - Dual output: stdout + optional file
 * - Daily log rotation
 * - Correlation IDs
 */

import { appendFile, mkdir, readdir, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname, join } from 'path';

const LEVELS = {
  DEBUG: 10,
  INFO: 20,
  WARN: 30,
  ERROR: 40,
  CRITICAL: 50
};

class Logger {
  constructor(options = {}) {
    this.level = LEVELS[options.level?.toUpperCase()] || LEVELS.INFO;
    this.logFile = options.file || '';
    this.component = options.component || 'gateway';
    this.rotationRetentionDays = options.rotationRetentionDays || 7;
    this.lastRotationDate = this.getCurrentDate();
  }

  getCurrentDate() {
    return new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  }

  getLogFilePath() {
    if (!this.logFile) return null;
    
    const date = this.getCurrentDate();
    const dir = dirname(this.logFile);
    const base = this.logFile.replace(/\.log$/, '');
    return `${base}-${date}.log`;
  }

  async ensureLogDir() {
    if (!this.logFile) return;
    
    const dir = dirname(this.logFile);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
  }

  async rotateIfNeeded() {
    const currentDate = this.getCurrentDate();
    if (currentDate !== this.lastRotationDate) {
      this.lastRotationDate = currentDate;
      await this.cleanOldLogs();
    }
  }

  async cleanOldLogs() {
    if (!this.logFile) return;

    try {
      const dir = dirname(this.logFile);
      const files = await readdir(dir);
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.rotationRetentionDays);

      for (const file of files) {
        const match = file.match(/(\d{4}-\d{2}-\d{2})\.log$/);
        if (match) {
          const fileDate = new Date(match[1]);
          if (fileDate < cutoffDate) {
            await unlink(join(dir, file));
          }
        }
      }
    } catch (error) {
      // Best effort - don't crash on cleanup failure
      console.error('[Logger] Failed to clean old logs:', error.message);
    }
  }

  async writeToFile(line) {
    if (!this.logFile) return;

    try {
      await this.ensureLogDir();
      await this.rotateIfNeeded();
      const path = this.getLogFilePath();
      await appendFile(path, line + '\n', 'utf-8');
    } catch (error) {
      // Fallback to console if file write fails
      console.error('[Logger] Failed to write to file:', error.message);
    }
  }

  format(level, message, context = {}) {
    const payload = {
      timestamp: new Date().toISOString(),
      level,
      component: this.component,
      message,
      ...context
    };
    return JSON.stringify(payload);
  }

  log(level, levelName, message, context = {}) {
    if (level < this.level) return;

    const line = this.format(levelName, message, context);

    // Always write to stdout/stderr
    if (level >= LEVELS.ERROR) {
      console.error(line);
    } else {
      console.log(line);
    }

    // Write to file (async, don't block)
    void this.writeToFile(line);
  }

  debug(message, context = {}) {
    this.log(LEVELS.DEBUG, 'DEBUG', message, context);
  }

  info(message, context = {}) {
    this.log(LEVELS.INFO, 'INFO', message, context);
  }

  warn(message, context = {}) {
    this.log(LEVELS.WARN, 'WARN', message, context);
  }

  error(message, context = {}) {
    this.log(LEVELS.ERROR, 'ERROR', message, context);
  }

  critical(message, context = {}) {
    this.log(LEVELS.CRITICAL, 'CRITICAL', message, context);
  }

  // Create a child logger with additional context
  child(additionalContext = {}) {
    const childLogger = new Logger({
      level: Object.keys(LEVELS).find(k => LEVELS[k] === this.level)?.toLowerCase(),
      file: this.logFile,
      component: additionalContext.component || this.component,
      rotationRetentionDays: this.rotationRetentionDays
    });

    // Wrap methods to inject context
    const originalMethods = ['debug', 'info', 'warn', 'error', 'critical'];
    originalMethods.forEach(method => {
      const original = childLogger[method].bind(childLogger);
      childLogger[method] = (message, context = {}) => {
        original(message, { ...additionalContext, ...context });
      };
    });

    return childLogger;
  }
}

// Singleton instance
let defaultLogger = null;

export function createLogger(options = {}) {
  return new Logger(options);
}

export function getDefaultLogger() {
  if (!defaultLogger) {
    defaultLogger = new Logger({
      level: process.env.PHOENIX_LOG_LEVEL || 'info',
      file: process.env.PHOENIX_LOG_FILE || '/tmp/phoenix-echo/phoenix-echo.log',
      component: 'gateway'
    });
  }
  return defaultLogger;
}

export function configureDefaultLogger(options = {}) {
  const levelName = options.level ? String(options.level).toUpperCase() : null;
  const resolvedLevel = levelName ? LEVELS[levelName] : null;

  if (!defaultLogger) {
    defaultLogger = new Logger({
      level: options.level || process.env.PHOENIX_LOG_LEVEL || 'info',
      file: options.file || process.env.PHOENIX_LOG_FILE || '/tmp/phoenix-echo/phoenix-echo.log',
      component: options.component || 'gateway',
      rotationRetentionDays: options.rotationRetentionDays || 7
    });
    return defaultLogger;
  }

  if (resolvedLevel) {
    defaultLogger.level = resolvedLevel;
  }
  if (Object.prototype.hasOwnProperty.call(options, 'file')) {
    defaultLogger.logFile = options.file || '';
  }
  if (options.component) {
    defaultLogger.component = options.component;
  }
  if (options.rotationRetentionDays) {
    defaultLogger.rotationRetentionDays = Number(options.rotationRetentionDays) || defaultLogger.rotationRetentionDays;
  }

  return defaultLogger;
}

export function setDefaultLogger(logger) {
  defaultLogger = logger;
}

export default {
  createLogger,
  getDefaultLogger,
  configureDefaultLogger,
  setDefaultLogger,
  LEVELS
};
