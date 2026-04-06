/**
 * Phoenix Echo Bot - Shared JSDoc Type Definitions
 *
 * Central type registry used across all modules. Import this file for
 * IDE autocompletion and documentation only -- it exports nothing at runtime.
 */

/**
 * @typedef {Object} NormalizedMessage
 * @property {string} id - Unique message identifier
 * @property {string} platform - Origin platform (teams|telegram|whatsapp|email|http|ws)
 * @property {string} channelId - Platform-specific channel / chat identifier
 * @property {string} userId - Platform-specific user identifier
 * @property {string} userName - Human-readable user name
 * @property {string} text - Plain-text message body
 * @property {Array<{type:string, url:string, name?:string}>} attachments - Attached media
 * @property {Object} metadata - Platform-specific extra data (e.g. adaptive card payload)
 * @property {string} timestamp - ISO-8601 timestamp
 */

/**
 * @typedef {Object} PlatformAdapter
 * @property {string} platform - Adapter platform name
 * @property {() => Promise<void>} init - Initialize the adapter
 * @property {() => Promise<void>} shutdown - Gracefully shut down the adapter
 * @property {(channelId: string, text: string, options?: Object) => Promise<void>} sendMessage - Send outbound message
 * @property {(text: string, platform: string) => string} formatResponse - Format response text for this platform
 * @property {(raw: Object) => NormalizedMessage} normalizeInbound - Normalize inbound platform message
 */

/**
 * @typedef {Object} SkillPlugin
 * @property {string} id - Unique plugin identifier
 * @property {string} name - Human-readable plugin name
 * @property {string} description - What this plugin does
 * @property {string[]} triggers - Keywords / intents that activate this plugin
 * @property {(msg: NormalizedMessage, context: EchoContext) => Promise<string|null>} process - Process a message; return response or null to pass-through
 * @property {() => Promise<void>} init - Plugin initialization hook
 * @property {() => Promise<void>} cleanup - Plugin teardown hook
 */

/**
 * @typedef {Object} EchoContext
 * @property {string} sessionId - Active session identifier
 * @property {string} userId - User identifier
 * @property {string} platform - Originating platform
 * @property {Object} userMemory - Per-user persistent memory map
 * @property {Object} channelState - Per-channel state map
 * @property {string} requestId - Correlation ID for this request
 */

/**
 * @typedef {Object} GatewayState
 * @property {'CONNECTING'|'OPEN'|'DEGRADED'|'CLOSED'|'CIRCUIT_OPEN'} status - Connection lifecycle state
 * @property {number} reconnectAttempts - Number of reconnection attempts since last successful connection
 * @property {string|null} lastConnectedAt - ISO-8601 timestamp of last successful connection
 * @property {string|null} lastError - Most recent error message
 * @property {number} heartbeatIntervalMs - Heartbeat interval in milliseconds
 * @property {number} latencyMs - Last measured round-trip latency
 */

/**
 * @typedef {Object} MiniAppSubmission
 * @property {string} type - Submission type (service_request|generator_lead|maintenance_booking|quote_request)
 * @property {string} name - Customer name
 * @property {string} phone - Customer phone
 * @property {string} email - Customer email
 * @property {string} address - Service address
 * @property {string} description - Description of work needed
 * @property {string} [preferredDate] - Preferred service date
 * @property {string} [urgency] - Urgency level (routine|urgent|emergency)
 * @property {Object} [metadata] - Extra submission data
 */

export default {};
