/**
 * Phoenix Echo Gateway v1.0.0
 *
 * Hardening update:
 * - OAuth-first auth
 * - deterministic workspace/session storage
 * - session recovery API (list/load/create)
 * - crash-safe checkpoints per session
 * - real session switching support over WebSocket
 * - optional gateway token auth for API + WS
 * - correlation IDs in logs and responses
 */

import express from 'express';
import rateLimit from 'express-rate-limit';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { randomUUID, timingSafeEqual } from 'crypto';
import { existsSync } from 'fs';
import { readdir, stat } from 'fs/promises';
import { homedir } from 'os';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';

import { SessionManager } from './session.js';
import { AgentRunner } from './agent.js';
import { loadSystemPrompt } from './prompt.js';
import { tools, executeToolCall, configureToolRuntime } from './tools.js';
import { resolveAnthropicAuth } from './auth.js';
import { loadConfig, createConfigWatcher } from './config.js';
import { configureDefaultLogger, getDefaultLogger } from './logger.js';
import { createChannelsManager } from './channels-integration.js';
import { loadRunbookOverview } from './runbooks.js';
import { getBrainBlueprint, updateBrainChecklistStep } from './brain-blueprint.js';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(SCRIPT_DIR, '..');

// Load configuration
let config, configPath, configWatcher;
try {
  const configResult = await loadConfig({ projectRoot: PROJECT_ROOT });
  config = configResult.config;
  configPath = configResult.configPath;
} catch (error) {
  console.error('[FATAL] Failed to load configuration:', error.message);
  process.exit(1);
}

// Logger defaults should follow resolved config when env overrides are not present.
if (!process.env.PHOENIX_LOG_LEVEL && config?.logging?.level) {
  process.env.PHOENIX_LOG_LEVEL = String(config.logging.level);
}
if (!process.env.PHOENIX_LOG_FILE && config?.logging?.file) {
  process.env.PHOENIX_LOG_FILE = String(config.logging.file);
}

configureDefaultLogger({
  level: process.env.PHOENIX_LOG_LEVEL || config?.logging?.level || 'info',
  file: process.env.PHOENIX_LOG_FILE || config?.logging?.file || '/tmp/phoenix-echo/phoenix-echo.log',
  component: 'gateway'
});

// Initialize logger
const logger = getDefaultLogger();
logger.info('Phoenix Echo Gateway starting', { 
  version: '1.0.0',
  workspace: config.workspace,
  configPath 
});

const PORT = config.gateway.port;
const BIND = String(config.gateway.bind || '127.0.0.1').trim();
const activeSessionIds = new Set(['main']);
let isShuttingDown = false;

// Start config watcher for hot-reload
configWatcher = createConfigWatcher(configPath, async () => {
  logger.info('Config file changed, reloading...', { configPath });
  const reloaded = await loadConfig({ projectRoot: PROJECT_ROOT });
  config = reloaded.config;
  return config;
});

configWatcher.on('reload', (newConfig) => {
  logger.info('Configuration reloaded successfully', { 
    port: newConfig.gateway.port,
    bind: newConfig.gateway.bind,
    logLevel: newConfig.logging.level 
  });
  if (newConfig.gateway.port !== PORT) {
    logger.warn('gateway_port_change_detected_restart_required', {
      activePort: PORT,
      configuredPort: newConfig.gateway.port
    });
  }
  if (newConfig.gateway.bind !== BIND) {
    logger.warn('gateway_bind_change_detected_restart_required', {
      activeBind: BIND,
      configuredBind: newConfig.gateway.bind
    });
  }
});

configWatcher.on('error', (error) => {
  logger.error('Config watcher error', { message: error.message });
});

configWatcher.start();

// Legacy logEvent function for compatibility (wraps logger)
function logEvent(level, event, meta = {}) {
  const message = event;
  const context = meta;
  
  switch (level) {
    case 'debug':
      logger.debug(message, context);
      break;
    case 'info':
      logger.info(message, context);
      break;
    case 'warn':
      logger.warn(message, context);
      break;
    case 'error':
      logger.error(message, context);
      break;
    case 'critical':
      logger.critical(message, context);
      break;
    default:
      logger.info(message, context);
  }
}

function expandHome(inputPath) {
  if (!inputPath) return inputPath;
  if (inputPath === '~') return homedir();
  if (inputPath.startsWith('~/')) return resolve(homedir(), inputPath.slice(2));
  return inputPath;
}

function safeTokenEquals(provided, expected) {
  const left = Buffer.from(String(provided || ''));
  const right = Buffer.from(String(expected || ''));
  if (left.length !== right.length || right.length === 0) {
    return false;
  }
  return timingSafeEqual(left, right);
}

function getGatewayToken() {
  return String(config?.gateway?.auth?.token || '').trim();
}

