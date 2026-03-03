/**
 * Phoenix Echo Gateway - Cron Scheduler
 * 
 * Simple, production-grade cron system for scheduled tasks.
 * Supports cron expressions, interval-based scheduling, and one-shot timers.
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { scheduleJob } = require('node-schedule');
import { randomUUID } from 'crypto';
import { getDefaultLogger } from './logger.js';

const logger = getDefaultLogger();

function buildCronRule(expression, timezone) {
  const tz = String(timezone || '').trim();
  if (!tz) {
    return expression;
  }
  return { rule: expression, tz };
}

export class CronScheduler {
  constructor(config = {}) {
    this.jobs = new Map();
    this.config = config;
    this.handlers = new Map();
    
    logger.info('CronScheduler initialized', {
      timezone: config.timezone || 'America/Denver'
    });
  }

  /**
   * Register a job handler
   * @param {string} type - Job type (e.g., 'systemEvent', 'agentTurn')
   * @param {Function} handler - Handler function(job, payload)
   */
  registerHandler(type, handler) {
    this.handlers.set(type, handler);
    logger.info('Registered cron handler', { type });
  }

  /**
   * Schedule a new job
   * @param {Object} jobConfig - Job configuration
   * @returns {string} Job ID
   */
  scheduleJob(jobConfig) {
    const jobId = jobConfig.id || randomUUID();
    const {
      name,
      schedule,
      type,
      payload,
      enabled = true,
      timezone = 'America/Denver'
    } = jobConfig;

    if (!enabled) {
      logger.info('Job disabled, not scheduling', { jobId, name });
      this.jobs.set(jobId, { ...jobConfig, id: jobId, scheduled: null });
      return jobId;
    }

    // Parse schedule
    let scheduledJob = null;
    let intervalHandle = null;
    let intervalMs = null;
    let nextRun = null;
    if (typeof schedule === 'string') {
      // Cron expression (e.g., "0 1 * * *" for 1 AM daily)
      scheduledJob = scheduleJob(buildCronRule(schedule, timezone), async () => {
        await this.executeJob(jobId);
      });
      if (!scheduledJob) {
        throw new Error(`Failed to schedule job ${jobId}`);
      }
      nextRun = scheduledJob.nextInvocation()?.toISOString() || null;
    } else if (schedule && Number.isFinite(Number(schedule.everyMs)) && Number(schedule.everyMs) > 0) {
      // True interval-based scheduling
      intervalMs = Math.max(1000, Math.floor(Number(schedule.everyMs)));
      intervalHandle = setInterval(() => {
        void this.executeJob(jobId);
      }, intervalMs);
      if (typeof intervalHandle.unref === 'function') {
        intervalHandle.unref();
      }
      nextRun = new Date(Date.now() + intervalMs).toISOString();
    } else if (schedule && schedule.at) {
      // One-shot at specific time
      const oneShotAt = new Date(schedule.at);
      if (Number.isNaN(oneShotAt.getTime())) {
        throw new Error(`Invalid one-shot schedule date for job ${jobId}: ${schedule.at}`);
      }
      scheduledJob = scheduleJob(oneShotAt, async () => {
        await this.executeJob(jobId);
      });
      if (!scheduledJob) {
        throw new Error(`Failed to schedule job ${jobId}`);
      }
      nextRun = scheduledJob.nextInvocation()?.toISOString() || null;
    } else {
      throw new Error(`Invalid schedule format for job ${jobId}`);
    }

    // Store job metadata
    const job = {
      id: jobId,
      name,
      schedule,
      type,
      payload,
      enabled,
      timezone,
      scheduled: scheduledJob,
      intervalHandle,
      intervalMs,
      createdAt: new Date().toISOString(),
      lastRun: null,
      nextRun,
      runCount: 0,
      lastStatus: null,
      inFlight: false,
      skippedCount: 0
    };

    this.jobs.set(jobId, job);

    logger.info('Job scheduled', {
      jobId,
      name,
      type,
      nextRun: job.nextRun
    });

    return jobId;
  }

  /**
   * Execute a job
   * @param {string} jobId - Job ID
   */
  async executeJob(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) {
      logger.error('Job not found', { jobId });
      return;
    }

    if (job.inFlight) {
      job.skippedCount = (job.skippedCount || 0) + 1;
      logger.warn('Job execution skipped: previous run still active', {
        jobId,
        name: job.name,
        type: job.type,
        skippedCount: job.skippedCount
      });
      return;
    }

    job.inFlight = true;

    logger.info('Executing job', {
      jobId,
      name: job.name,
      type: job.type
    });

    const startTime = Date.now();

    try {
      // Get handler for job type
      const handler = this.handlers.get(job.type);
      if (!handler) {
        throw new Error(`No handler registered for job type: ${job.type}`);
      }

      // Execute handler
      await handler(job, job.payload);

      // Update job metadata
      const duration = Date.now() - startTime;
      job.lastRun = new Date().toISOString();
      job.lastStatus = 'success';
      job.lastError = null;
      job.runCount += 1;
      if (job.intervalMs) {
        job.nextRun = new Date(Date.now() + job.intervalMs).toISOString();
      } else if (job.scheduled) {
        job.nextRun = job.scheduled.nextInvocation()?.toISOString() || null;
      }

      logger.info('Job completed successfully', {
        jobId,
        name: job.name,
        duration,
        runCount: job.runCount
      });

    } catch (error) {
      const duration = Date.now() - startTime;
      job.lastRun = new Date().toISOString();
      job.lastStatus = 'error';
      job.lastError = error.message;

      logger.error('Job execution failed', {
        jobId,
        name: job.name,
        error: error.message,
        duration
      });
    } finally {
      job.inFlight = false;
    }
  }

  /**
   * Cancel a job
   * @param {string} jobId - Job ID
   */
  cancelJob(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) {
      logger.warn('Job not found for cancellation', { jobId });
      return false;
    }

    if (job.scheduled) {
      job.scheduled.cancel();
    }
    if (job.intervalHandle) {
      clearInterval(job.intervalHandle);
    }

    this.jobs.delete(jobId);
    logger.info('Job cancelled', { jobId, name: job.name });
    return true;
  }

  /**
   * List all jobs
   * @returns {Array} Job list
   */
  listJobs() {
    return Array.from(this.jobs.values()).map(job => ({
      id: job.id,
      name: job.name,
      type: job.type,
      enabled: job.enabled,
      schedule: job.schedule,
      createdAt: job.createdAt,
      lastRun: job.lastRun,
      nextRun: job.nextRun,
      runCount: job.runCount,
      skippedCount: job.skippedCount || 0,
      inFlight: job.inFlight === true,
      timezone: job.timezone,
      lastStatus: job.lastStatus,
      lastError: job.lastError
    }));
  }

  /**
   * Get job details
   * @param {string} jobId - Job ID
   * @returns {Object|null} Job details
   */
  getJob(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) return null;

    return {
      id: job.id,
      name: job.name,
      type: job.type,
      payload: job.payload,
      enabled: job.enabled,
      schedule: job.schedule,
      timezone: job.timezone,
      createdAt: job.createdAt,
      lastRun: job.lastRun,
      nextRun: job.nextRun,
      runCount: job.runCount,
      skippedCount: job.skippedCount || 0,
      inFlight: job.inFlight === true,
      lastStatus: job.lastStatus,
      lastError: job.lastError
    };
  }

  /**
   * Update job configuration
   * @param {string} jobId - Job ID
   * @param {Object} updates - Configuration updates
   */
  updateJob(jobId, updates) {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }

    const nextConfig = {
      id: job.id,
      name: job.name,
      schedule: job.schedule,
      type: job.type,
      payload: job.payload,
      enabled: job.enabled,
      timezone: job.timezone,
      ...updates
    };

    this.cancelJob(jobId);
    this.scheduleJob(nextConfig);

    logger.info('Job updated', { jobId, updates: Object.keys(updates) });
  }

  /**
   * Shutdown scheduler gracefully
   */
  shutdown() {
    logger.info('Shutting down CronScheduler', {
      activeJobs: this.jobs.size
    });

    for (const [jobId, job] of this.jobs) {
      if (job.scheduled) {
        job.scheduled.cancel();
      }
      if (job.intervalHandle) {
        clearInterval(job.intervalHandle);
      }
    }

    this.jobs.clear();
    this.handlers.clear();
  }
}

