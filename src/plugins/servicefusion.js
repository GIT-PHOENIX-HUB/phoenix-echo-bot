/**
 * Phoenix Echo Bot - ServiceFusion CRM Plugin
 *
 * Provides job lookup/status, customer search, estimate/invoice queries,
 * and dispatch queue integration with ServiceFusion CRM.
 *
 * All API calls are stubs with TODO(gateway) markers for live API connection.
 *
 * @type {import('../types.js').SkillPlugin}
 */

import { getDefaultLogger } from '../logger.js';

const logger = getDefaultLogger().child({ component: 'plugin-servicefusion' });

const SF_BASE_URL = process.env.SERVICEFUSION_BASE_URL || 'https://api.servicefusion.com/v1';
const SF_API_KEY = process.env.SERVICEFUSION_API_KEY || '';

/**
 * Make a ServiceFusion API request (stub)
 * @param {string} endpoint - API endpoint
 * @param {Object} [options] - Request options
 * @returns {Promise<Object>}
 */
async function sfApiRequest(endpoint, options = {}) {
  // TODO(gateway): Implement actual ServiceFusion API calls
  // const url = `${SF_BASE_URL}${endpoint}`;
  // const response = await fetch(url, {
  //   headers: {
  //     'Authorization': `Bearer ${SF_API_KEY}`,
  //     'Content-Type': 'application/json'
  //   },
  //   ...options
  // });
  // return response.json();

  logger.debug('ServiceFusion API stub called', { endpoint });
  return { stub: true, endpoint, message: 'ServiceFusion API not yet connected' };
}

/**
 * Look up a job by ID or number
 * @param {string} jobId - Job ID or number
 * @returns {Promise<Object>}
 */
async function lookupJob(jobId) {
  // TODO(gateway): GET /jobs/{jobId} from ServiceFusion API
  const result = await sfApiRequest(`/jobs/${jobId}`);
  if (result.stub) {
    return {
      found: false,
      message: `Job lookup for "${jobId}" -- ServiceFusion API not yet connected. Configure SERVICEFUSION_API_KEY to enable.`
    };
  }
  return result;
}

/**
 * Search for a customer by name, phone, or email
 * @param {string} query - Search query
 * @returns {Promise<Object>}
 */
async function searchCustomer(query) {
  // TODO(gateway): GET /customers?search={query} from ServiceFusion API
  const result = await sfApiRequest(`/customers?search=${encodeURIComponent(query)}`);
  if (result.stub) {
    return {
      found: false,
      message: `Customer search for "${query}" -- ServiceFusion API not yet connected.`
    };
  }
  return result;
}

/**
 * Get dispatch queue (today's scheduled jobs)
 * @returns {Promise<Object>}
 */
async function getDispatchQueue() {
  // TODO(gateway): GET /dispatch/queue from ServiceFusion API
  const today = new Date().toISOString().split('T')[0];
  const result = await sfApiRequest(`/dispatch/queue?date=${today}`);
  if (result.stub) {
    return {
      jobs: [],
      message: `Dispatch queue for ${today} -- ServiceFusion API not yet connected.`
    };
  }
  return result;
}

/**
 * Get estimate or invoice details
 * @param {string} type - 'estimate' or 'invoice'
 * @param {string} id - Document ID
 * @returns {Promise<Object>}
 */
async function getDocument(type, id) {
  // TODO(gateway): GET /estimates/{id} or /invoices/{id} from ServiceFusion API
  const result = await sfApiRequest(`/${type}s/${id}`);
  if (result.stub) {
    return {
      found: false,
      message: `${type} lookup for "${id}" -- ServiceFusion API not yet connected.`
    };
  }
  return result;
}

/**
 * Process a ServiceFusion query
 * @param {import('../types.js').NormalizedMessage} msg
 * @param {import('../types.js').EchoContext} context
 * @returns {Promise<string|null>}
 */
async function process(msg, context) {
  const text = String(msg.text || '').trim();
  const lower = text.toLowerCase();

  // Job lookup
  const jobMatch = lower.match(/(?:job|work\s*order)\s*#?\s*(\w+)/);
  if (jobMatch && (lower.includes('status') || lower.includes('lookup') || lower.includes('find') || lower.startsWith('/job'))) {
    const job = await lookupJob(jobMatch[1]);
    if (job.found === false) {
      return job.message;
    }
    return `Job ${jobMatch[1]}: ${JSON.stringify(job, null, 2)}`;
  }

  // Customer search
  const customerMatch = lower.match(/(?:customer|client)\s+(?:search|find|lookup)\s+(.+)/);
  if (customerMatch) {
    const result = await searchCustomer(customerMatch[1].trim());
    if (result.found === false) {
      return result.message;
    }
    return `Customer search results: ${JSON.stringify(result, null, 2)}`;
  }

  // Dispatch queue
  if (lower.includes('dispatch') && (lower.includes('queue') || lower.includes('today') || lower.includes('schedule'))) {
    const queue = await getDispatchQueue();
    if (queue.jobs && queue.jobs.length === 0 && queue.message) {
      return queue.message;
    }
    return `Today's Dispatch Queue:\n${JSON.stringify(queue, null, 2)}`;
  }

  // Estimate lookup
  const estMatch = lower.match(/estimate\s*#?\s*(\w+)/);
  if (estMatch) {
    const est = await getDocument('estimate', estMatch[1]);
    return est.found === false ? est.message : `Estimate ${estMatch[1]}: ${JSON.stringify(est, null, 2)}`;
  }

  // Invoice lookup
  const invMatch = lower.match(/invoice\s*#?\s*(\w+)/);
  if (invMatch) {
    const inv = await getDocument('invoice', invMatch[1]);
    return inv.found === false ? inv.message : `Invoice ${invMatch[1]}: ${JSON.stringify(inv, null, 2)}`;
  }

  return null;
}

/** @type {import('../types.js').SkillPlugin} */
const servicefusion = {
  id: 'servicefusion',
  name: 'ServiceFusion CRM',
  description: 'Job lookup, customer search, estimates, invoices, and dispatch queue via ServiceFusion CRM',
  triggers: [
    '/job', '/customer', '/dispatch', '/estimate', '/invoice',
    'job status', 'job lookup', 'work order',
    'customer search', 'customer find', 'customer lookup',
    'dispatch queue', 'dispatch schedule', 'dispatch today',
    'estimate', 'invoice'
  ],
  process,
  async init() {
    const connected = !!SF_API_KEY;
    logger.info('ServiceFusion plugin initialized', {
      connected,
      baseUrl: SF_BASE_URL
    });
    if (!connected) {
      logger.warn('ServiceFusion API key not configured -- running in stub mode');
    }
  },
  async cleanup() {
    logger.debug('ServiceFusion plugin cleanup (no-op)');
  }
};

export default servicefusion;
