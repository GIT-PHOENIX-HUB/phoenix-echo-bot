import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { resolve } from 'path';

const DEFAULT_CONFIG = {
  gateway: {
    port: 18790,
    bind: '127.0.0.1',
    auth: {
      mode: 'token',
      token: ''
    }
  },
  workspace: '',
  agent: {
    model: 'claude-sonnet-4-5-20250929',
    maxIterations: 25,
    maxToolErrors: 3,
    maxTokens: 4096
  },
  logging: {
    level: 'info',
    file: ''
  },
  channels: {
    whatsapp: {
      enabled: false,
      sessionDir: '~/.phoenix-echo/whatsapp-session'
    },
    telegram: {
      enabled: false,
      botToken: '',
      pollIntervalMs: 300
    },
    teams: {
      enabled: false,
      appId: '',
      appPassword: '',
      appTenantId: '',
      serviceUrl: ''
    }
  },
  cron: {
    enabled: false,
    enableOvernightIntel: false,
    timezone: 'America/Denver',
    jobs: [
      {
        id: 'heartbeat',
        everyMs: 1800000,
        type: 'agent_turn',
        sessionId: 'main',
        message: 'Heartbeat check-in: summarize system health in 3 bullets and list blockers.'
      }
    ]
  },
  phoenixLocal: {
    gatewayRoot: '~/Phoenix_Local/_GATEWAY',
    fullSetupRoot: '~/Phoenix_Local/PHOENIX_ECHO FULL SET UP',
    aiCoreRoot: '~/GitHub/phoenix-ai-core-staging',
    masterPlanRoot: '~/Desktop/Master PLAN UPDATED'
  }
};

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepMerge(base, override) {
  const output = { ...base };
  for (const [key, value] of Object.entries(override || {})) {
    if (isObject(value) && isObject(output[key])) {
      output[key] = deepMerge(output[key], value);
    } else {
      output[key] = value;
    }
  }
  return output;
}

export function expandHome(inputPath) {
  if (!inputPath) return inputPath;
  if (inputPath === '~') return homedir();
  if (inputPath.startsWith('~/')) return resolve(homedir(), inputPath.slice(2));
  return inputPath;
}

function resolveEnvRef(value) {
  if (typeof value !== 'string') return value;
  if (!value.startsWith('env:')) return value;
  const envKey = value.slice(4).trim();
  if (!envKey) return '';
  return process.env[envKey] || '';
}

function normalizeJobs(jobs) {
  if (!Array.isArray(jobs)) return [];
  return jobs
    .map((job) => {
      const rawSchedule = job?.schedule;
      const cronExpr = typeof job?.cron === 'string' ? job.cron.trim() : '';
      const explicitSchedule = typeof rawSchedule === 'string' ? rawSchedule.trim() : rawSchedule;
      const everyMs = Number(job?.everyMs);

      let schedule = null;
      if (Number.isFinite(everyMs) && everyMs > 0) {
        schedule = { everyMs: Math.floor(everyMs) };
      } else if (typeof explicitSchedule === 'string' && explicitSchedule) {
        schedule = explicitSchedule;
      } else if (explicitSchedule && typeof explicitSchedule === 'object') {
        if (Number.isFinite(Number(explicitSchedule.everyMs)) && Number(explicitSchedule.everyMs) > 0) {
          schedule = { everyMs: Math.floor(Number(explicitSchedule.everyMs)) };
        } else if (typeof explicitSchedule.at === 'string' && explicitSchedule.at.trim()) {
          schedule = { at: explicitSchedule.at.trim() };
        }
      } else if (cronExpr) {
        schedule = cronExpr;
      }

      if (!schedule) return null;
      return {
        id: String(job.id || `job_${Date.now()}`),
        name: String(job.name || ''),
        schedule,
        type: String(job.type || 'agent_turn'),
        sessionId: String(job.sessionId || 'main'),
        message: String(job.message || ''),
        payload:
          job.payload && typeof job.payload === 'object' && !Array.isArray(job.payload)
            ? { ...job.payload }
            : {},
        enabled: job.enabled !== false
      };
    })
    .filter(Boolean);
}

