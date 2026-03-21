/**
 * Phoenix Echo Bot - Phoenix Knowledge Base Plugin
 *
 * Company knowledge base for standard operating procedures, training materials,
 * company policies, and equipment specifications.
 *
 * @type {import('../types.js').SkillPlugin}
 */

import { getDefaultLogger } from '../logger.js';

const logger = getDefaultLogger().child({ component: 'plugin-phoenix-knowledge' });

/**
 * Standard Operating Procedures
 * @type {Record<string, {title:string, content:string, category:string}>}
 */
const SOP_DATABASE = {
  'service-call': {
    title: 'Service Call Procedure',
    content: [
      '1. Dispatch receives call, creates ServiceFusion job',
      '2. Technician assigned based on skill level and proximity',
      '3. Technician confirms appointment with customer (call/text)',
      '4. On arrival: introduce yourself, verify scope, assess safety',
      '5. Diagnose issue, present options to customer',
      '6. Get approval before starting work',
      '7. Complete work, test all circuits',
      '8. Clean up work area',
      '9. Walk customer through what was done',
      '10. Collect payment or confirm PO',
      '11. Update ServiceFusion with notes, photos, materials used',
      '12. Close job in system'
    ].join('\n'),
    category: 'Service'
  },
  'panel-change': {
    title: 'Panel Changeout SOP',
    content: [
      '1. Verify permit is pulled and inspection scheduled',
      '2. Contact utility for disconnect/reconnect coordination',
      '3. Document existing panel (photos, circuit directory)',
      '4. De-energize, verify dead with meter',
      '5. Remove old panel, preserve circuit identification',
      '6. Install new panel per NEC and local codes',
      '7. Land all circuits, torque all connections to spec',
      '8. Install proper grounding and bonding',
      '9. Label all circuits in new directory',
      '10. Re-energize, test all circuits',
      '11. Schedule inspection',
      '12. Document with photos for ServiceFusion'
    ].join('\n'),
    category: 'Service'
  },
  'new-construction': {
    title: 'New Construction Rough-In SOP',
    content: [
      '1. Review blueprints and specifications',
      '2. Walk job site with GC, verify layout',
      '3. Pull permit if not already pulled',
      '4. Install temporary power if needed',
      '5. Run conduit/cable per plans',
      '6. Install boxes per NEC spacing requirements',
      '7. Pull wire, label all circuits',
      '8. Install panel, land circuits',
      '9. Complete rough-in self-inspection checklist',
      '10. Schedule rough-in inspection',
      '11. Address any inspection corrections',
      '12. Document status in ServiceFusion'
    ].join('\n'),
    category: 'Construction'
  },
  'safety-lockout': {
    title: 'Lockout/Tagout Procedure (LOTO)',
    content: [
      '1. Notify all affected personnel',
      '2. Identify all energy sources',
      '3. Shut down equipment using normal controls',
      '4. Isolate energy sources (switches, breakers, valves)',
      '5. Apply personal lock and tag to each isolation point',
      '6. Verify zero energy state with meter',
      '7. Test meter on known live source before and after',
      '8. Perform work',
      '9. Remove tools, replace guards',
      '10. Verify all personnel clear',
      '11. Remove locks/tags in reverse order',
      '12. Re-energize and test'
    ].join('\n'),
    category: 'Safety'
  },
  'vehicle-maintenance': {
    title: 'Company Vehicle Maintenance',
    content: [
      '- Weekly: Check fluids, tire pressure, lights',
      '- Monthly: Inventory tool list, report missing/damaged tools',
      '- Every 5,000 miles: Oil change (keep receipt for office)',
      '- Annual: State inspection, registration renewal',
      '- Always: Report any damage within 24 hours',
      '- Keep vehicle clean -- it represents Phoenix Electric',
      '- No personal items stored long-term in vehicles'
    ].join('\n'),
    category: 'Operations'
  }
};

/**
 * Company policies
 * @type {Record<string, {title:string, content:string}>}
 */
const POLICIES = {
  'ppe': {
    title: 'Personal Protective Equipment (PPE) Policy',
    content: 'All technicians must wear: safety glasses, work boots (EH rated), arc-rated clothing when working on energized equipment. Hard hat required on all construction sites. High-visibility vest required for roadside or parking lot work.'
  },
  'overtime': {
    title: 'Overtime Policy',
    content: 'Overtime must be pre-approved by a manager. Time-and-a-half after 40 hours/week. Double-time on holidays. All overtime must be documented in ServiceFusion time tracking.'
  },
  'materials': {
    title: 'Materials Procurement Policy',
    content: 'Use Rexel as primary supplier. Orders over $500 require manager approval. Keep all receipts. Restocking fee policy: return unused materials within 30 days. No personal purchases on company accounts.'
  },
  'customer-communication': {
    title: 'Customer Communication Standards',
    content: 'Always be professional and courteous. Respond to customer inquiries within 2 hours during business hours. Confirm appointments 24 hours in advance. Provide written estimates for work over $300. Follow up within 48 hours of job completion.'
  }
};