function isGatewayTokenRequired() {
  return getGatewayToken().length > 0;
}

function extractGatewayToken(req) {
  const xToken = String(req.headers['x-phoenix-token'] || '').trim();
  const authHeader = String(req.headers.authorization || '').trim();
  const bearer = authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7).trim()
    : '';

  let queryToken = '';
  try {
    const parsed = new URL(req.url || '/', 'http://localhost');
    queryToken = String(parsed.searchParams.get('token') || '').trim();
  } catch {
    queryToken = '';
  }

  return xToken || bearer || queryToken;
}

function normalizeSessionId(value) {
  const raw = String(value || 'main').trim();
  const safe = raw.replace(/[^a-zA-Z0-9_-]/g, '_');
  return safe || 'main';
}

const WORKSPACE = config.workspace;
const DAILY_MEMORY_FILE_PATTERN = /^\d{4}-\d{2}-\d{2}.*\.md$/i;

let authConfig;
try {
  authConfig = await resolveAnthropicAuth();
} catch (error) {
  logEvent('error', 'auth_configuration_failed', { message: error.message });
  process.exit(1);
}

// Create the Anthropic client once and reuse it across all requests
const anthropicClient = new Anthropic(authConfig.clientOptions);

// Initialize components
const sessionManager = new SessionManager(WORKSPACE);
const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

configureToolRuntime({
  workspace: WORKSPACE,
  maxExecTimeoutSec: Number(process.env.PHOENIX_MAX_EXEC_TIMEOUT_SEC || 120),
  execAllowPattern: String(process.env.PHOENIX_EXEC_ALLOW || '')
});

// Initialize channels manager (WhatsApp, Teams, Cron)
let channelsManager;
try {
  const channelsConfig = {
    timezone: config.cron?.timezone || 'America/Denver',
    cron: config.cron || {
      enabled: false,
      enableOvernightIntel: false,
      timezone: 'America/Denver',
      jobs: []
    },
    whatsapp: config.channels?.whatsapp || { enabled: false },
    telegram: config.channels?.telegram || { enabled: false },
    teams: config.channels?.teams || { enabled: false }
  };

  channelsManager = await createChannelsManager(channelsConfig, async (sessionId, message, context) => {
    // Route channel messages to handleMessage
    const response = await handleMessage(sessionId, message);
    
    // Reply via the channel's reply function if provided
    if (context?.reply) {
      await context.reply(response);
    }
    
    return response;
  });

  logger.info('Channels manager initialized', {
    whatsapp: !!channelsManager.getWhatsAppChannel(),
    telegram: !!channelsManager.getTelegramChannel(),
    teams: !!channelsManager.getTeamsChannel(),
    cronJobs: channelsManager.getCronScheduler().listJobs().length
  });
} catch (error) {
  logger.error('Failed to initialize channels manager', { error: error.message });
  channelsManager = null;
}

// Middleware
app.use((req, res, next) => {
  req.requestId = randomUUID();
  res.setHeader('x-request-id', req.requestId);
  next();
});
app.use(express.json({ limit: '1mb' }));
app.use(express.static(join(PROJECT_ROOT, 'public')));

// Rate limiting (protects AI spend + reduces abuse). WebSocket message-rate should be handled separately.
const generalApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' }
});

const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many chat messages, please try again later' }
});

app.use('/api', generalApiLimiter);
app.use('/api/chat', chatLimiter);
const teamsRouteHandler = channelsManager?.getTeamsRouteHandler() || null;

app.use('/api', (req, res, next) => {
  // Teams webhook authentication is handled by Bot Framework adapter.
  if (teamsRouteHandler && req.method === 'POST' && req.path === '/messages') {
    return next();
  }

  if (!isGatewayTokenRequired()) {
    return next();
  }
  const token = extractGatewayToken(req);
  if (!safeTokenEquals(token, getGatewayToken())) {
    logEvent('warn', 'gateway_auth_reject', {
      requestId: req.requestId,
      path: req.path,
      method: req.method,
      remote: req.socket?.remoteAddress || null
    });
    return res.status(401).json({
      error: 'Unauthorized: invalid gateway token',
      requestId: req.requestId
    });
  }
  return next();
});

// Health check
app.get('/health', async (req, res) => {
  try {
    const sessions = await sessionManager.list();
    res.json({
      status: 'ok',
      version: '1.0.0',
      name: 'Phoenix Echo Gateway',
      uptime: process.uptime(),
      workspace: WORKSPACE,
      sessionsDir: sessionManager.sessionsDir,
      sessionCount: sessions.length,
      authMode: authConfig.authMode,
      authSource: authConfig.authSource,
      gatewayAuthRequired: isGatewayTokenRequired(),
      requestId: req.requestId
    });
  } catch (error) {
    logEvent('error', 'health_check_error', { requestId: req.requestId, message: error.message });
    res.status(500).json({ 
      status: 'error', 
      error: error.message, 
      requestId: req.requestId 
    });
  }
});