export function resolveGatewayToken(config) {
  const fromConfig = resolveEnvRef(config?.gateway?.auth?.token || '');
  const fromEnv = process.env.PHOENIX_GATEWAY_TOKEN || process.env.PHOENIX_AUTH_TOKEN || '';
  return String(fromEnv || fromConfig).trim();
}

export async function loadConfig(options = {}) {
  const projectRoot = options.projectRoot || process.cwd();
  const configPath = expandHome(process.env.PHOENIX_CONFIG_PATH || '~/.phoenix-echo/config.json');

  let fromFile = {};
  if (existsSync(configPath)) {
    try {
      const raw = await readFile(configPath, 'utf-8');
      fromFile = JSON.parse(raw);
    } catch (error) {
      throw new Error(`Invalid config file at ${configPath}: ${error.message}`);
    }
  }

  let config = deepMerge(DEFAULT_CONFIG, fromFile);

  // Backward-compatibility for legacy top-level channel keys.
  if (!isObject(config.channels)) {
    config.channels = {};
  }
  if (isObject(config.whatsapp) && !isObject(config.channels.whatsapp)) {
    config.channels.whatsapp = { ...config.whatsapp };
  }
  if (isObject(config.telegram) && !isObject(config.channels.telegram)) {
    config.channels.telegram = { ...config.telegram };
  }
  if (isObject(config.teams) && !isObject(config.channels.teams)) {
    config.channels.teams = { ...config.teams };
  }

  if (process.env.PHOENIX_PORT) {
    config.gateway.port = Number(process.env.PHOENIX_PORT);
  }
  if (process.env.PHOENIX_BIND) {
    config.gateway.bind = process.env.PHOENIX_BIND;
  }
  if (process.env.PHOENIX_WORKSPACE) {
    config.workspace = process.env.PHOENIX_WORKSPACE;
  }
  if (process.env.PHOENIX_MODEL) {
    config.agent.model = process.env.PHOENIX_MODEL;
  }
  if (process.env.PHOENIX_LOG_LEVEL) {
    config.logging.level = process.env.PHOENIX_LOG_LEVEL;
  }
  if (process.env.PHOENIX_LOG_FILE) {
    config.logging.file = process.env.PHOENIX_LOG_FILE;
  }
  if (process.env.PHOENIX_AUTH_MODE) {
    config.gateway.auth.mode = process.env.PHOENIX_AUTH_MODE;
  }
  if (process.env.PHOENIX_TELEGRAM_ENABLED) {
    config.channels.telegram.enabled = process.env.PHOENIX_TELEGRAM_ENABLED === 'true';
  }
  if (process.env.PHOENIX_TELEGRAM_BOT_TOKEN) {
    config.channels.telegram.botToken = process.env.PHOENIX_TELEGRAM_BOT_TOKEN;
  }
  if (process.env.PHOENIX_TELEGRAM_POLL_INTERVAL_MS) {
    config.channels.telegram.pollIntervalMs = Number(process.env.PHOENIX_TELEGRAM_POLL_INTERVAL_MS);
  }
  if (process.env.PHOENIX_TEAMS_ENABLED) {
    config.channels.teams.enabled = process.env.PHOENIX_TEAMS_ENABLED === 'true';
  }
  if (process.env.PHOENIX_TEAMS_APP_ID) {
    config.channels.teams.appId = process.env.PHOENIX_TEAMS_APP_ID;
  }
  if (process.env.PHOENIX_TEAMS_APP_PASSWORD) {
    config.channels.teams.appPassword = process.env.PHOENIX_TEAMS_APP_PASSWORD;
  }
  if (process.env.PHOENIX_TEAMS_APP_TENANT_ID) {
    config.channels.teams.appTenantId = process.env.PHOENIX_TEAMS_APP_TENANT_ID;
  }
  if (process.env.PHOENIX_TEAMS_SERVICE_URL) {
    config.channels.teams.serviceUrl = process.env.PHOENIX_TEAMS_SERVICE_URL;
  }

  const port = Number(config.gateway.port);
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid gateway port: ${config.gateway.port}`);
  }

  config.gateway.port = port;
  config.workspace = resolve(expandHome(config.workspace || projectRoot));
  config.logging.file = expandHome(config.logging.file || '');
  config.gateway.auth.mode = String(config.gateway.auth.mode || 'token').toLowerCase();
  config.gateway.auth.token = resolveGatewayToken(config);

  if (!isObject(config.channels)) {
    config.channels = {};
  }
  if (!isObject(config.channels.whatsapp)) {
    config.channels.whatsapp = { ...DEFAULT_CONFIG.channels.whatsapp };
  }
  if (!isObject(config.channels.telegram)) {
    config.channels.telegram = { ...DEFAULT_CONFIG.channels.telegram };
  }
  if (!isObject(config.channels.teams)) {
    config.channels.teams = { ...DEFAULT_CONFIG.channels.teams };
  }
  config.channels.whatsapp.enabled = config.channels.whatsapp.enabled === true;
  config.channels.whatsapp.sessionDir = resolve(
    expandHome(config.channels.whatsapp.sessionDir || DEFAULT_CONFIG.channels.whatsapp.sessionDir)
  );
  config.channels.telegram.enabled = config.channels.telegram.enabled === true;
  config.channels.telegram.botToken = resolveEnvRef(config.channels.telegram.botToken || '');
  const pollIntervalMs = Number(config.channels.telegram.pollIntervalMs);
  config.channels.telegram.pollIntervalMs =
    Number.isFinite(pollIntervalMs) && pollIntervalMs > 0
      ? Math.max(100, Math.floor(pollIntervalMs))
      : DEFAULT_CONFIG.channels.telegram.pollIntervalMs;
  config.channels.teams.enabled = config.channels.teams.enabled === true;
  config.channels.teams.appId = resolveEnvRef(config.channels.teams.appId || '');
  config.channels.teams.appPassword = resolveEnvRef(config.channels.teams.appPassword || '');
  config.channels.teams.appTenantId = resolveEnvRef(config.channels.teams.appTenantId || '');
  config.channels.teams.serviceUrl = resolveEnvRef(config.channels.teams.serviceUrl || '');

  const cronConfig = config?.cron && typeof config.cron === 'object' ? config.cron : {};
  config.cron = {
    enabled: cronConfig.enabled === true,
    enableOvernightIntel: cronConfig.enableOvernightIntel === true,
    timezone: String(cronConfig.timezone || 'America/Denver'),
    jobs: normalizeJobs(cronConfig.jobs)
  };

  for (const key of Object.keys(config.phoenixLocal || {})) {
    config.phoenixLocal[key] = expandHome(config.phoenixLocal[key]);
  }

  return {
    config,
    configPath
  };
}

/**
 * Config Hot-Reload Support
 * Watch config file and reload on change (debounced)
 */
import { watch } from 'fs';
import { EventEmitter } from 'events';

class ConfigWatcher extends EventEmitter {
  constructor(configPath, reloadFn) {
    super();
    this.configPath = configPath;
    this.reloadFn = reloadFn;
    this.watcher = null;
    this.debounceTimer = null;
    this.debounceMs = 500;
  }

  start() {
    if (this.watcher || !existsSync(this.configPath)) {
      return;
    }

    try {
      this.watcher = watch(this.configPath, (eventType) => {
        if (eventType === 'change') {
          this.scheduleReload();
        }
      });

      this.watcher.on('error', (error) => {
        this.emit('error', error);
      });
    } catch (error) {
      this.emit('error', error);
    }
  }

  scheduleReload() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.performReload();
    }, this.debounceMs);
  }

  async performReload() {
    try {
      const result = await this.reloadFn();
      this.emit('reload', result);
    } catch (error) {
      this.emit('error', error);
    }
  }

  stop() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }
}

export function createConfigWatcher(configPath, reloadFn) {
  return new ConfigWatcher(configPath, reloadFn);
}

export default {
  loadConfig,
  resolveGatewayToken,
  expandHome,
  createConfigWatcher
};