/**
 * Equipment specifications reference
 * @type {Record<string, {name:string, specs:string}>}
 */
const EQUIPMENT_SPECS = {
  'fluke-87v': {
    name: 'Fluke 87V Digital Multimeter',
    specs: 'True-RMS, CAT III 1000V / CAT IV 600V. Use for all voltage/current measurements. Annual calibration required.'
  },
  'fluke-376': {
    name: 'Fluke 376 Clamp Meter',
    specs: 'True-RMS AC/DC, 999.9A AC/DC. iFlex probe capable. Use for load measurements without disconnecting.'
  },
  'ideal-61-959': {
    name: 'Ideal SureTrace Circuit Tracer',
    specs: 'Circuit identification without power interruption. Use for panel mapping and circuit tracing.'
  },
  'megger-mit485': {
    name: 'Megger MIT485 Insulation Tester',
    specs: 'Test voltages: 50V, 100V, 250V, 500V, 1000V. Use for insulation resistance testing on motors and feeders.'
  }
};

/**
 * Process a knowledge base query
 * @param {import('../types.js').NormalizedMessage} msg
 * @param {import('../types.js').EchoContext} context
 * @returns {Promise<string|null>}
 */
async function process(msg, context) {
  const text = String(msg.text || '').trim();
  const lower = text.toLowerCase();

  // SOP lookup
  if (lower.includes('sop') || lower.includes('procedure') || lower.includes('how to')) {
    for (const [key, sop] of Object.entries(SOP_DATABASE)) {
      if (lower.includes(key.replace(/-/g, ' ')) || lower.includes(key)) {
        return `${sop.title}\nCategory: ${sop.category}\n\n${sop.content}`;
      }
    }

    // List available SOPs
    if (lower.includes('list') || lower.includes('all') || lower === '/sop') {
      const list = Object.entries(SOP_DATABASE)
        .map(([key, sop]) => `- ${sop.title} (${sop.category}) [${key}]`)
        .join('\n');
      return `Available Standard Operating Procedures:\n\n${list}\n\nAsk for any specific SOP by name.`;
    }
  }

  // Policy lookup
  if (lower.includes('policy') || lower.includes('policies')) {
    for (const [key, policy] of Object.entries(POLICIES)) {
      if (lower.includes(key.replace(/-/g, ' ')) || lower.includes(key)) {
        return `${policy.title}\n\n${policy.content}`;
      }
    }

    if (lower.includes('list') || lower.includes('all')) {
      const list = Object.entries(POLICIES)
        .map(([key, p]) => `- ${p.title} [${key}]`)
        .join('\n');
      return `Company Policies:\n\n${list}\n\nAsk for any specific policy by name.`;
    }
  }

  // Equipment specs
  if (lower.includes('equipment') || lower.includes('spec') || lower.includes('meter') || lower.includes('tool')) {
    for (const [key, equip] of Object.entries(EQUIPMENT_SPECS)) {
      if (lower.includes(key) || lower.includes(equip.name.toLowerCase())) {
        return `${equip.name}\n\n${equip.specs}`;
      }
    }

    if (lower.includes('list') || lower.includes('all')) {
      const list = Object.entries(EQUIPMENT_SPECS)
        .map(([key, e]) => `- ${e.name}`)
        .join('\n');
      return `Equipment Reference:\n\n${list}\n\nAsk about any specific piece of equipment.`;
    }
  }

  // Training materials
  if (lower.includes('training')) {
    return 'Phoenix Electric Training Resources:\n\n' +
      '1. New Hire Orientation -- Contact office for schedule\n' +
      '2. NEC Code Updates -- Annual training (January)\n' +
      '3. Arc Flash Safety -- Quarterly refresher\n' +
      '4. OSHA 10/30 -- Required for all field personnel\n' +
      '5. First Aid/CPR -- Annual certification\n' +
      '6. ServiceFusion System Training -- On-demand with office\n' +
      '7. Lift/Boom Certification -- As needed per project\n\n' +
      'Contact the office to schedule any training session.';
  }

  return null;
}

/** @type {import('../types.js').SkillPlugin} */
const phoenixKnowledge = {
  id: 'phoenix-knowledge',
  name: 'Phoenix Knowledge Base',
  description: 'Company SOPs, policies, training materials, and equipment specifications',
  triggers: [
    '/sop', '/policy', '/training', '/equipment',
    'sop', 'procedure', 'standard operating',
    'policy', 'policies', 'company policy',
    'training', 'training materials',
    'equipment spec', 'tool spec'
  ],
  process,
  async init() {
    logger.info('Phoenix Knowledge Base plugin initialized', {
      sops: Object.keys(SOP_DATABASE).length,
      policies: Object.keys(POLICIES).length,
      equipment: Object.keys(EQUIPMENT_SPECS).length
    });
  },
  async cleanup() {
    logger.debug('Phoenix Knowledge Base plugin cleanup (no-op)');
  }
};

export default phoenixKnowledge;
