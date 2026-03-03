/**
 * Phoenix Echo Tools
 *
 * Tool definitions and executors for the agent.
 * Each tool has a schema (for Claude) and an executor function.
 */

import { exec as execCb, execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import { readFile, writeFile, mkdir, readdir, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'path';

const execAsync = promisify(execCb);
const execFileAsync = promisify(execFileCb);

const DEFAULT_MAX_EXEC_TIMEOUT_SEC = 120;
const SENSITIVE_WRITE_BASENAMES = new Set([
  '.env',
  'auth-profiles.json',
  'device-auth.json',
]);

const BLOCKED_EXEC_PATTERNS = [
  /(^|\s)rm\s+-rf\s+\/(\s|$)/i,
  /(^|\s)mkfs(\.|-|\s|$)/i,
  /(^|\s)shutdown(\s|$)/i,
  /(^|\s)reboot(\s|$)/i,
  /(^|\s)poweroff(\s|$)/i,
  /(^|\s)halt(\s|$)/i,
  /:\(\)\s*\{\s*:\|:\s*&\s*\};:/,
  /(^|\s)dd\s+if=.*\s+of=\/dev\//i
];

const runtimeConfig = {
  workspace: process.cwd(),
  maxExecTimeoutSec: DEFAULT_MAX_EXEC_TIMEOUT_SEC,
  allowSensitiveWrites: String(process.env.PHOENIX_ALLOW_SENSITIVE_WRITES || '').toLowerCase() === 'true',
  execAllowRegex: buildAllowRegex(process.env.PHOENIX_EXEC_ALLOW || '')
};

function buildAllowRegex(rawPattern) {
  const pattern = String(rawPattern || '').trim();
  if (!pattern) {
    return null;
  }
  try {
    return new RegExp(pattern);
  } catch {
    return null;
  }
}

function normalizeWorkspace(inputWorkspace) {
  const candidate = String(inputWorkspace || '').trim();
  if (!candidate) {
    return process.cwd();
  }
  return resolve(candidate);
}

function isOutsideWorkspace(absPath) {
  const rel = relative(runtimeConfig.workspace, absPath);
  return rel === '..' || rel.startsWith(`..${sep}`);
}

function resolveWorkspacePath(inputPath) {
  const requested = String(inputPath || '').trim();
  if (!requested) {
    throw new Error('Path is required');
  }

  const absolute = isAbsolute(requested)
    ? resolve(requested)
    : resolve(runtimeConfig.workspace, requested);

  if (isOutsideWorkspace(absolute)) {
    throw new Error(`Path is outside workspace boundary: ${requested}`);
  }

  return absolute;
}

function enforceExecPolicy(command) {
  const value = String(command || '').trim();
  if (!value) {
    throw new Error('Command is required');
  }

  for (const pattern of BLOCKED_EXEC_PATTERNS) {
    if (pattern.test(value)) {
      throw new Error(`Blocked command pattern: ${pattern}`);
    }
  }

  if (runtimeConfig.execAllowRegex && !runtimeConfig.execAllowRegex.test(value)) {
    throw new Error('Command rejected by PHOENIX_EXEC_ALLOW policy');
  }
}

function sanitizeTimeoutSeconds(inputTimeout) {
  const parsed = Number(inputTimeout);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 30;
  }
  return Math.min(Math.floor(parsed), runtimeConfig.maxExecTimeoutSec);
}

function enforceSensitiveWritePolicy(absPath) {
  if (runtimeConfig.allowSensitiveWrites) {
    return;
  }
  const base = basename(absPath);
  if (SENSITIVE_WRITE_BASENAMES.has(base)) {
    throw new Error(`Writes to sensitive file require PHOENIX_ALLOW_SENSITIVE_WRITES=true: ${base}`);
  }
}

export function configureToolRuntime(options = {}) {
  if (options.workspace) {
    runtimeConfig.workspace = normalizeWorkspace(options.workspace);
  }
  if (options.maxExecTimeoutSec != null) {
    const val = Number(options.maxExecTimeoutSec);
    if (Number.isFinite(val) && val > 0) {
      runtimeConfig.maxExecTimeoutSec = Math.min(Math.floor(val), 600);
    }
  }
  if (options.allowSensitiveWrites != null) {
    runtimeConfig.allowSensitiveWrites = Boolean(options.allowSensitiveWrites);
  }
  if (typeof options.execAllowPattern === 'string') {
    runtimeConfig.execAllowRegex = buildAllowRegex(options.execAllowPattern);
  }
}

/**
 * Tool definitions (Anthropic format)
 */
export const tools = [
  {
    name: 'exec',
    description: 'Execute a shell command. Use for running programs, scripts, git commands, etc.',
    input_schema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The shell command to execute'
        },
        workdir: {
          type: 'string',
          description: 'Working directory (optional)'
        },
        timeout: {
          type: 'number',
          description: 'Timeout in seconds (default: 30)'
        }
      },
      required: ['command']
    }
  },
  {
    name: 'read',
    description: 'Read the contents of a file. Returns the file text.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the file to read'
        },
        offset: {
          type: 'number',
          description: 'Line number to start reading from (1-indexed)'
        },
        limit: {
          type: 'number',
          description: 'Maximum number of lines to read'
        }
      },
      required: ['path']
    }
  },
  {
    name: 'write',
    description: 'Write content to a file. Creates the file if it does not exist. Creates parent directories if needed.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the file to write'
        },
        content: {
          type: 'string',
          description: 'Content to write to the file'
        }
      },
      required: ['path', 'content']
    }
  },
  {
    name: 'list',
    description: 'List files and directories at a path.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Directory path to list'
        }
      },
      required: ['path']
    }
  },
  {
    name: 'search',
    description: 'Search for text in files using grep.',
    input_schema: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Search pattern (regex)'
        },
        path: {
          type: 'string',
          description: 'Directory or file to search in'
        },
        recursive: {
          type: 'boolean',
          description: 'Search recursively (default: true)'
        }
      },
      required: ['pattern', 'path']
    }
  }
];

