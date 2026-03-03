import { mkdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';

const BLUEPRINT_VERSION = 4;

const PHASES = [
  {
    id: '2',
    title: 'Part 2 - SharePoint File Structure',
    summary: 'Root architecture, AI memory spine, routing, and access control.'
  },
  {
    id: '3',
    title: 'Part 3 - Teams / OneNote / Cosmos',
    summary: 'Collaboration channels, note system, fast memory, and morning orchestration.'
  },
  {
    id: '4',
    title: 'Part 4 - Command Orchestrator Brain',
    summary: 'Agent routing core, approval gates, failure safeguards, and tool governance.'
  },
  {
    id: '5',
    title: 'Part 5 - Morning Report System',
    summary: 'Daily intelligence briefing with multi-channel delivery and trend memory.'
  }
];

const ROOT_FOLDERS = [
  '_AI_MEMORY',
  'CONSTRUCTION',
  'SERVICE',
  'ACCOUNTING',
  'VENDORS',
  'EMAIL_ARCHIVE',
  'REPORTS',
  'PRICEBOOK',
  'EMPLOYEES',
  'INTERNAL'
];

const ACTIVE_BUILDERS = [
  '303_Development',
  'Chase_Development',
  'FGH_',
  'MAG',
  'Raptor',
  'Zelinka',
  'Wild_and_Mild',
  'North_Point'
];

const VENDORS = [
  'Rexel',
  'Home_Depot',
  'Graybar',
  'CES',
  'CED',
  'Lowes'
];

const EMAIL_ROUTING = [
  {
    category: 'INTERNAL',
    routeTo: '/EMAIL_ARCHIVE/{date}/{mailbox}/'
  },
  {
    category: 'RECEIPT_INVOICE',
    routeTo: '/VENDORS/{vendor}/Invoices/ OR /SERVICE/{customer}/Invoices/'
  },
  {
    category: 'CUSTOMER_SCHEDULING',
    routeTo: '/SERVICE/{customer}/Correspondence/'
  },
  {
    category: 'VENDOR',
    routeTo: '/VENDORS/{vendor}/'
  },
  {
    category: 'GENERAL',
    routeTo: '/EMAIL_ARCHIVE/Triage/'
  }
];

const SHAREPOINT_GRAPH_ENDPOINTS = [
  {
    operation: 'Create folder',
    endpoint: 'POST /drives/{id}/items/{parent}/children'
  },
  {
    operation: 'Upload file',
    endpoint: 'PUT /drives/{id}/items/{parent}:/{filename}:/content'
  },
  {
    operation: 'Read file',
    endpoint: 'GET /drives/{id}/items/{id}/content'
  },
  {
    operation: 'Search',
    endpoint: "GET /drives/{id}/root/search(q='{query}')"
  },
  {
    operation: 'List children',
    endpoint: 'GET /drives/{id}/items/{id}/children'
  }
];

const ACCESS_MATRIX = [
  {
    folder: '_AI_MEMORY',
    shane: 'Full',
    stephanie: 'Read',
    foremen: 'Limited',
    field: 'None'
  },
  {
    folder: 'CONSTRUCTION',
    shane: 'Full',
    stephanie: 'Full',
    foremen: 'Their jobs',
    field: 'Their jobs'
  },
  {
    folder: 'SERVICE',
    shane: 'Full',
    stephanie: 'Full',
    foremen: 'Read',
    field: 'None'
  },
  {
    folder: 'ACCOUNTING',
    shane: 'Full',
    stephanie: 'Full',
    foremen: 'None',
    field: 'None'
  },
  {
    folder: 'VENDORS',
    shane: 'Full',
    stephanie: 'Full',
    foremen: 'Read',
    field: 'None'
  },
  {
    folder: 'REPORTS',
    shane: 'Full',
    stephanie: 'Full',
    foremen: 'Weekly only',
    field: 'None'
  },
  {
    folder: 'EMPLOYEES',
    shane: 'Full',
    stephanie: 'HR only',
    foremen: 'Own folder',
    field: 'Own folder'
  }
];

const TEAMS_CHANNELS = [
  { name: 'General', purpose: 'Standard team chat' },
  { name: 'AI-Updates', purpose: 'Morning reports and AI status' },
  { name: 'Scheduling', purpose: 'Schedule changes and dispatch updates' },
  { name: 'Urgent-Alerts', purpose: 'Escalations and failure alerts' },
  { name: 'Estimate-Requests', purpose: 'Incoming estimate requests' },
  { name: 'Daily-Reports', purpose: 'Employee end-of-day reports' }
];

const TEAMS_GRAPH_PERMISSIONS = [
  { name: 'ChannelMessage.Send', type: 'Application', purpose: 'Post to channels' },
  { name: 'Team.ReadBasic.All', type: 'Application', purpose: 'Read team metadata' },
  { name: 'Channel.ReadBasic.All', type: 'Application', purpose: 'Read channel metadata' },
  { name: 'TeamsActivity.Send', type: 'Application', purpose: 'Send activity notifications' }
];

const ONENOTE_SECTIONS = [
  'Daily Logs',
  'Customer Quick Notes',
  'AI Learning',
  "Shane's Instructions",
  'Meeting Notes'
];

const ONENOTE_GRAPH_PERMISSIONS = [
  { name: 'Notes.ReadWrite.All', type: 'Application', purpose: 'Full notebook access' },
  { name: 'Notes.Create', type: 'Application', purpose: 'Create pages/sections' }
];

const COSMOS_CONTAINERS = [
  {
    name: 'customers',
    partitionKey: '/partitionKey',
    purpose: 'Customer profile and preference fast lookup'
  },
  {
    name: 'jobs',
    partitionKey: '/partitionKey',
    purpose: 'Job status and assignment data'
  },
  {
    name: 'interactions',
    partitionKey: '/partitionKey',
    purpose: 'Cross-channel interaction events and follow-ups'
  },
  {
    name: 'aiLearnings',
    partitionKey: '/partitionKey',
    purpose: 'Patterns, baselines, and learned recommendations'
  },
  {
    name: 'voiceProfiles',
    partitionKey: '/partitionKey',
    purpose: 'Tone, phrase, and response style templates'
  }
];

const MORNING_REPORT_FLOW = [
  'Trigger at 7:00 AM',
  'Gather ServiceTitan jobs, estimates, invoices',
  'Invoke Courier for prior 12-hour email summary',
  'Query Cosmos for pending follow-ups and patterns',
  'Build morning report payload',
  'Post to Teams #AI-Updates',
  'Create/update OneNote Daily Log page',
  "Upsert today's baseline into Cosmos",
  'Email summary to Shane and Stephanie'
];

const MORNING_REPORT_QUESTIONS = [
  "What's on the schedule today?",
  'What money is outstanding?',
  'What estimates need follow-up?',
  'What emails came in overnight?',
  'What does the AI recommend focusing on?'
];

const MORNING_REPORT_DATA_SOURCES = [
  'ServiceTitan (jobs, estimates, invoices, technicians, memberships)',
  'ProcessEmails overnight output',
  'Cosmos DB patterns and history'
];

const MORNING_REPORT_DELIVERY_CHANNELS = [
  {
    channel: 'Teams #AI-Updates',
    artifact: 'Adaptive Card summary'
  },
  {
    channel: 'Email',
    artifact: 'Full HTML report to Shane + Stephanie'
  },
  {
    channel: 'OneNote Daily Logs',
    artifact: 'Archived copy'
  },
  {
    channel: 'Cosmos DB',
    artifact: 'Daily metrics for trend analysis'
  }
];

const MORNING_REPORT_SECTIONS = [
  'Today at a Glance',
  'AI Recommendations',
  "Today's Schedule",
  'Financial Snapshot',
  'Overnight Email Summary',
  'Estimates Needing Attention',
  'Membership Renewals This Week',
  'Weekly Trend'
];

const MORNING_REPORT_RUNBOOK = {
  name: 'MorningReport',
  path: 'automation/runbooks/MorningReport.ps1',
  runtime: 'PS72-Courier',
  version: '1.0.0',
  schedule: {
    frequency: 'Weekdays',
    localTime: '07:00',
    timezone: 'America/Denver'
  },
  deliveryFunctions: [
    'Build-TextReport',
    'Build-HtmlReport',
    'Build-TeamsCard',
    'Send-TeamsReport',
    'Send-EmailReport',
    'Save-ReportToSharePoint',
    'Save-ReportToOneNote',
    'Save-MetricsToCosmos'
  ]
};

const V5_ALIGNMENT = {
  analysisDate: '2025-12-31',
  purpose: 'Map VERSION_FIVE_REVISED (6 consolidated Function Apps) to the 1-15 playbook.',
  keyInsight: 'Playbook agent references map to function-app deployment units; logic remains preserved.',
  compatibilityPct: 95,
  summary: 'Deployment architecture changed from runbooks to function apps while preserving playbook logic and golden rules.',
  functionAppTopology: [
    { app: 'fa-phoenix-coordination', tier: 'Premium EP1', role: 'orchestration + approvals' },
    { app: 'fa-phoenix-communications', tier: 'Premium EP1', role: 'email + Teams + OneNote' },
    { app: 'fa-phoenix-operations', tier: 'Premium EP1', role: 'ServiceTitan + SharePoint + morning report' },
    { app: 'fa-phoenix-financial', tier: 'Consumption', role: 'estimates + collections + pricebook' },
    { app: 'fa-phoenix-support', tier: 'Consumption', role: 'knowledge + campaign + policy support' },
    { app: 'fa-phoenix-monitoring', tier: 'Consumption', role: 'security + health + maintenance timers' }
  ],
  architectureDelta: {
    legacy: {
      compute: '10 Azure Automation runbooks',
      scheduleModel: 'Azure Automation schedules',
      runtime: 'PowerShell 7.2 (Automation)',
      estimatedMonthlyUsd: '65-105',
      coldStartProfile: '10-30 seconds'
    },
    revised: {
      compute: '6 Azure Function Apps',
      scheduleModel: 'Function timer triggers',
      runtime: 'PowerShell 7.2 (Functions)',
      estimatedMonthlyUsd: '687-922',
      coldStartProfile: '<1 second on Premium apps'
    }
  },
  costs: {
    legacy: {
      totalMonthlyUsd: '65-105',
      components: [
        { name: 'Azure Automation', amountMonthlyUsd: '35-75' },
        { name: 'Cosmos DB', amountMonthlyUsd: '25' },
        { name: 'Key Vault', amountMonthlyUsd: '5' }
      ]
    },
    revised: {
      totalMonthlyUsd: '687-922',
      components: [
        { name: 'Function Apps (3 Premium EP1)', amountMonthlyUsd: '519' },
        { name: 'Function Apps (3 Consumption)', amountMonthlyUsd: '60-130' },
        { name: 'Cosmos DB', amountMonthlyUsd: '25' },
        { name: 'Service Bus', amountMonthlyUsd: '10' },
        { name: 'Key Vault', amountMonthlyUsd: '5' },
        { name: 'Application Insights', amountMonthlyUsd: 'included' }
      ]
    }
  },
  preservedCapabilities: [
    '5-category email classification',
    '7-subfolder customer folder structure',
    '4-stage estimate follow-up (days 3/7/14/21)',
    '5-stage invoice collection (days 7/14/21/30/45)',
    '4-tier markup system (45/35/25/20)',
    'Approval workflow with risk levels',
    'Morning report at 7:00 AM',
    'All 13 Cosmos containers',
    'Golden rules for approval, retention, and audit'
  ],
  partAlignment: [
    { part: 'Part 1', status: 'aligned', note: 'Email workflows map to fa-phoenix-communications' },
    { part: 'Part 2', status: 'aligned', note: 'SharePoint folder model preserved' },
    { part: 'Part 3', status: 'aligned', note: 'Teams/OneNote/Cosmos integrations preserved' },
    { part: 'Part 4', status: 'mapped', note: 'Automation schedules mapped to timer triggers' },
    { part: 'Part 5', status: 'aligned', note: 'Morning report channels preserved' },
    { part: 'Part 6', status: 'enhanced', note: 'Dynamic amount-based risk tiers added' },
    { part: 'Part 7', status: 'aligned', note: 'Customer auto-folder creation preserved' },
    { part: 'Part 8', status: 'aligned', note: 'Estimate follow-up cadence preserved' },
    { part: 'Part 9', status: 'aligned', note: 'Invoice collection cadence preserved' },
    { part: 'Part 10', status: 'aligned', note: 'Pricebook and markup logic preserved' },
    { part: 'Part 11', status: 'aligned', note: 'Technician daily reports preserved' },
    { part: 'Part 12', status: 'enhanced', note: 'OpenTelemetry and circuit-breaker additions' },
    { part: 'Part 13', status: 'aligned', note: 'Teams bot and email interface remain compatible' },
    { part: 'Part 14', status: 'update_required', note: 'Deployment docs must move from runbooks to functions' },
    { part: 'Part 15', status: 'update_required', note: 'Ops and cost guidance must reflect Premium function footprint' }
  ],
  updateBacklog: {
    high: [
      'Update Part 14 deployment checklist to Function App deployment commands',
      'Update Part 15 maintenance and cost guidance to revised monthly range'
    ],
    medium: [
      'Update Part 4 schedule table to function timer CRON expressions',
      'Update Part 6 approval docs with amount-based risk tiering'
    ],
    low: [
      'Update Part 12 docs with OpenTelemetry, App Insights, and circuit breaker notes'
    ]
  },
  scheduleMapping: [
    { legacy: 'ProcessEmails (5 min)', revised: 'fa-phoenix-communications / Process-Email' },
    { legacy: 'MorningReport (7:00 AM)', revised: 'fa-phoenix-operations / Generate-MorningReport' },
    { legacy: 'EstimateFollowUp (9:00 AM)', revised: 'fa-phoenix-financial / Process-EstimateFollowUp' },
    { legacy: 'InvoiceCollection (10:00 AM)', revised: 'fa-phoenix-financial / Process-InvoiceCollection' },
    { legacy: 'CustomerFolderSync (11:00 AM)', revised: 'fa-phoenix-operations / Sync-CustomerFolders' },
    { legacy: 'PricebookSync (2:00 AM)', revised: 'fa-phoenix-financial / Sync-Pricebook' },
    { legacy: 'TechDailyReports (6:00 PM)', revised: 'fa-phoenix-monitoring / Generate-TechReports' },
    { legacy: 'SecurityMonitor (15 min)', revised: 'fa-phoenix-monitoring / Scan-Security' },
    { legacy: 'DailySecurityReport (11:00 PM)', revised: 'fa-phoenix-monitoring / Generate-SecurityReport' },
    { legacy: 'MaintenanceCleanup (3:00 AM)', revised: 'fa-phoenix-monitoring / Run-Cleanup' }
  ],
  scheduleCronMapping: [
    { name: 'ProcessEmails', time: 'Every 5 min', cron: '0 */5 * * * *' },
    { name: 'MorningReport', time: '7:00 AM weekdays', cron: '0 0 7 * * 1-5' },
    { name: 'EstimateFollowUp', time: '9:00 AM weekdays', cron: '0 0 9 * * 1-5' },
    { name: 'InvoiceCollection', time: '10:00 AM weekdays', cron: '0 0 10 * * 1-5' },
    { name: 'CustomerFolderSync', time: '11:00 AM weekdays', cron: '0 0 11 * * 1-5' },
    { name: 'PricebookSync', time: '2:00 AM daily', cron: '0 0 2 * * *' },
    { name: 'TechDailyReports', time: '6:00 PM weekdays', cron: '0 0 18 * * 1-5' },
    { name: 'SecurityMonitor', time: 'Every 15 min', cron: '0 */15 * * * *' },
    { name: 'DailySecurityReport', time: '11:00 PM daily', cron: '0 0 23 * * *' },
    { name: 'MaintenanceCleanup', time: '3:00 AM daily', cron: '0 0 3 * * *' }
  ],
  agentToFunctionApp: [
    { legacyAgent: 'Phoenix Command Orchestrator', revisedApp: 'fa-phoenix-coordination' },
    { legacyAgent: 'Approval Gateway', revisedApp: 'fa-phoenix-coordination' },
    { legacyAgent: 'Phoenix Courier', revisedApp: 'fa-phoenix-communications' },
    { legacyAgent: 'ServiceTitan Director', revisedApp: 'fa-phoenix-operations' },
    { legacyAgent: 'SharePoint Director', revisedApp: 'fa-phoenix-operations' },
    { legacyAgent: 'Quote Generator', revisedApp: 'fa-phoenix-financial' },
    { legacyAgent: 'Finance Analyst', revisedApp: 'fa-phoenix-financial' },
    { legacyAgent: 'Schedule Coordinator', revisedApp: 'fa-phoenix-financial' },
    { legacyAgent: 'Marketing Agent', revisedApp: 'fa-phoenix-support' },
    { legacyAgent: 'Knowledge Builder', revisedApp: 'fa-phoenix-support' },
    { legacyAgent: 'Security Sentinel', revisedApp: 'fa-phoenix-support' },
    { legacyAgent: 'Health Monitor', revisedApp: 'fa-phoenix-monitoring' },
    { legacyAgent: 'Audit Logger', revisedApp: 'fa-phoenix-monitoring' }
  ],
  preservedCosmosContainers: [
    { name: 'customers', part: 'Part 3', app: 'fa-phoenix-operations' },
    { name: 'jobs', part: 'Part 3', app: 'fa-phoenix-operations' },
    { name: 'interactions', part: 'Part 3', app: 'fa-phoenix-coordination' },
    { name: 'aiLearnings', part: 'Part 3', app: 'fa-phoenix-support' },
    { name: 'voiceProfiles', part: 'Part 3', app: 'future' },
    { name: 'approvals', part: 'Part 6', app: 'fa-phoenix-coordination' },
    { name: 'estimate_tracking', part: 'Part 8', app: 'fa-phoenix-financial' },
    { name: 'invoice_tracking', part: 'Part 9', app: 'fa-phoenix-financial' },
    { name: 'pricebook', part: 'Part 10', app: 'fa-phoenix-financial' },
    { name: 'rexel_pricing', part: 'Part 10', app: 'fa-phoenix-financial' },
    { name: 'tech_daily', part: 'Part 11', app: 'fa-phoenix-monitoring' },
    { name: 'security_events', part: 'Part 12', app: 'fa-phoenix-monitoring' },
    { name: 'security_alerts', part: 'Part 12', app: 'fa-phoenix-monitoring' }
  ],
  keyVaultSecretMatrix: [
    { secret: 'COSMOS-DB-KEY', usedBy: 'all function apps' },
    { secret: 'GRAPH-CLIENT-ID', usedBy: 'fa-phoenix-communications, fa-phoenix-operations' },
    { secret: 'GRAPH-CLIENT-SECRET', usedBy: 'fa-phoenix-communications, fa-phoenix-operations' },
    { secret: 'ST-CLIENT-ID', usedBy: 'fa-phoenix-operations, fa-phoenix-financial' },
    { secret: 'ST-CLIENT-SECRET', usedBy: 'fa-phoenix-operations, fa-phoenix-financial' },
    { secret: 'TEAMS-WEBHOOK-URL', usedBy: 'fa-phoenix-communications' },
    { secret: 'REXEL-API-KEY', usedBy: 'fa-phoenix-financial' },
    { secret: 'ANTHROPIC-API-KEY', usedBy: 'fa-phoenix-coordination' }
  ],
  goldenRulesMatrix: [
    {
      rule: 'Never auto-send external emails',
      playbook: 'Part 1, Part 6',
      implementation: 'Draft-Email + Request-Approval gate'
    },
    {
      rule: 'Never delete data (archive only)',
      playbook: 'Part 3',
      implementation: 'Archive patterns and no destructive delete flows'
    },
    {
      rule: 'All write operations require approval',
      playbook: 'Part 6',
      implementation: 'Approval checks before write workflows'
    },
    {
      rule: 'Full audit trail',
      playbook: 'Part 3, Part 12',
      implementation: 'Write-AuditLog on operations and decisions'
    },
    {
      rule: '3-failure rule / circuit breaker',
      playbook: 'Part 12',
      implementation: 'Circuit-breaker and escalation patterns'
    }
  ],
  preservedContainerCount: 13,
  migrationPhases: [
    'Phase 1: Parallel deployment (weeks 1-2)',
    'Phase 2: Validation (weeks 3-4)',
    'Phase 3: Cutover (weeks 5-6)',
    'Phase 4: Cleanup (weeks 7-8)'
  ]
};

const ORCHESTRATOR_LAYERS = {
  input: [
    'HTTP Trigger',
    'Teams Bot',
    'Scheduled Trigger',
    'Webhook Trigger'
  ],
  routing: [
    'Intent Parser',
    'Agent Selector',
    'Tool Matcher',
    'Approval Gate'
  ],
  output: [
    'Structured Response',
    'Teams Post',
    'Email Draft/Send',
    'File Save'
  ]
};

const ORCHESTRATOR_AGENT_REGISTRY = [
  {
    id: 'servicetitan_director',
    name: 'ServiceTitan Director',
    tools: 75,
    writeCapable: true,
    approvalRequired: true,
    triggerKeywords: ['customer', 'job', 'invoice', 'estimate', 'dispatch']
  },
  {
    id: 'phoenix_courier',
    name: 'Phoenix Courier',
    tools: 12,
    writeCapable: true,
    approvalRequired: true,
    triggerKeywords: ['email', 'mail', 'calendar', 'teams', 'inbox']
  },
  {
    id: 'finance_analyst',
    name: 'Finance Analyst',
    tools: 18,
    writeCapable: true,
    approvalRequired: true,
    triggerKeywords: ['quickbooks', 'accounting', 'invoice', 'payment', 'margin']
  },
  {
    id: 'code_reviewer',
    name: 'Code Reviewer',
    tools: 8,
    writeCapable: true,
    approvalRequired: false,
    triggerKeywords: ['code', 'github', 'pull request', 'review', 'deploy']
  },
  {
    id: 'pricing_analyst',
    name: 'Pricing Analyst',
    tools: 14,
    writeCapable: true,
    approvalRequired: true,
    triggerKeywords: ['price', 'pricebook', 'rexel', 'cost', 'markup']
  },
  {
    id: 'quote_generator',
    name: 'Quote Generator',
    tools: 10,
    writeCapable: true,
    approvalRequired: true,
    triggerKeywords: ['quote', 'proposal', 'estimate', 'bid', 'takeoff']
  },
  {
    id: 'schedule_coordinator',
    name: 'Schedule Coordinator',
    tools: 11,
    writeCapable: true,
    approvalRequired: true,
    triggerKeywords: ['schedule', 'dispatch', 'route', 'appointment', 'ETA']
  },
  {
    id: 'security_sentinel',
    name: 'Security Sentinel',
    tools: 9,
    writeCapable: false,
    approvalRequired: false,
    triggerKeywords: ['security', 'audit', 'anomaly', 'access', 'token']
  },
  {
    id: 'compliance_auditor',
    name: 'Compliance Auditor',
    tools: 7,
    writeCapable: false,
    approvalRequired: false,
    triggerKeywords: ['NEC', 'permit', 'inspection', 'compliance', 'safety']
  },
  {
    id: 'knowledge_keeper',
    name: 'Knowledge Keeper',
    tools: 6,
    writeCapable: true,
    approvalRequired: false,
    triggerKeywords: ['memory', 'history', 'context', 'pattern', 'preference']
  }
];

const ORCHESTRATOR_TOOLSET = {
  declaredMcpRegistryTotal: 75,
  declaredToolCapacityByAgent: ORCHESTRATOR_AGENT_REGISTRY.reduce((sum, agent) => sum + agent.tools, 0),
  catalogedToolFamilies: {
    servicetitanDirector: 70,
    courier: 12,
    knowledgeKeeper: 6
  },
  notes: [
    'Playbook declares 75 MCP tools globally.',
    'Agent registry capacities exceed 75; treat 75 as current hard governance target until reconciliation.'
  ]
};

const ORCHESTRATOR_CONTROL_RULES = [
  'Never auto-send external email without approval',
  'All write operations pass approval gate unless explicitly exempt',
  'Three consecutive failures trigger escalation workflow',
  'Log every operation and decision path'
];

const ORCHESTRATOR_APPROVAL_EXCEPTIONS = [
  'courier_create_draft',
  'courier_post_teams (internal channels)',
  'st_customer_add_note'
];

const ORCHESTRATOR_FAILURE_RULE = {
  maxConsecutiveFailures: 3,
  escalationChannel: 'Urgent-Alerts',
  escalationType: '3_FAILURE_ESCALATION'
};

const AUTOMATION_VARIABLES = [
  { name: 'VaultName', value: 'phoenixaaivault', type: 'String' },
  { name: 'TenantId', value: 'e7d8daef-fd5b-4e0b-bf8f-32f090c7c4d5', type: 'String' },
  { name: 'CourierAppId', value: '8b78f443-e000-4689-ad57-71e4e616960f', type: 'String' },
  { name: 'CourierSecretName', value: 'PhoenixMailCourierSecret', type: 'String' },
  { name: 'MailboxCsv', value: 'shane;jmaier;smowbray;contact;accounting', type: 'String' },
  { name: 'MaxPerMailbox', value: '25', type: 'Integer' },
  { name: 'DaysBack', value: '7', type: 'Integer' },
  { name: 'DraftRepliesEnabled', value: 'false', type: 'Boolean' },
  { name: 'TeamsWebhook_AIUpdates', value: 'https://...', type: 'String' },
  { name: 'TeamsWebhook_UrgentAlerts', value: 'https://...', type: 'String' }
];

const KEY_VAULT_SECRETS = [
  'SERVICETITAN-TENANT-ID',
  'SERVICETITAN-CORE-CLIENT-ID',
  'SERVICETITAN-CORE-SECRET',
  'SERVICETITAN-CORE-APP-KEY',
  'PhoenixMailCourierSecret',
  'COSMOS-DB-KEY',
  'GRAPH-CLIENT-ID',
  'GRAPH-CLIENT-SECRET'
];

const PART2_STEP_DEFS = [
  { id: '2.1', task: 'Create root folders' },
  { id: '2.2', task: 'Create _AI_MEMORY structure' },
  { id: '2.3', task: 'Create CONSTRUCTION/Active_Builders (8 builders)' },
  { id: '2.4', task: 'Create VENDORS (6 vendors)' },
  { id: '2.5', task: 'Import Report_customer.xlsx -> create ~1700 SERVICE folders' },
  { id: '2.6', task: 'Configure Graph API Sites.Selected permission' },
  { id: '2.7', task: 'Update ProcessEmails to route attachments' }
];

const PART3_STEP_DEFS = [
  { id: '3.1', task: 'Create Teams channels (AI-Updates, Scheduling, etc.)' },
  { id: '3.2', task: 'Set up incoming webhooks for each channel' },
  { id: '3.3', task: 'Get Team ID and Channel IDs' },
  { id: '3.4', task: 'Create OneNote notebook "Phoenix AI Notebook"' },
  { id: '3.5', task: 'Create OneNote sections (Daily Logs, Customer Notes, etc.)' },
  { id: '3.6', task: 'Get OneNote Section IDs' },
  { id: '3.7', task: 'Create Cosmos DB account (serverless)' },
  { id: '3.8', task: 'Create database and 5 containers' },
  { id: '3.9', task: 'Store Cosmos DB key in Key Vault' },
  { id: '3.10', task: 'Test Teams posting' },
  { id: '3.11', task: 'Test OneNote page creation' },
  { id: '3.12', task: 'Test Cosmos DB read/write' },
  { id: '3.13', task: 'Integrate into Command Orchestrator' }
];

const PART4_STEP_DEFS = [
  { id: '4.1', task: 'Create Automation Variables (10 items)' },
  { id: '4.2', task: 'Deploy Command Orchestrator runbook' },
  { id: '4.3', task: 'Test health check operation' },
  { id: '4.4', task: 'Test ServiceTitan customer search' },
  { id: '4.5', task: 'Test ServiceTitan estimates query' },
  { id: '4.6', task: 'Test Mail Courier integration' },
  { id: '4.7', task: 'Test approval gate (write operation)' },
  { id: '4.8', task: 'Test 3-failure rule' },
  { id: '4.9', task: 'Create HTTP trigger for external calls' },
  { id: '4.10', task: 'Create scheduled trigger for morning report' }
];

const PART5_STEP_DEFS = [
  { id: '5.1', task: 'Create MorningReport.ps1 runbook' },
  { id: '5.2', task: 'Add GRAPH-CLIENT-ID secret to Key Vault' },
  { id: '5.3', task: 'Add GRAPH-CLIENT-SECRET secret to Key Vault' },
  { id: '5.4', task: 'Create TeamsWebhook_AIUpdates automation variable' },
  { id: '5.5', task: 'Create TeamsWebhook_UrgentAlerts automation variable' },
  { id: '5.6', task: 'Create Teams incoming webhook for #AI-Updates' },
  { id: '5.7', task: 'Create Teams incoming webhook for #Urgent-Alerts' },
  { id: '5.8', task: 'Test runbook manually' },
  { id: '5.9', task: 'Create weekday 7 AM schedule' },
  { id: '5.10', task: 'Link runbook to schedule' },
  { id: '5.11', task: 'Monitor first automated run' }
];

const IMPLEMENTATION_STEPS = [
  ...PART2_STEP_DEFS.map((step) => ({ ...step, phase: '2' })),
  ...PART3_STEP_DEFS.map((step) => ({ ...step, phase: '3' })),
  ...PART4_STEP_DEFS.map((step) => ({ ...step, phase: '4' })),
  ...PART5_STEP_DEFS.map((step) => ({ ...step, phase: '5' }))
];

const VALID_STEP_STATUS = new Set([
  'pending',
  'in_progress',
  'completed',
  'blocked'
]);
const DEFAULT_STEP_STATUS = 'pending';

function progressFilePath(workspaceRoot) {
  return join(workspaceRoot, '.phoenix-sessions', 'ai-brain-progress.json');
}

function createDefaultProgress() {
  const steps = {};
  for (const step of IMPLEMENTATION_STEPS) {
    steps[step.id] = {
      status: DEFAULT_STEP_STATUS,
      note: '',
      updatedAt: null
    };
  }

  return {
    version: BLUEPRINT_VERSION,
    steps
  };
}

function normalizeStatus(value) {
  const status = String(value || '').trim().toLowerCase();
  return VALID_STEP_STATUS.has(status) ? status : DEFAULT_STEP_STATUS;
}

function normalizeProgress(raw) {
  const base = createDefaultProgress();
  const inputSteps = raw?.steps && typeof raw.steps === 'object' ? raw.steps : {};

  for (const step of IMPLEMENTATION_STEPS) {
    const row = inputSteps[step.id];
    if (!row || typeof row !== 'object') {
      continue;
    }
    base.steps[step.id] = {
      status: normalizeStatus(row.status),
      note: typeof row.note === 'string' ? row.note.trim() : '',
      updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : null
    };
  }

  return base;
}

async function readProgress(workspaceRoot) {
  const filePath = progressFilePath(workspaceRoot);
  try {
    const raw = await readFile(filePath, 'utf8');
    return normalizeProgress(JSON.parse(raw));
  } catch {
    return createDefaultProgress();
  }
}

async function writeProgress(workspaceRoot, progress) {
  const filePath = progressFilePath(workspaceRoot);
  await mkdir(join(workspaceRoot, '.phoenix-sessions'), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(progress, null, 2)}\n`, 'utf8');
}

function summarizeSteps(steps) {
  const totalSteps = steps.length;
  const completedSteps = steps.filter((step) => step.status === 'completed').length;
  const inProgressSteps = steps.filter((step) => step.status === 'in_progress').length;
  const blockedSteps = steps.filter((step) => step.status === 'blocked').length;
  const pendingSteps = steps.filter((step) => step.status === 'pending').length;
  const completionPct = totalSteps > 0
    ? Math.round((completedSteps / totalSteps) * 100)
    : 0;

  return {
    totalSteps,
    completedSteps,
    inProgressSteps,
    blockedSteps,
    pendingSteps,
    completionPct
  };
}

function summarizeByPhase(steps) {
  const output = {};
  for (const phase of PHASES) {
    const items = steps.filter((step) => step.phase === phase.id);
    output[phase.id] = {
      id: phase.id,
      title: phase.title,
      summary: phase.summary,
      ...summarizeSteps(items)
    };
  }
  return output;
}

function phaseTitleById(phaseId) {
  const match = PHASES.find((phase) => phase.id === phaseId);
  return match ? match.title : `Phase ${phaseId}`;
}

export async function getBrainBlueprint(workspaceRoot) {
  const progress = await readProgress(workspaceRoot);
  const steps = IMPLEMENTATION_STEPS.map((step) => {
    const row = progress.steps[step.id] || {};
    return {
      id: step.id,
      phase: step.phase,
      phaseTitle: phaseTitleById(step.phase),
      task: step.task,
      status: normalizeStatus(row.status),
      note: row.note || '',
      updatedAt: row.updatedAt || null
    };
  });

  return {
    version: BLUEPRINT_VERSION,
    phases: PHASES,
    sharepoint: {
      rootFolderCount: ROOT_FOLDERS.length,
      customerTarget: 1700,
      activeBuilderCount: ACTIVE_BUILDERS.length,
      vendorCount: VENDORS.length
    },
    teams: {
      channelCount: TEAMS_CHANNELS.length,
      channels: TEAMS_CHANNELS,
      graphPermissions: TEAMS_GRAPH_PERMISSIONS
    },
    onenote: {
      sectionCount: ONENOTE_SECTIONS.length,
      sections: ONENOTE_SECTIONS,
      graphPermissions: ONENOTE_GRAPH_PERMISSIONS
    },
    cosmos: {
      accountName: 'phoenix-ai-memory',
      databaseName: 'PhoenixMemory',
      containerCount: COSMOS_CONTAINERS.length,
      containers: COSMOS_CONTAINERS,
      estimatedMonthlyUsd: '5-10'
    },
    morningReport: {
      runbook: MORNING_REPORT_RUNBOOK,
      keyQuestions: MORNING_REPORT_QUESTIONS,
      dataSources: MORNING_REPORT_DATA_SOURCES,
      sections: MORNING_REPORT_SECTIONS,
      deliveryChannels: MORNING_REPORT_DELIVERY_CHANNELS,
      emailRecipients: [
        'shane@phoenixelectric.life',
        'smowbray@phoenixelectric.life'
      ]
    },
    alignment: V5_ALIGNMENT,
    orchestrator: {
      layers: ORCHESTRATOR_LAYERS,
      agents: ORCHESTRATOR_AGENT_REGISTRY,
      agentCount: ORCHESTRATOR_AGENT_REGISTRY.length,
      tools: ORCHESTRATOR_TOOLSET,
      controlRules: ORCHESTRATOR_CONTROL_RULES,
      approvalPolicy: {
        defaultWriteApprovalRequired: true,
        exemptTools: ORCHESTRATOR_APPROVAL_EXCEPTIONS
      },
      failureRule: ORCHESTRATOR_FAILURE_RULE,
      automationVariables: AUTOMATION_VARIABLES,
      keyVaultSecrets: KEY_VAULT_SECRETS,
      morningReportFlow: MORNING_REPORT_FLOW
    },
    rootFolders: ROOT_FOLDERS,
    activeBuilders: ACTIVE_BUILDERS,
    vendors: VENDORS,
    emailRouting: EMAIL_ROUTING,
    graphEndpoints: SHAREPOINT_GRAPH_ENDPOINTS,
    accessMatrix: ACCESS_MATRIX,
    steps,
    summary: summarizeSteps(steps),
    phaseSummary: summarizeByPhase(steps),
    progressFile: progressFilePath(workspaceRoot)
  };
}

export async function updateBrainChecklistStep(workspaceRoot, input = {}) {
  const stepId = String(input.stepId || '').trim();
  const status = normalizeStatus(input.status);
  const note = typeof input.note === 'string' ? input.note.trim() : '';

  const exists = IMPLEMENTATION_STEPS.some((step) => step.id === stepId);
  if (!exists) {
    throw new Error(`Unknown implementation step: ${stepId}`);
  }

  const progress = await readProgress(workspaceRoot);
  progress.steps[stepId] = {
    status,
    note,
    updatedAt: new Date().toISOString()
  };
  progress.version = BLUEPRINT_VERSION;
  await writeProgress(workspaceRoot, progress);

  return getBrainBlueprint(workspaceRoot);
}
