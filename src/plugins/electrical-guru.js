/**
 * Phoenix Echo Bot - Electrical Guru Plugin
 *
 * NEC 2023 code expert providing code lookups, wire sizing calculations,
 * conduit fill calculations, voltage drop calculations, and Colorado-specific
 * amendments.
 *
 * @type {import('../types.js').SkillPlugin}
 */

import { getDefaultLogger } from '../logger.js';

const logger = getDefaultLogger().child({ component: 'plugin-electrical-guru' });

/**
 * Common NEC 2023 article reference map
 * @type {Record<string, {title:string, summary:string}>}
 */
const NEC_ARTICLES = {
  '90': { title: 'Introduction', summary: 'Purpose, scope, and enforcement of the NEC.' },
  '100': { title: 'Definitions', summary: 'Definitions used throughout the NEC.' },
  '110': { title: 'Requirements for Electrical Installations', summary: 'General requirements including examination, approval, access, spaces.' },
  '200': { title: 'Use and Identification of Grounded Conductors', summary: 'Grounded conductor identification and use.' },
  '210': { title: 'Branch Circuits', summary: 'Branch circuit ratings, outlets required, GFCI/AFCI requirements.' },
  '215': { title: 'Feeders', summary: 'Feeder capacity, overcurrent protection, ground-fault protection.' },
  '220': { title: 'Branch-Circuit, Feeder, and Service Load Calculations', summary: 'Load calculations for dwellings, commercial, industrial.' },
  '225': { title: 'Outside Branch Circuits and Feeders', summary: 'Requirements for outdoor installations.' },
  '230': { title: 'Services', summary: 'Service entrance conductors, equipment, overcurrent protection.' },
  '240': { title: 'Overcurrent Protection', summary: 'Fuses, circuit breakers, supplementary overcurrent protection.' },
  '250': { title: 'Grounding and Bonding', summary: 'System grounding, equipment grounding, bonding requirements.' },
  '300': { title: 'General Requirements for Wiring Methods and Materials', summary: 'Protection, securing, supports, conductors in parallel.' },
  '310': { title: 'Conductors for General Wiring', summary: 'Conductor properties, ampacities, temperature ratings.' },
  '314': { title: 'Outlet, Device, Pull, and Junction Boxes', summary: 'Box fill calculations, sizing requirements.' },
  '320': { title: 'Armored Cable: Type AC', summary: 'Uses, installation, construction specifications.' },
  '334': { title: 'Nonmetallic-Sheathed Cable: Types NM and NMC', summary: 'Romex uses, permitted locations, installation rules.' },
  '344': { title: 'Rigid Metal Conduit: Type RMC', summary: 'Uses, installation, support requirements.' },
  '348': { title: 'Flexible Metal Conduit: Type FMC', summary: 'Uses, installation, grounding.' },
  '350': { title: 'Liquidtight Flexible Metal Conduit: Type LFMC', summary: 'Wet location conduit.' },
  '352': { title: 'Rigid PVC Conduit: Type PVC', summary: 'PVC conduit uses, expansion, support.' },
  '358': { title: 'Electrical Metallic Tubing: Type EMT', summary: 'EMT uses, fittings, support intervals.' },
  '404': { title: 'Switches', summary: 'Switch ratings, grounding, dimmers.' },
  '406': { title: 'Receptacles, Cord Connectors, and Attachment Plugs', summary: 'Receptacle ratings, tamper-resistant, weather-resistant.' },
  '408': { title: 'Switchboards, Switchgear, and Panelboards', summary: 'Panel installation, overcurrent protection, identification.' },
  '410': { title: 'Luminaires, Lampholders, and Lamps', summary: 'Fixture installation, clearances, wet locations.' },
  '422': { title: 'Appliances', summary: 'Appliance circuits, disconnecting means.' },
  '424': { title: 'Fixed Electric Space-Heating Equipment', summary: 'Baseboard heaters, unit heaters, duct heaters.' },
  '430': { title: 'Motors, Motor Circuits, and Controllers', summary: 'Motor sizing, overload protection, disconnects.' },
  '440': { title: 'Air-Conditioning and Refrigerating Equipment', summary: 'AC unit circuits, disconnects, nameplate.' },
  '480': { title: 'Batteries', summary: 'Battery systems, disconnecting means.' },
  '490': { title: 'Equipment Over 1000 Volts', summary: 'High-voltage equipment requirements.' },
  '500': { title: 'Hazardous (Classified) Locations, Classes I, II, and III', summary: 'Classified location definitions and requirements.' },
  '680': { title: 'Swimming Pools, Fountains, and Similar Installations', summary: 'Pool wiring, bonding, GFCI requirements.' },
  '690': { title: 'Solar Photovoltaic (PV) Systems', summary: 'Solar panel wiring, disconnects, grounding.' },
  '700': { title: 'Emergency Systems', summary: 'Emergency power, transfer switches, wiring.' },
  '701': { title: 'Legally Required Standby Systems', summary: 'Standby generator requirements.' },
  '702': { title: 'Optional Standby Systems', summary: 'Residential and commercial generators.' },
  '705': { title: 'Interconnected Electric Power Production Sources', summary: 'Grid-tied solar, wind, generator interconnection.' },
  '706': { title: 'Energy Storage Systems', summary: 'Battery storage, disconnects, installation.' }
};