/**
 * Create overnight intel scout jobs (GitHub 1 AM, YouTube 2 AM)
 */
export function createOvernightIntelJobs(scheduler, agentRunner) {
  // GitHub Daily Intel Scout - 1:00 AM MST
  const githubJobId = scheduler.scheduleJob({
    name: 'GitHub Daily Intel Scout',
    schedule: '0 1 * * *', // Cron: 1:00 AM daily
    type: 'agentTurn',
    enabled: true,
    timezone: 'America/Denver',
    payload: {
      sessionId: 'overnight-github-intel',
      message: `GitHub Daily Intel Scout - ${new Date().toISOString().split('T')[0]}

Search GitHub for new:
- AI gateway skills, tools, plugins
- MCP servers (Model Context Protocol)
- AI agent frameworks and libraries
- Coding assistants and automation tools
- Phoenix Echo Gateway improvements

Focus on repositories updated in last 24 hours.
For each finding: include repo URL, description, stars, last update.
Output to: ~/Phoenix_Local/_GATEWAY/OVERNIGHT_BUILDS/${new Date().toISOString().split('T')[0]}/github-intel.md

If you find 3+ high-value tools, build integration prototypes.`,
      model: 'anthropic/claude-opus-4-6',
      thinking: 'high'
    }
  });

  // YouTube Intelligence Scout - 2:00 AM MST
  const youtubeJobId = scheduler.scheduleJob({
    name: 'YouTube Intelligence Scout',
    schedule: '0 2 * * *', // Cron: 2:00 AM daily
    type: 'agentTurn',
    enabled: true,
    timezone: 'America/Denver',
    payload: {
      sessionId: 'overnight-youtube-intel',
      message: `YouTube Intelligence Scout - ${new Date().toISOString().split('T')[0]}

Search for recent videos (last 7 days) about:
- AI coding assistants (Cursor, Codex, Claude Code, etc.)
- AI gateway tutorials and use cases
- LLM API developments (Anthropic, OpenAI, Google)
- Business automation with AI
- Phoenix Electric relevant tech

For interesting videos:
1. Extract full transcript
2. Summarize key points
3. Extract code snippets if any
4. Note actionable insights

Output to: ~/Phoenix_Local/_GATEWAY/OVERNIGHT_BUILDS/${new Date().toISOString().split('T')[0]}/youtube-intel.md

If you find valuable code/techniques, build prototypes.`,
      model: 'anthropic/claude-opus-4-6',
      thinking: 'high'
    }
  });

  logger.info('Overnight intel scouts configured', {
    githubJobId,
    youtubeJobId,
    timezone: 'America/Denver'
  });

  return { githubJobId, youtubeJobId };
}