/**
 * Execute a tool call
 * @param {string} name - Tool name
 * @param {object} input - Tool input
 * @returns {string} Tool result
 */
export async function executeToolCall(name, input) {
  switch (name) {
    case 'exec':
      return await execTool(input);
    case 'read':
      return await readTool(input);
    case 'write':
      return await writeTool(input);
    case 'list':
      return await listTool(input);
    case 'search':
      return await searchTool(input);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

/**
 * Execute shell command
 */
async function execTool({ command, workdir, timeout = 30 }) {
  enforceExecPolicy(command);
  const safeTimeout = sanitizeTimeoutSeconds(timeout);
  const safeCwd = workdir ? resolveWorkspacePath(workdir) : runtimeConfig.workspace;

  try {
    const options = {
      cwd: safeCwd,
      timeout: safeTimeout * 1000,
      maxBuffer: 10 * 1024 * 1024 // 10MB
    };

    const { stdout, stderr } = await execAsync(command, options);
    let result = '';
    if (stdout) result += stdout;
    if (stderr) result += (result ? '\n' : '') + stderr;
    return result || '(no output)';
  } catch (error) {
    if (error.killed) {
      return `Command timed out after ${safeTimeout} seconds`;
    }
    return `Error (exit ${error.code}): ${error.message}\n${error.stderr || ''}`;
  }
}

const MAX_READ_BYTES = 5 * 1024 * 1024; // 5 MB hard cap per read

/**
 * Read file contents
 */
async function readTool({ path, offset = 1, limit }) {
  const safePath = resolveWorkspacePath(path);

  if (!existsSync(safePath)) {
    throw new Error(`File not found: ${safePath}`);
  }

  const fileStat = await stat(safePath);
  const isTooLarge = fileStat.size > MAX_READ_BYTES;

  if (isTooLarge && !limit) {
    throw new Error(
      `File too large to read in full (${fileStat.size} bytes). Use offset and limit to read a specific range.`
    );
  }

  // For oversized files with a limit, read only the capped bytes to avoid OOM.
  let content;
  if (isTooLarge) {
    const fd = await import('fs/promises').then((m) => m.open(safePath, 'r'));
    try {
      const buf = Buffer.alloc(MAX_READ_BYTES);
      const { bytesRead } = await fd.read(buf, 0, MAX_READ_BYTES, 0);
      content = buf.slice(0, bytesRead).toString('utf-8');
    } finally {
      await fd.close();
    }
  } else {
    content = await readFile(safePath, 'utf-8');
  }
  const lines = content.split('\n');

  // Apply offset and limit
  const startLine = Math.max(0, offset - 1);
  const endLine = limit ? startLine + limit : lines.length;
  const selectedLines = lines.slice(startLine, endLine);

  // Add line numbers
  const numbered = selectedLines.map((line, i) => 
    `${startLine + i + 1}: ${line}`
  ).join('\n');

  const total = lines.length;
  const showing = selectedLines.length;
  const header = `[${safePath}] Lines ${startLine + 1}-${startLine + showing} of ${total}\n`;

  return header + numbered;
}

/**
 * Write file contents
 */
async function writeTool({ path, content }) {
  const safePath = resolveWorkspacePath(path);
  enforceSensitiveWritePolicy(safePath);

  // Create parent directories if needed
  const dir = dirname(safePath);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }

  await writeFile(safePath, content, 'utf-8');
  return `Successfully wrote ${content.length} bytes to ${safePath}`;
}

/**
 * List directory contents
 */
async function listTool({ path }) {
  const safePath = resolveWorkspacePath(path);

  if (!existsSync(safePath)) {
    throw new Error(`Path not found: ${safePath}`);
  }

  const stats = await stat(safePath);
  if (!stats.isDirectory()) {
    return `${safePath} is a file (${stats.size} bytes)`;
  }

  const entries = await readdir(safePath, { withFileTypes: true });
  const formatted = entries.map(entry => {
    const type = entry.isDirectory() ? 'd' : '-';
    return `${type} ${entry.name}`;
  }).sort().join('\n');

  return `Contents of ${safePath}:\n${formatted}`;
}

/**
 * Search for text in files
 */
async function searchTool({ pattern, path, recursive = true }) {
  const safePath = resolveWorkspacePath(path);
  const args = recursive
    ? ['-nr', '--', String(pattern || ''), safePath]
    : ['-n', '--', String(pattern || ''), safePath];

  try {
    const { stdout } = await execFileAsync('grep', args, {
      maxBuffer: 5 * 1024 * 1024,
      timeout: 30000
    });
    const lines = stdout.split('\n').filter(Boolean).slice(0, 50);
    return lines.join('\n') || 'No matches found';
  } catch (error) {
    if (error.code === 1) {
      return 'No matches found';
    }
    throw error;
  }
}

export default { tools, executeToolCall, configureToolRuntime };