/**
 * Copper conductor ampacity table (NEC Table 310.16, 75C column, common sizes)
 * @type {Record<string, number>}
 */
const AMPACITY_COPPER_75C = {
  '14': 20,
  '12': 25,
  '10': 35,
  '8': 50,
  '6': 65,
  '4': 85,
  '3': 100,
  '2': 115,
  '1': 130,
  '1/0': 150,
  '2/0': 175,
  '3/0': 200,
  '4/0': 230,
  '250': 255,
  '300': 285,
  '350': 310,
  '400': 335,
  '500': 380,
  '600': 420,
  '750': 475
};

/**
 * Conductor area in sq inches for conduit fill calculations
 * @type {Record<string, number>}
 */
const CONDUCTOR_AREA = {
  '14-THHN': 0.0097,
  '12-THHN': 0.0133,
  '10-THHN': 0.0211,
  '8-THHN': 0.0366,
  '6-THHN': 0.0507,
  '4-THHN': 0.0824,
  '3-THHN': 0.0973,
  '2-THHN': 0.1158,
  '1-THHN': 0.1562,
  '1/0-THHN': 0.1855,
  '2/0-THHN': 0.2223,
  '3/0-THHN': 0.2679,
  '4/0-THHN': 0.3237
};

/**
 * EMT conduit internal area in sq inches
 * @type {Record<string, number>}
 */
const EMT_AREA = {
  '1/2': 0.304,
  '3/4': 0.533,
  '1': 0.864,
  '1-1/4': 1.496,
  '1-1/2': 2.036,
  '2': 3.356,
  '2-1/2': 5.858,
  '3': 8.846,
  '3-1/2': 11.545,
  '4': 14.753
};

/**
 * Colorado-specific NEC amendments and notes
 */
const COLORADO_AMENDMENTS = [
  'Colorado adopts the NEC 2023 with state-specific amendments effective January 1, 2024.',
  'AFCI protection is required in all habitable rooms per Colorado amendment (stricter than base NEC in some jurisdictions).',
  'Denver and Aurora may have additional local amendments -- always verify with the local AHJ.',
  'Altitude considerations: Colorado Front Range (5,000-6,000 ft) may affect motor derating per NEC 430.6(A).',
  'Ground-fault protection thresholds may differ for high-altitude installations per local amendments.',
  'Colorado requires licensed electricians for all commercial and most residential electrical work.'
];

/**
 * Calculate recommended wire size for a given load
 * @param {number} amps - Load in amperes
 * @param {number} [distanceFt=0] - One-way distance in feet
 * @param {number} [voltage=120] - System voltage
 * @param {boolean} [singlePhase=true] - Single vs three phase
 * @returns {Object} Wire sizing recommendation
 */
function calculateWireSize(amps, distanceFt = 0, voltage = 120, singlePhase = true) {
  const load = Number(amps);
  if (!Number.isFinite(load) || load <= 0) {
    return { error: 'Invalid amperage value' };
  }

  // Find minimum wire size by ampacity
  let recommended = null;
  for (const [size, ampacity] of Object.entries(AMPACITY_COPPER_75C)) {
    if (ampacity >= load) {
      recommended = { size, ampacity };
      break;
    }
  }

  if (!recommended) {
    return { error: `Load of ${load}A exceeds maximum single conductor ampacity in table` };
  }

  const result = {
    loadAmps: load,
    minimumWireSize: `#${recommended.size} AWG/kcmil`,
    ampacity: recommended.ampacity,
    conductor: 'Copper, 75C (THWN/THHN)',
    voltage,
    phase: singlePhase ? 'Single-phase' : 'Three-phase'
  };

  // Calculate voltage drop if distance provided
  if (distanceFt > 0) {
    const vdResult = calculateVoltageDrop(recommended.size, load, distanceFt, voltage, singlePhase);
    result.voltageDrop = vdResult;

    if (vdResult.percentDrop > 3) {
      result.note = `Voltage drop of ${vdResult.percentDrop}% exceeds the NEC 210.19(A) recommendation of 3% for branch circuits. Consider upsizing the conductor.`;
    }
  }

  return result;
}

