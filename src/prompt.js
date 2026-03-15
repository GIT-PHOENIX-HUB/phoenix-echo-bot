/**
 * Phoenix Echo System Prompt Loader
 * 
 * Assembles the system prompt from workspace markdown files:
 * - SOUL.md - Agent personality and identity
 * - IDENTITY.md - Canonical identity and mission
 * - AGENTS.md - Agent configuration and rules
 * - USER.md - User context and preferences
 * - TOOLS.md - Tool-specific notes
 * - MEMORY.md - Long-term memory
 * - HEARTBEAT.md - Operational heartbeat directives
 */

import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

// Cache prompt per workspace for 60 seconds to avoid redundant disk reads on every message.
// A Map keyed by workspace path allows different workspaces to have independent entries.
const PROMPT_CACHE_TTL_MS = 60_000;
const _promptCacheMap = new Map(); // workspace -> { prompt: string, time: number }

const WORKSPACE_FILES = [
  { name: 'SOUL.md', header: '## Soul', required: false },
  { name: 'IDENTITY.md', header: '## Identity', required: false },
  { name: 'AGENTS.md', header: '## Agents', required: false },
  { name: 'USER.md', header: '## User', required: false },
  { name: 'TOOLS.md', header: '## Tools', required: false },
  { name: 'MEMORY.md', header: '## Memory', required: false, maxChars: 50000 },
  { name: 'HEARTBEAT.md', header: '## Heartbeat', required: false, maxChars: 3000 }
];

function buildBasePrompt() {
  return `You are Phoenix Echo, an independent AIoperational steward built for Phoenix Electric LLC.

## Core Principles
- Be genuinely helpful, not performatively helpful
- Be direct and concise - skip the filler words
- Have opinions and personality - you're allowed to disagree
- Verify before acting - don't assume
- Quality over speed - always

## Safety
- Never delete files without explicit approval
- Ask before sending external communications
- When uncertain, ask first
- Respect stop/pause requests immediately

## Tools Available
You have access to tools for executing commands, reading/writing files, and searching.
Use them proactively to help the user.

## Current Date/Time
${new Date().toISOString()}
`;
}

/**
 * Load and truncate a file
 */
async function loadFile(path, maxChars = null) {
  if (!existsSync(path)) {
    return null;
  }

  let content = await readFile(path, 'utf-8');
  
  if (maxChars && content.length > maxChars) {
    content = content.substring(0, maxChars) + '\n...(truncated)';
  }

  return content.trim();
}

/**
 * Assemble the full system prompt from workspace files
 */
export async function loadSystemPrompt(workspace) {
  const now = Date.now();
  const cached = _promptCacheMap.get(workspace);
  if (cached && now - cached.time < PROMPT_CACHE_TTL_MS) {
    return cached.prompt;
  }

  const sections = [buildBasePrompt()];
  const loaded = [];
  const missing = [];

  for (const file of WORKSPACE_FILES) {
    const path = join(workspace, file.name);
    try {
      const content = await loadFile(path, file.maxChars);
      if (content) {
        sections.push(`\n${file.header}\n${content}`);
        loaded.push(file.name);
      } else {
        missing.push(file.name);
        if (file.required) {
          console.warn(`[Prompt] Required file missing: ${file.name}`);
        } else {
          console.log(`[Prompt] Optional file missing: ${file.name}`);
        }
      }
    } catch (error) {
      missing.push(file.name);
      console.warn(`[Prompt] Failed loading ${file.name}: ${error.message}`);
    }
  }

  // Add memory files from memory/ directory
  const memoryDir = join(workspace, 'memory');
  if (existsSync(memoryDir)) {
    const today = new Date().toISOString().split('T')[0];
    const todayFile = join(memoryDir, `${today}.md`);
    
    if (existsSync(todayFile)) {
      const todayContent = await loadFile(todayFile, 3000);
      if (todayContent) {
        sections.push(`\n## Today's Notes (${today})\n${todayContent}`);
      }
    }
  }

  const fullPrompt = sections.join('\n\n');
  console.log(
    `[Prompt] Workspace load summary: loaded=${loaded.length} [${loaded.join(', ') || 'none'}] missing=${missing.length} [${missing.join(', ') || 'none'}]`
  );
  console.log(`[Prompt] Assembled system prompt: ${fullPrompt.length} chars`);

  _promptCacheMap.set(workspace, { prompt: fullPrompt, time: Date.now() });

  return fullPrompt;
}

export default { loadSystemPrompt };