// Dashboard route
app.get('/dashboard', (req, res) => {
  res.sendFile(join(PROJECT_ROOT, 'public', 'dashboard.html'));
});

// Teams Bot Framework endpoint
if (teamsRouteHandler) {
  app.post('/api/messages', teamsRouteHandler);
  logger.info('Teams /api/messages endpoint registered');
}

// Cron jobs API
if (channelsManager?.getCronScheduler()) {
  app.get('/api/cron/jobs', async (req, res) => {
    try {
      const jobs = channelsManager.getCronScheduler().listJobs();
      res.json({ jobs, requestId: req.requestId });
    } catch (error) {
      logger.error('Failed to list cron jobs', { error: error.message });
      res.status(500).json({ error: error.message, requestId: req.requestId });
    }
  });
}

// Channel status API
if (channelsManager) {
  app.get('/api/channels/status', (req, res) => {
    try {
      const status = channelsManager.getStatus();
      res.json({ ...status, requestId: req.requestId });
    } catch (error) {
      logger.error('Failed to load channel status', { error: error.message });
      res.status(500).json({ error: error.message, requestId: req.requestId });
    }
  });
}

// Recovery details for operators
app.get('/api/recovery', async (req, res) => {
  try {
    const sessions = await sessionManager.listDetailed();
    res.json({
      workspace: WORKSPACE,
      sessionsDir: sessionManager.sessionsDir,
      authMode: authConfig.authMode,
      authSource: authConfig.authSource,
      sessions,
      requestId: req.requestId
    });
  } catch (error) {
    logEvent('error', 'recovery_details_error', { requestId: req.requestId, message: error.message });
    res.status(500).json({ error: error.message, requestId: req.requestId });
  }
});