/**
 * Calculate voltage drop
 * @param {string} wireSize - AWG/kcmil size
 * @param {number} amps - Load current
 * @param {number} distanceFt - One-way distance
 * @param {number} voltage - System voltage
 * @param {boolean} singlePhase - Phase type
 * @returns {Object}
 */
function calculateVoltageDrop(wireSize, amps, distanceFt, voltage, singlePhase) {
  // Resistance per 1000ft for copper at 75C (approximate)
  const resistancePer1000 = {
    '14': 3.14, '12': 1.98, '10': 1.24, '8': 0.778,
    '6': 0.491, '4': 0.308, '3': 0.245, '2': 0.194,
    '1': 0.154, '1/0': 0.122, '2/0': 0.0967, '3/0': 0.0766,
    '4/0': 0.0608, '250': 0.0515, '300': 0.0429, '350': 0.0367,
    '400': 0.0321, '500': 0.0258
  };

  const r = resistancePer1000[wireSize];
  if (!r) {
    return { error: `No resistance data for wire size: ${wireSize}` };
  }

  const k = singlePhase ? 2 : 1.732;
  const vDrop = (k * amps * r * distanceFt) / 1000;
  const percentDrop = ((vDrop / voltage) * 100);

  return {
    voltageDrop: Math.round(vDrop * 100) / 100,
    percentDrop: Math.round(percentDrop * 100) / 100,
    distanceFt,
    wireSize: `#${wireSize}`,
    formula: singlePhase
      ? 'Vd = 2 x I x R x L / 1000'
      : 'Vd = 1.732 x I x R x L / 1000'
  };
}

/**
 * Calculate conduit fill
 * @param {Array<{size:string, type:string, count:number}>} conductors - List of conductors
 * @param {string} conduitSize - Conduit trade size
 * @param {string} [conduitType='EMT'] - Conduit type
 * @returns {Object}
 */
function calculateConduitFill(conductors, conduitSize, conduitType = 'EMT') {
  const conduitAreas = conduitType === 'EMT' ? EMT_AREA : EMT_AREA; // TODO(gateway): Add RMC, PVC areas
  const conduitArea = conduitAreas[conduitSize];
  if (!conduitArea) {
    return { error: `Unknown conduit size: ${conduitSize} ${conduitType}` };
  }

  let totalArea = 0;
  let totalConductors = 0;
  const details = [];

  for (const cond of conductors) {
    const key = `${cond.size}-${cond.type || 'THHN'}`;
    const area = CONDUCTOR_AREA[key];
    if (!area) {
      return { error: `Unknown conductor: ${key}` };
    }
    const count = cond.count || 1;
    totalArea += area * count;
    totalConductors += count;
    details.push({ conductor: key, count, areaEach: area, areaTotal: area * count });
  }

  // NEC fill limits: 1 wire = 53%, 2 wires = 31%, 3+ wires = 40%
  let fillLimit;
  if (totalConductors === 1) fillLimit = 0.53;
  else if (totalConductors === 2) fillLimit = 0.31;
  else fillLimit = 0.40;

  const allowableArea = conduitArea * fillLimit;
  const fillPercent = (totalArea / conduitArea) * 100;
  const passes = totalArea <= allowableArea;

  return {
    conduit: `${conduitSize}" ${conduitType}`,
    conduitArea,
    totalConductorArea: Math.round(totalArea * 10000) / 10000,
    allowableArea: Math.round(allowableArea * 10000) / 10000,
    fillPercent: Math.round(fillPercent * 10) / 10,
    fillLimit: `${fillLimit * 100}%`,
    totalConductors,
    passes,
    details,
    reference: 'NEC Chapter 9, Table 1 and Annex C'
  };
}

