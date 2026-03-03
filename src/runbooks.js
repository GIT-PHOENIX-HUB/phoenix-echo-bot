import { readdir, readFile, stat } from 'fs/promises';
import { basename, join } from 'path';

const FALLBACK_SOURCE = 'fallback-manifest';
const AZURE_RECON_PATTERN = /^azure-recon-\d{4}-\d{2}-\d{2}\.md$/i;

const FALLBACK_RUNBOOKS = [
  { name: 'PhoenixAiCommand', account: 'Phoenix-Ai-Command' },
  { name: 'ProcessEmails', account: 'PhoenixMailCourier' },
  { name: 'teamsonenotecosmos', account: 'PhoenixMailCourier' },
  { name: 'estimatefollowup', account: 'PhoenixMailCourier' },
  { name: 'pricebooksync', account: 'PhoenixMailCourier' },
  { name: 'approvalworkflow', account: 'PhoenixMailCourier' },
  { name: 'customerfoldercreation', account: 'PhoenixMailCourier' },
  { name: 'morningreport', account: 'PhoenixMailCourier' },
  { name: 'TechnicianDailyReports', account: 'PhoenixMailCourier' },
  { name: 'SecurityMonitoring', account: 'PhoenixMailCourier' },
  { name: 'WeeklyAIReport', account: 'PhoenixMailCourier' },
  { name: 'MaintenanceCleanup', account: 'PhoenixMailCourier' },
  { name: 'InvoiceCollection', account: 'PhoenixMailCourier' }
];

function normalizeRunbookName(raw) {
  return String(raw || '')
    .replace(/\s*\(tutorial\)\s*/gi, '')
    .trim();
}

function keyOf(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function classifyRunbook(name) {
  const value = String(name || '');
  if (/security|monitor/i.test(value)) {
    return { stream: 'Security', cadence: 'Continuous' };
  }
  if (/invoice|estimate|approval|pricebook|collection/i.test(value)) {
    return { stream: 'Revenue', cadence: 'Daily' };
  }
  if (/email|teams|onenote|report/i.test(value)) {
    return { stream: 'Communication', cadence: 'Daily' };
  }
  if (/maintenance|cleanup/i.test(value)) {
    return { stream: 'Maintenance', cadence: 'Weekly' };
  }
  if (/folder|sync|command/i.test(value)) {
    return { stream: 'Operations', cadence: 'On demand' };
  }
  return { stream: 'General', cadence: 'On demand' };
}

function parseRunbookSection(markdown) {
  const lines = String(markdown || '').split(/\r?\n/);
  const parsed = [];
  let inSection = false;
  let account = 'Unassigned';

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!inSection) {
      if (/^##\s+Runbooks\b/i.test(line)) {
        inSection = true;
      }
      continue;
    }

    if (/^##\s+/.test(line)) {
      break;
    }

    const accountMatch = line.match(/^\*\*(.+?)\:\*\*$/);
    if (accountMatch) {
      account = accountMatch[1].trim();
      continue;
    }

    const bulletMatch = line.match(/^\-\s+(.+)$/);
    if (!bulletMatch) {
      continue;
    }

    const rawName = bulletMatch[1].trim();
    const tutorial = /tutorial/i.test(rawName);
    const name = normalizeRunbookName(rawName);
    if (!name) {
      continue;
    }
    parsed.push({ name, account, tutorial });
  }

  return parsed;
}

function buildReport(records, source, capturedAt, reason = null) {
  const tutorialCount = records.filter((item) => item.tutorial).length;
  const operational = records.filter((item) => !item.tutorial);

  const deduped = new Map();
  for (const runbook of operational) {
    const key = keyOf(runbook.name);
    if (!key) continue;
    if (!deduped.has(key)) {
      deduped.set(key, {
        id: key,
        name: runbook.name,
        account: runbook.account,
        sources: [runbook.account]
      });
      continue;
    }
    const existing = deduped.get(key);
    if (!existing.sources.includes(runbook.account)) {
      existing.sources.push(runbook.account);
    }
  }

  const runbooks = Array.from(deduped.values()).map((runbook) => {
    const category = classifyRunbook(runbook.name);
    return {
      ...runbook,
      stream: category.stream,
      cadence: category.cadence,
      status: 'Ready'
    };
  });

  runbooks.sort((left, right) => left.name.localeCompare(right.name));

  return {
    source,
    capturedAt: capturedAt || null,
    reason,
    rawCount: records.length,
    tutorialCount,
    duplicateCount: operational.length - runbooks.length,
    operationalCount: runbooks.length,
    runbooks
  };
}

async function resolveReconFile(workspaceRoot) {
  const memoryDir = join(workspaceRoot, 'memory');
  const entries = await readdir(memoryDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && AZURE_RECON_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .reverse();

  if (files.length === 0) {
    return null;
  }

  return join(memoryDir, files[0]);
}

export async function loadRunbookOverview(workspaceRoot) {
  try {
    const reconFile = await resolveReconFile(workspaceRoot);
    if (!reconFile) {
      return buildReport(
        FALLBACK_RUNBOOKS.map((entry) => ({ ...entry, tutorial: false })),
        FALLBACK_SOURCE,
        null,
        'azure_recon_file_not_found'
      );
    }

    const [markdown, fileStats] = await Promise.all([
      readFile(reconFile, 'utf8'),
      stat(reconFile)
    ]);

    const parsed = parseRunbookSection(markdown);
    if (parsed.length === 0) {
      return buildReport(
        FALLBACK_RUNBOOKS.map((entry) => ({ ...entry, tutorial: false })),
        FALLBACK_SOURCE,
        null,
        'runbook_section_not_found'
      );
    }

    return buildReport(parsed, basename(reconFile), fileStats.mtime.toISOString());
  } catch {
    return buildReport(
      FALLBACK_RUNBOOKS.map((entry) => ({ ...entry, tutorial: false })),
      FALLBACK_SOURCE,
      null,
      'runbook_overview_load_failed'
    );
  }
}