async function listMarkdownFiles(targetDir) {
  try {
    const entries = await readdir(targetDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

async function getMemoryHealthSummary() {
  const memoryRootFile = join(WORKSPACE, 'MEMORY.md');
  const memoryDir = join(WORKSPACE, 'memory');

  const [workspaceMarkdown, memoryMarkdown] = await Promise.all([
    listMarkdownFiles(WORKSPACE),
    listMarkdownFiles(memoryDir)
  ]);

  const dailyFiles = memoryMarkdown.filter((file) => DAILY_MEMORY_FILE_PATTERN.test(file));
  const memoryPathCandidates = [memoryRootFile, ...dailyFiles.map((file) => join(memoryDir, file))];
  let memorySize = 0;
  let lastModified = null;

  for (const path of memoryPathCandidates) {
    try {
      const details = await stat(path);
      if (path === memoryRootFile) {
        memorySize = details.size;
      }
      if (!lastModified || details.mtime > new Date(lastModified)) {
        lastModified = details.mtime.toISOString();
      }
    } catch {
      // Best effort. Missing files should not fail health endpoint.
    }
  }

  return {
    memorySize,
    dailyFiles: dailyFiles.length,
    workspaceFiles: workspaceMarkdown.length + memoryMarkdown.length,
    lastModified
  };
}

async function getRecentActivity(limit = 10) {
  const maxItems = Number.isFinite(limit) ? Math.max(1, Math.min(50, Math.floor(limit))) : 10;
  const items = [];

  try {
    const sessions = await sessionManager.listDetailed();
    for (const session of sessions) {
      if (!session?.updatedAt) continue;
      items.push({
        timestamp: session.updatedAt,
        type: 'session',
        text: `Session ${session.sessionId} updated (${session.messageCount || 0} messages)`
      });
    }
  } catch {
    // Ignore session read failures for activity feed.
  }

  try {
    const memory = await getMemoryHealthSummary();
    if (memory.lastModified) {
      items.push({
        timestamp: memory.lastModified,
        type: 'memory',
        text: `Workspace memory sync refreshed (${memory.dailyFiles} daily files)`
      });
    }
  } catch {
    // Ignore memory read failures for activity feed.
  }

  try {
    const runbooks = await loadRunbookOverview(WORKSPACE);
    if (runbooks.capturedAt) {
      items.push({
        timestamp: runbooks.capturedAt,
        type: 'runbook',
        text: `${runbooks.operationalCount} operational runbooks loaded from ${runbooks.source}`
      });
    }
  } catch {
    // Ignore runbook parsing failures for activity feed.
  }

  items.sort((left, right) => {
    const leftTs = new Date(left.timestamp).getTime();
    const rightTs = new Date(right.timestamp).getTime();
    return rightTs - leftTs;
  });

  return items.slice(0, maxItems);
}

async function getDashboardOverview(limit = 10) {
  const [sessions, runbooks, memory, activities, brain] = await Promise.all([
    sessionManager.listDetailed().catch(() => []),
    loadRunbookOverview(WORKSPACE).catch(() => null),
    getMemoryHealthSummary().catch(() => null),
    getRecentActivity(limit).catch(() => []),
    getBrainBlueprint(WORKSPACE).catch(() => null)
  ]);

  const channels = channelsManager ? channelsManager.getStatus() : { channels: {}, cronJobs: [] };
  const uptimeSec = process.uptime();
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5-20250929';

  return {
    gateway: {
      name: 'Phoenix Echo Gateway',
      version: '1.0.0',
      uptime: uptimeSec,
      model,
      bind: BIND,
      port: PORT,
      authRequired: isGatewayTokenRequired(),
      workspace: WORKSPACE
    },
    sessions: {
      total: sessions.length,
      items: sessions.slice(0, 20)
    },
    runbooks: runbooks || {
      source: 'unavailable',
      operationalCount: 0,
      tutorialCount: 0,
      runbooks: []
    },
    memory: memory || {
      memorySize: 0,
      dailyFiles: 0,
      workspaceFiles: 0,
      lastModified: null
    },
    brain: brain || {
      version: 0,
      phases: [],
      sharepoint: {
        rootFolderCount: 0,
        customerTarget: 0,
        activeBuilderCount: 0,
        vendorCount: 0
      },
      teams: {
        channelCount: 0,
        channels: [],
        graphPermissions: []
      },
      onenote: {
        sectionCount: 0,
        sections: [],
        graphPermissions: []
      },
      cosmos: {
        accountName: '',
        databaseName: '',
        containerCount: 0,
        containers: [],
        estimatedMonthlyUsd: ''
      },
      morningReport: {
        runbook: {
          name: '',
          path: '',
          runtime: '',
          version: '',
          schedule: {
            frequency: '',
            localTime: '',
            timezone: ''
          },
          deliveryFunctions: []
        },
        keyQuestions: [],
        dataSources: [],
        sections: [],
        deliveryChannels: [],
        emailRecipients: []
      },
      alignment: {
        analysisDate: null,
        purpose: '',
        keyInsight: '',
        compatibilityPct: 0,
        summary: '',
        functionAppTopology: [],
        architectureDelta: {
          legacy: {
            compute: '',
            scheduleModel: '',
            runtime: '',
            estimatedMonthlyUsd: '',
            coldStartProfile: ''
          },
          revised: {
            compute: '',
            scheduleModel: '',
            runtime: '',
            estimatedMonthlyUsd: '',
            coldStartProfile: ''
          }
        },
        costs: {
          legacy: {
            totalMonthlyUsd: '',
            components: []
          },
          revised: {
            totalMonthlyUsd: '',
            components: []
          }
        },
        preservedCapabilities: [],
        partAlignment: [],
        updateBacklog: {
          high: [],
          medium: [],
          low: []
        },
        scheduleMapping: [],
        scheduleCronMapping: [],
        agentToFunctionApp: [],
        preservedCosmosContainers: [],
        keyVaultSecretMatrix: [],
        goldenRulesMatrix: [],
        preservedContainerCount: 0,
        migrationPhases: []
      },
      orchestrator: {
        layers: {
          input: [],
          routing: [],
          output: []
        },
        agents: [],
        agentCount: 0,
        tools: {
          declaredMcpRegistryTotal: 0,
          declaredToolCapacityByAgent: 0,
          catalogedToolFamilies: {},
          notes: []
        },
        controlRules: [],
        approvalPolicy: {
          defaultWriteApprovalRequired: true,
          exemptTools: []
        },
        failureRule: {
          maxConsecutiveFailures: 3,
          escalationChannel: '',
          escalationType: ''
        },
        automationVariables: [],
        keyVaultSecrets: [],
        morningReportFlow: []
      },
      rootFolders: [],
      activeBuilders: [],
      vendors: [],
      emailRouting: [],
      graphEndpoints: [],
      accessMatrix: [],
      steps: [],
      summary: {
        totalSteps: 0,
        completedSteps: 0,
        inProgressSteps: 0,
        blockedSteps: 0,
        pendingSteps: 0,
        completionPct: 0
      },
      phaseSummary: {}
    },
    channels,
    activity: activities
  };
}

app.get('/api/runbooks', async (req, res) => {
  try {
    const overview = await loadRunbookOverview(WORKSPACE);
    res.json({ ...overview, requestId: req.requestId });
  } catch (error) {
    logger.error('Failed to load runbook overview', { error: error.message });
    res.status(500).json({ error: error.message, requestId: req.requestId });
  }
});

app.get('/api/memory/health', async (req, res) => {
  try {
    const health = await getMemoryHealthSummary();
    res.json({ ...health, requestId: req.requestId });
  } catch (error) {
    logger.error('Failed to load memory health', { error: error.message });
    res.status(500).json({ error: error.message, requestId: req.requestId });
  }
});

app.get('/api/activity/recent', async (req, res) => {
  try {
    const limit = Number(req.query.limit || 10);
    const activities = await getRecentActivity(limit);
    res.json({ activities, requestId: req.requestId });
  } catch (error) {
    logger.error('Failed to load recent activity', { error: error.message });
    res.status(500).json({ error: error.message, requestId: req.requestId });
  }
});

app.get('/api/brain/blueprint', async (req, res) => {
  try {
    const brain = await getBrainBlueprint(WORKSPACE);
    res.json({ ...brain, requestId: req.requestId });
  } catch (error) {
    logger.error('Failed to load brain blueprint', { error: error.message });
    res.status(500).json({ error: error.message, requestId: req.requestId });
  }
});

app.post('/api/brain/checklist', async (req, res) => {
  try {
    const stepId = String(req.body?.stepId || '').trim();
    const status = String(req.body?.status || '').trim();
    const note = typeof req.body?.note === 'string' ? req.body.note : '';
    if (!stepId || !status) {
      return res.status(400).json({
        error: 'stepId and status are required',
        requestId: req.requestId
      });
    }

    const brain = await updateBrainChecklistStep(WORKSPACE, { stepId, status, note });
    res.json({ ...brain, requestId: req.requestId });
  } catch (error) {
    logger.error('Failed to update brain checklist step', { error: error.message });
    res.status(400).json({ error: error.message, requestId: req.requestId });
  }
});

app.get('/api/dashboard/overview', async (req, res) => {
  try {
    const limit = Number(req.query.limit || 12);
    const overview = await getDashboardOverview(limit);
    res.json({ ...overview, requestId: req.requestId });
  } catch (error) {
    logger.error('Failed to load dashboard overview', { error: error.message });
    res.status(500).json({ error: error.message, requestId: req.requestId });
  }
});

// Session list
app.get('/api/sessions', async (req, res) => {
  try {
    const sessions = await sessionManager.listDetailed();
    res.json({ sessions, requestId: req.requestId });
  } catch (error) {
    logEvent('error', 'session_list_error', { requestId: req.requestId, message: error.message });
    res.status(500).json({ error: error.message, requestId: req.requestId });
  }
});

// Get one session history
app.get('/api/sessions/:sessionId', async (req, res) => {
  try {
    const sessionId = normalizeSessionId(req.params.sessionId);
    const messages = await sessionManager.load(sessionId);
    const checkpoint = await sessionManager.loadCheckpoint(sessionId);
    res.json({ sessionId, messages, checkpoint, requestId: req.requestId });
  } catch (error) {
    logEvent('error', 'session_load_error', { requestId: req.requestId, message: error.message });
    res.status(500).json({ error: error.message, requestId: req.requestId });
  }
});

// Create session
app.post('/api/sessions', async (req, res) => {
  try {
    const requested = req.body?.sessionId;
    const generated =
      `session_${new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')}`;
    const sessionId = normalizeSessionId(requested || generated);
    const path = sessionManager.getSessionPath(sessionId);
    const existed = existsSync(path);
    if (!existed) {
      await sessionManager.save(sessionId, []);
    }
    await sessionManager.snapshot(sessionId);
    res.status(existed ? 200 : 201).json({ sessionId, existed, requestId: req.requestId });
  } catch (error) {
    logEvent('error', 'session_create_error', { requestId: req.requestId, message: error.message });
    res.status(500).json({ error: error.message, requestId: req.requestId });
  }
});

// Rename session
app.post('/api/sessions/rename', async (req, res) => {
  try {
    const fromSessionId = normalizeSessionId(req.body?.fromSessionId);
    const toSessionId = normalizeSessionId(req.body?.toSessionId);

    if (!fromSessionId || !toSessionId) {
      return res.status(400).json({ error: 'fromSessionId and toSessionId are required', requestId: req.requestId });
    }
    if (fromSessionId === toSessionId) {
      return res.status(400).json({ error: 'Source and target session names are identical', requestId: req.requestId });
    }

    const result = await sessionManager.renameSession(fromSessionId, toSessionId);
    await sessionManager.snapshot(result.toSessionId);
    res.json({ ...result, requestId: req.requestId });
  } catch (error) {
    logEvent('error', 'session_rename_error', { requestId: req.requestId, message: error.message });
    res.status(400).json({ error: error.message, requestId: req.requestId });
  }
});

// Compact session (summarize old messages to reduce context)
app.post('/api/sessions/:sessionId/compact', async (req, res) => {
  try {
    const sessionId = normalizeSessionId(req.params.sessionId);
    const strategy = req.body?.strategy || 'keep-recent';
    const keepCount = Number(req.body?.keepCount) || 50;

    const result = await sessionManager.compact(sessionId, {
      strategy,
      keepCount,
      requestId: req.requestId
    });

    await sessionManager.snapshot(sessionId);
    
    res.json({
      sessionId,
      strategy,
      ...result,
      requestId: req.requestId
    });
  } catch (error) {
    logEvent('error', 'session_compact_error', { 
      requestId: req.requestId, 
      sessionId: req.params.sessionId,
      message: error.message 
    });
    res.status(500).json({ error: error.message, requestId: req.requestId });
  }
});

// REST API for sending messages
app.post('/api/chat', async (req, res) => {
  try {
    const { message, sessionId = 'main' } = req.body || {};
    if (!message || !String(message).trim()) {
      return res.status(400).json({ error: 'Message required', requestId: req.requestId });
    }

    const safeSessionId = normalizeSessionId(sessionId);
    const response = await handleMessage(safeSessionId, String(message), {
      requestId: req.requestId,
      channel: 'http'
    });
    res.json({ response, sessionId: safeSessionId, requestId: req.requestId });
  } catch (error) {
    logEvent('error', 'chat_error', { requestId: req.requestId, message: error.message });
    res.status(500).json({ error: error.message, requestId: req.requestId });
  }
});

async function sendSessionState(ws, sessionId) {
  const safeSessionId = normalizeSessionId(sessionId);
  const messages = await sessionManager.load(sessionId);
  const checkpoint = await sessionManager.loadCheckpoint(sessionId);
  activeSessionIds.add(safeSessionId);
  ws.send(
    JSON.stringify({
      type: 'session',
      sessionId: safeSessionId,
      messageCount: messages.length,
      checkpoint
    })
  );
}

async function snapshotTrackedSessions() {
  const tracked = Array.from(activeSessionIds);
  const targets = tracked.length > 0 ? tracked : await sessionManager.list();
  await Promise.all(
    targets.map(async (sessionId) => {
      try {
        await sessionManager.snapshot(sessionId);
      } catch (error) {
        logEvent('warn', 'shutdown_snapshot_failed', {
          sessionId,
          message: error.message
        });
      }
    })
  );
  return targets.length;
}

async function closeWebSocketClients(timeoutMs = 3000) {
  const clients = Array.from(wss.clients);
  if (clients.length === 0) {
    return;
  }

  await Promise.race([
    new Promise((resolveClose) => {
      let remaining = clients.length;
      const done = () => {
        remaining -= 1;
        if (remaining <= 0) {
          resolveClose();
        }
      };
      for (const client of clients) {
        try {
          client.once('close', done);
          client.close(1001, 'Server shutting down');
        } catch {
          done();
        }
      }
    }),
    new Promise((resolveClose) => setTimeout(resolveClose, timeoutMs))
  ]);
}

async function gracefulShutdown(signal, cause = null) {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;

  logEvent('warn', 'shutdown_start', {
    signal,
    reason: cause ? cause.message : null
  });

  const forcedExit = setTimeout(() => {
    logEvent('error', 'shutdown_forced_exit', { signal });
    process.exit(cause ? 1 : 0);
  }, 6000);
  forcedExit.unref();

  try {
    const snapCount = await snapshotTrackedSessions();
    logEvent('info', 'shutdown_snapshots_complete', { count: snapCount });
  } catch (error) {
    logEvent('error', 'shutdown_snapshot_phase_failed', { message: error.message });
  }

  try {
    await closeWebSocketClients();
    logEvent('info', 'shutdown_ws_clients_closed');
  } catch (error) {
    logEvent('error', 'shutdown_ws_close_failed', { message: error.message });
  }

  try {
    await Promise.race([
      new Promise((resolveClose) => server.close(resolveClose)),
      new Promise((resolveClose) => setTimeout(resolveClose, 3000))
    ]);
    logEvent('info', 'shutdown_http_closed');
  } catch (error) {
    logEvent('error', 'shutdown_http_close_failed', { message: error.message });
  }

  // Stop config watcher
  if (configWatcher) {
    configWatcher.stop();
    logEvent('info', 'shutdown_config_watcher_stopped');
  }

  // Shutdown channels manager
  if (channelsManager) {
    try {
      await channelsManager.shutdown();
      logEvent('info', 'shutdown_channels_stopped');
    } catch (error) {
      logEvent('error', 'shutdown_channels_failed', { message: error.message });
    }
  }

  clearTimeout(forcedExit);
  process.exit(cause ? 1 : 0);
}

process.on('uncaughtException', (error) => {
  void gracefulShutdown('uncaughtException', error);
});

process.on('unhandledRejection', (reason) => {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  void gracefulShutdown('unhandledRejection', error);
});

process.on('SIGTERM', () => {
  void gracefulShutdown('SIGTERM');
});

process.on('SIGINT', () => {
  void gracefulShutdown('SIGINT');
});

// WebSocket handler
wss.on('connection', (ws, req) => {
  const socketId = randomUUID();
  const remote = req.socket?.remoteAddress || null;
  const requiresGatewayToken = isGatewayTokenRequired();
  let authenticated = !requiresGatewayToken;
  if (requiresGatewayToken) {
    // Backward-compat: allow non-browser clients to authenticate via headers or legacy ?token=
    const token = extractGatewayToken(req);
    if (safeTokenEquals(token, getGatewayToken())) {
      authenticated = true;
    }
  }

  logEvent('info', 'ws_connected', { socketId, remote, authenticated });
  let sessionId = 'main';
  activeSessionIds.add(sessionId);

  ws.on('message', async (data) => {
    const requestId = randomUUID();
    try {
      const msg = JSON.parse(data.toString());

      if (msg.type === 'auth') {
        if (requiresGatewayToken && !authenticated) {
          const provided = String(msg.token || '').trim();
          if (safeTokenEquals(provided, getGatewayToken())) {
            authenticated = true;
            ws.send(JSON.stringify({ type: 'auth', status: 'ok' }));
          } else {
            logEvent('warn', 'ws_auth_reject', { socketId, remote });
            ws.send(JSON.stringify({ type: 'error', message: 'Unauthorized: invalid gateway token' }));
            ws.close(1008, 'Unauthorized');
          }
        }
        return;
      }

      if (requiresGatewayToken && !authenticated) {
        logEvent('warn', 'ws_auth_reject', { socketId, remote });
        ws.send(JSON.stringify({ type: 'error', message: 'Unauthorized: authentication required' }));
        ws.close(1008, 'Unauthorized');
        return;
      }

      if (msg.type === 'session') {
        sessionId = normalizeSessionId(msg.sessionId || 'main');
        activeSessionIds.add(sessionId);
        await sendSessionState(ws, sessionId);
        return;
      }

      if (msg.type === 'new_session') {
        const generated =
          `session_${new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')}`;
        sessionId = normalizeSessionId(msg.sessionId || generated);
        activeSessionIds.add(sessionId);
        if (!existsSync(sessionManager.getSessionPath(sessionId))) {
          await sessionManager.save(sessionId, []);
        }
        await sessionManager.snapshot(sessionId);
        await sendSessionState(ws, sessionId);
        return;
      }

      if (msg.type === 'history') {
        const requested = normalizeSessionId(msg.sessionId || sessionId);
        activeSessionIds.add(requested);
        const messages = await sessionManager.load(requested);
        ws.send(
          JSON.stringify({
            type: 'history',
            sessionId: requested,
            messages
          })
        );
        return;
      }

      if (msg.type === 'list_sessions') {
        const sessions = await sessionManager.listDetailed();
        ws.send(JSON.stringify({ type: 'sessions', sessions }));
        return;
      }

      if (msg.type === 'rename_session') {
        const fromSessionId = normalizeSessionId(msg.fromSessionId || sessionId);
        const toSessionId = normalizeSessionId(msg.toSessionId);

        if (!toSessionId) {
          ws.send(JSON.stringify({ type: 'error', message: 'toSessionId is required' }));
          return;
        }
        if (fromSessionId === toSessionId) {
          ws.send(JSON.stringify({ type: 'error', message: 'Source and target session names are identical' }));
          return;
        }

        const result = await sessionManager.renameSession(fromSessionId, toSessionId);
        await sessionManager.snapshot(result.toSessionId);
        activeSessionIds.add(result.toSessionId);
        if (sessionId === result.fromSessionId) {
          sessionId = result.toSessionId;
        }
        await sendSessionState(ws, sessionId);
        const sessions = await sessionManager.listDetailed();
        ws.send(JSON.stringify({ type: 'sessions', sessions, renamed: result }));
        return;
      }

      if (msg.type === 'message') {
        if (!msg.content || !String(msg.content).trim()) {
          ws.send(JSON.stringify({ type: 'error', message: 'Message required' }));
          return;
        }

        ws.send(JSON.stringify({ type: 'typing', status: true }));
        const response = await handleMessage(sessionId, String(msg.content), {
          requestId,
          channel: 'ws',
          socketId
        });
        ws.send(
          JSON.stringify({
            type: 'response',
            content: response,
            sessionId,
            requestId
          })
        );
      }
    } catch (error) {
      logEvent('error', 'ws_message_error', { socketId, requestId, message: error.message });
      ws.send(JSON.stringify({ type: 'error', message: error.message }));
    } finally {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'typing', status: false }));
      }
    }
  });

  ws.on('close', () => {
    logEvent('info', 'ws_disconnected', { socketId });
  });
});