/**
 * Process an electrical guru query
 * @param {NormalizedMessage} msg
 * @param {EchoContext} context
 * @returns {Promise<string|null>}
 */
async function process(msg, context) {
  const text = String(msg.text || '').trim();
  const lower = text.toLowerCase();

  // NEC article lookup
  const articleMatch = lower.match(/(?:nec|code|article)\s*#?\s*(\d{2,3})/);
  if (articleMatch) {
    const article = articleMatch[1];
    const info = NEC_ARTICLES[article];
    if (info) {
      return `NEC 2023 Article ${article}: ${info.title}\n\n${info.summary}\n\nNote: Always verify with the full NEC codebook and your local AHJ for the complete requirements.`;
    }
    return `I don't have a summary for NEC Article ${article}. Please check the NEC 2023 codebook directly or specify a different article number.`;
  }

  // Wire sizing request
  const wireSizeMatch = lower.match(/wire\s*size?\s*(?:for\s*)?(\d+)\s*(?:amp|a)\b/);
  if (wireSizeMatch) {
    const amps = Number(wireSizeMatch[1]);
    const distMatch = lower.match(/(\d+)\s*(?:feet|ft|foot)/);
    const dist = distMatch ? Number(distMatch[1]) : 0;
    const voltMatch = lower.match(/(\d+)\s*(?:volt|v)\b/);
    const volts = voltMatch ? Number(voltMatch[1]) : 120;

    const result = calculateWireSize(amps, dist, volts);
    if (result.error) {
      return `Wire sizing error: ${result.error}`;
    }

    let response = `Wire Size Recommendation for ${amps}A load:\n`;
    response += `- Minimum conductor: ${result.minimumWireSize}\n`;
    response += `- Rated ampacity: ${result.ampacity}A\n`;
    response += `- Conductor type: ${result.conductor}\n`;
    response += `- System: ${result.voltage}V ${result.phase}\n`;

    if (result.voltageDrop) {
      response += `\nVoltage Drop Analysis (${dist} ft one-way):\n`;
      response += `- Voltage drop: ${result.voltageDrop.voltageDrop}V (${result.voltageDrop.percentDrop}%)\n`;
    }
    if (result.note) {
      response += `\n${result.note}\n`;
    }
    response += '\nReference: NEC Table 310.16';
    return response;
  }

  // Voltage drop request
  if (lower.includes('voltage drop')) {
    return 'For a voltage drop calculation, please provide: wire size, amperage, one-way distance (ft), and voltage. Example: "voltage drop #10 wire 30 amp 150 feet 240 volt"';
  }

  // Conduit fill request
  if (lower.includes('conduit fill')) {
    return 'For a conduit fill calculation, please specify the conductors and conduit size. Example: "conduit fill 4x #12 THHN in 3/4 EMT"';
  }

  // Colorado amendments
  if (lower.includes('colorado') && (lower.includes('amendment') || lower.includes('code') || lower.includes('nec'))) {
    return 'Colorado NEC Amendments:\n\n' + COLORADO_AMENDMENTS.map((a, i) => `${i + 1}. ${a}`).join('\n');
  }

  // General NEC question -- return null to fall through to Echo agent
  return null;
}

/** @type {SkillPlugin} */
const electricalGuru = {
  id: 'electrical-guru',
  name: 'Electrical Guru',
  description: 'NEC 2023 code expert with wire sizing, conduit fill, voltage drop calculations, and Colorado amendments',
  triggers: [
    '/nec', '/code', '/wire', '/conduit', '/voltagedrop',
    'nec', 'national electrical code', 'wire size', 'wire sizing',
    'conduit fill', 'voltage drop', 'ampacity',
    'article 210', 'article 220', 'article 230', 'article 240', 'article 250',
    'article 310', 'article 334', 'article 430', 'article 690',
    'colorado amendment', 'colorado code'
  ],
  process,
  async init() {
    logger.info('Electrical Guru plugin initialized', {
      articles: Object.keys(NEC_ARTICLES).length,
      wireSizes: Object.keys(AMPACITY_COPPER_75C).length
    });
  },
  async cleanup() {
    logger.debug('Electrical Guru plugin cleanup (no-op)');
  }
};

// Export calculator functions for direct use (e.g. MiniApp routes)
export { calculateWireSize, calculateVoltageDrop, calculateConduitFill, NEC_ARTICLES };

export default electricalGuru;