function buildFriendlyErrorMessage(error) {
  const status = error?.status;
  if (status === 401) {
    return 'Authentication failed. OAuth token is missing/expired. Refresh login and restart Phoenix Echo.';
  }
  if (status === 429) {
    return 'Rate limited by model provider. Retry in a moment.';
  }
  return `Gateway error: ${error.message}`;
}

function isModelContent(content) {
  if (typeof content === 'string') {
    return content.trim().length > 0;
  }
  if (Array.isArray(content)) {
    return content.length > 0;
  }
  return false;
}

function normalizeModelContent(content) {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content;
  }
  return String(content ?? '');
}

/**
 * Handle incoming message - core agent loop
 */
async function handleMessage(sessionId, userMessage, context = {}) {
  if (isShuttingDown) {
    return 'Gateway is shutting down. Please retry in a moment.';
  }
  const safeSessionId = normalizeSessionId(sessionId);
  activeSessionIds.add(safeSessionId);
  const requestId = context.requestId || randomUUID();
  logEvent('info', 'message_received', {
    requestId,
    sessionId: safeSessionId,
    channel: context.channel || 'unknown',
    preview: userMessage.substring(0, 100)
  });

  // Load prior conversation state and keep conversational turns (including tool turns).
  const prior = await sessionManager.load(safeSessionId);
  const history = prior
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && isModelContent(m.content))
    .map((m) => ({ role: m.role, content: normalizeModelContent(m.content) }));

  const userEntry = { role: 'user', content: userMessage, ts: new Date().toISOString() };
  history.push({ role: 'user', content: userMessage });
  await sessionManager.append(safeSessionId, userEntry);

  try {
    const systemPrompt = await loadSystemPrompt(WORKSPACE);
    const agent = new AgentRunner({
      client: anthropicClient,
      systemPrompt,
      tools,
      executeToolCall,
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5-20250929',
      maxRequestRetries: Number(process.env.PHOENIX_MODEL_RETRIES || 3),
      retryBaseDelayMs: Number(process.env.PHOENIX_MODEL_RETRY_BASE_MS || 500),
      logger: (level, event, meta) => logEvent(level, event, { requestId, sessionId: safeSessionId, ...meta })
    });

    const result = await agent.run(history, { requestId });
    const response = typeof result === 'string' ? result : String(result?.text || '');
    const generatedTurns =
      typeof result === 'object' && Array.isArray(result?.generatedTurns) && result.generatedTurns.length > 0
        ? result.generatedTurns
        : [{ role: 'assistant', content: response }];

    for (const turn of generatedTurns) {
      const role = turn?.role === 'user' ? 'user' : 'assistant';
      const content = normalizeModelContent(turn?.content);
      if (!isModelContent(content)) {
        continue;
      }
      await sessionManager.append(safeSessionId, {
        role,
        content,
        ts: new Date().toISOString()
      });
    }
    await sessionManager.snapshot(safeSessionId);

    logEvent('info', 'message_completed', {
      requestId,
      sessionId: safeSessionId,
      preview: response.substring(0, 100)
    });
    return response;
  } catch (error) {
    const friendly = buildFriendlyErrorMessage(error);
    const assistantErrorEntry = {
      role: 'assistant',
      content: friendly,
      ts: new Date().toISOString(),
      error: true
    };

    await sessionManager.append(safeSessionId, assistantErrorEntry);
    await sessionManager.snapshot(safeSessionId);
    logEvent('error', 'message_failed', { requestId, sessionId: safeSessionId, message: friendly });
    return friendly;
  }
}

// Start server
server.listen(PORT, BIND, async () => {
  const sessions = await sessionManager.list();
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║                   PHOENIX ECHO GATEWAY                    ║
║                        v1.0.0                             ║
╠═══════════════════════════════════════════════════════════╣
║  Status:    ONLINE                                        ║
║  Port:      ${PORT}                                          ║
║  Bind:      ${BIND}                                    ║
║  Workspace: ${WORKSPACE.substring(0, 40)}...
║  Sessions:  ${sessions.length}                                           ║
║  Auth:      ${authConfig.authMode} (${authConfig.authSource.substring(0, 28)}...) ║
║  Gate auth: ${isGatewayTokenRequired() ? 'required' : 'disabled'}                                      ║
║  Model:     ${process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5-20250929'}
╠═══════════════════════════════════════════════════════════╣
║  Endpoints:                                               ║
║    HTTP:  http://localhost:${PORT}/api/chat                  ║
║    WS:    ws://localhost:${PORT}/ws                          ║
║    Health: http://localhost:${PORT}/health                   ║
╚═══════════════════════════════════════════════════════════╝
  `);
});

export { handleMessage, sessionManager };
