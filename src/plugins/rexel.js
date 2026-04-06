/**
 * Phoenix Echo Bot - Rexel Product Catalog Plugin
 *
 * Product search by keyword/part number, pricing lookup (stub),
 * stock availability (stub), and alternative product suggestions.
 * Built for 1,600+ SKU catalog structure.
 *
 * @type {import('../types.js').SkillPlugin}
 */

import { getDefaultLogger } from '../logger.js';

const logger = getDefaultLogger().child({ component: 'plugin-rexel' });

const REXEL_API_KEY = process.env.REXEL_API_KEY || '';
const REXEL_ACCOUNT_ID = process.env.REXEL_ACCOUNT_ID || '';

/**
 * Product categories in the Rexel catalog
 * @type {Record<string, {name:string, subcategories:string[]}>}
 */
const CATALOG_CATEGORIES = {
  'wire-cable': {
    name: 'Wire & Cable',
    subcategories: [
      'THHN/THWN Building Wire',
      'NM-B (Romex)',
      'MC Cable',
      'AC Cable (BX)',
      'SER/SEU Service Entrance',
      'XHHW',
      'UF-B Underground Feeder',
      'Tray Cable',
      'Control Cable',
      'Fire Alarm Cable'
    ]
  },
  'conduit-fittings': {
    name: 'Conduit & Fittings',
    subcategories: [
      'EMT Conduit',
      'Rigid Metal Conduit (RMC)',
      'PVC Conduit',
      'Flexible Metal Conduit (FMC)',
      'Liquidtight',
      'EMT Fittings',
      'Rigid Fittings',
      'PVC Fittings',
      'Conduit Bodies',
      'Strut & Clamps'
    ]
  },
  'boxes-covers': {
    name: 'Boxes & Covers',
    subcategories: [
      'Metal Boxes',
      'PVC Boxes',
      'Junction Boxes',
      'Pull Boxes',
      'Floor Boxes',
      'Weatherproof Boxes',
      'Covers & Plates'
    ]
  },
  'panels-breakers': {
    name: 'Panels & Breakers',
    subcategories: [
      'Residential Panels',
      'Commercial Panels',
      'Circuit Breakers',
      'GFCI Breakers',
      'AFCI Breakers',
      'Dual Function Breakers',
      'Disconnects',
      'Transfer Switches'
    ]
  },
  'lighting': {
    name: 'Lighting',
    subcategories: [
      'LED Fixtures',
      'Troffer/Panel Lights',
      'High Bay',
      'Flood Lights',
      'Wall Packs',
      'Emergency Lighting',
      'Exit Signs',
      'Occupancy Sensors',
      'Dimmers & Controls'
    ]
  },
  'devices': {
    name: 'Devices',
    subcategories: [
      'Receptacles',
      'GFCI Receptacles',
      'Switches',
      'Dimmers',
      'USB Receptacles',
      'Weather-Resistant Devices',
      'Tamper-Resistant Devices',
      'Device Plates'
    ]
  },
  'tools-testing': {
    name: 'Tools & Testing',
    subcategories: [
      'Multimeters',
      'Clamp Meters',
      'Circuit Tracers',
      'Wire Strippers',
      'Crimpers',
      'Fish Tape',
      'Conduit Benders',
      'Knockout Sets'
    ]
  },
  'motors-drives': {
    name: 'Motors & Drives',
    subcategories: [
      'Electric Motors',
      'Variable Frequency Drives (VFDs)',
      'Motor Starters',
      'Contactors',
      'Overload Relays',
      'Soft Starters'
    ]
  },
  'safety': {
    name: 'Safety & PPE',
    subcategories: [
      'Arc Flash PPE',
      'Safety Glasses',
      'Gloves (Insulated)',
      'Hard Hats',
      'Lockout/Tagout Kits',
      'Voltage Detectors'
    ]
  },
  'solar-energy': {
    name: 'Solar & Energy Storage',
    subcategories: [
      'Solar Panels',
      'Inverters',
      'Charge Controllers',
      'Battery Storage Systems',
      'Solar Racking',
      'Rapid Shutdown',
      'PV Wire'
    ]
  }
};

/**
 * Sample product database (representative entries for each category)
 * In production, this would be populated from Rexel API.
 * @type {Array<{sku:string, name:string, category:string, manufacturer:string, unitPrice:number|null}>}
 */
const SAMPLE_PRODUCTS = [
  { sku: 'THHN-12-BLK-500', name: '#12 THHN Stranded Black 500ft', category: 'wire-cable', manufacturer: 'Southwire', unitPrice: null },
  { sku: 'THHN-10-BLK-500', name: '#10 THHN Stranded Black 500ft', category: 'wire-cable', manufacturer: 'Southwire', unitPrice: null },
  { sku: 'NM-12-2-250', name: '12/2 NM-B Romex 250ft', category: 'wire-cable', manufacturer: 'Southwire', unitPrice: null },
  { sku: 'NM-14-2-250', name: '14/2 NM-B Romex 250ft', category: 'wire-cable', manufacturer: 'Southwire', unitPrice: null },
  { sku: 'EMT-075-10', name: '3/4" EMT Conduit 10ft', category: 'conduit-fittings', manufacturer: 'Allied Tube', unitPrice: null },
  { sku: 'EMT-100-10', name: '1" EMT Conduit 10ft', category: 'conduit-fittings', manufacturer: 'Allied Tube', unitPrice: null },
  { sku: 'SQ-HOM2040M100C', name: 'Square D Homeline 100A 20/40 Main Breaker Panel', category: 'panels-breakers', manufacturer: 'Square D', unitPrice: null },
  { sku: 'SQ-HOM120', name: 'Square D Homeline 20A Single Pole Breaker', category: 'panels-breakers', manufacturer: 'Square D', unitPrice: null },
  { sku: 'SQ-HOM120GFI', name: 'Square D Homeline 20A GFCI Breaker', category: 'panels-breakers', manufacturer: 'Square D', unitPrice: null },
  { sku: 'SQ-HOM120DF', name: 'Square D Homeline 20A Dual Function AFCI/GFCI Breaker', category: 'panels-breakers', manufacturer: 'Square D', unitPrice: null },
  { sku: 'LEV-T5325-W', name: 'Leviton 20A Tamper-Resistant Duplex Receptacle White', category: 'devices', manufacturer: 'Leviton', unitPrice: null },
  { sku: 'LEV-GFNT2-W', name: 'Leviton 20A GFCI Receptacle White', category: 'devices', manufacturer: 'Leviton', unitPrice: null },
  { sku: 'LIT-LED-2X4-40W', name: 'Lithonia 2x4 LED Flat Panel 40W 4000K', category: 'lighting', manufacturer: 'Lithonia', unitPrice: null },
  { sku: 'RAB-FXLED78', name: 'RAB 78W LED Flood Light 5000K', category: 'lighting', manufacturer: 'RAB Lighting', unitPrice: null }
];

/**
 * Search products by keyword or SKU
 * @param {string} query - Search query
 * @returns {Array} Matching products
 */
function searchProducts(query) {
  const lower = query.toLowerCase();
  const results = SAMPLE_PRODUCTS.filter((p) => {
    return (
      p.sku.toLowerCase().includes(lower) ||
      p.name.toLowerCase().includes(lower) ||
      p.manufacturer.toLowerCase().includes(lower) ||
      p.category.toLowerCase().includes(lower)
    );
  });

  // TODO(gateway): Search Rexel API for full catalog when REXEL_API_KEY is configured
  // if (REXEL_API_KEY) {
  //   const apiResults = await rexelApiSearch(query);
  //   return apiResults;
  // }

  return results;
}

/**
 * Get pricing for a product (stub)
 * @param {string} sku - Product SKU
 * @returns {Object}
 */
function getProductPricing(sku) {
  // TODO(gateway): GET /products/{sku}/pricing from Rexel API
  return {
    sku,
    pricing: null,
    message: 'Pricing lookup requires Rexel API connection. Configure REXEL_API_KEY to enable.'
  };
}

/**
 * Check stock availability (stub)
 * @param {string} sku - Product SKU
 * @returns {Object}
 */
function checkStock(sku) {
  // TODO(gateway): GET /products/{sku}/availability from Rexel API
  return {
    sku,
    inStock: null,
    message: 'Stock check requires Rexel API connection. Configure REXEL_API_KEY to enable.'
  };
}

/**
 * Process a Rexel catalog query
 * @param {import('../types.js').NormalizedMessage} msg
 * @param {import('../types.js').EchoContext} context
 * @returns {Promise<string|null>}
 */
async function process(msg, context) {
  const text = String(msg.text || '').trim();
  const lower = text.toLowerCase();

  // Product search
  const searchMatch = lower.match(/(?:product|part|search|find|sku)\s+(.+)/);
  if (searchMatch || lower.startsWith('/product')) {
    const query = searchMatch ? searchMatch[1].trim() : text.replace(/^\/product\s*/, '').trim();
    if (!query) {
      return 'Please provide a product name, SKU, or keyword to search. Example: "/product THHN 12"';
    }

    const results = searchProducts(query);
    if (results.length === 0) {
      return `No products found matching "${query}". Try a different keyword or browse categories with "/catalog".`;
    }

    const formatted = results.slice(0, 10).map((p) =>
      `- ${p.sku}: ${p.name} (${p.manufacturer})`
    ).join('\n');

    return `Rexel Product Search: "${query}"\n${results.length} result(s):\n\n${formatted}` +
      (results.length > 10 ? `\n\n...and ${results.length - 10} more. Narrow your search for specific results.` : '');
  }

  // Catalog categories
  if (lower.includes('catalog') || lower.includes('categories') || lower === '/catalog') {
    const list = Object.entries(CATALOG_CATEGORIES)
      .map(([key, cat]) => `${cat.name}:\n  ${cat.subcategories.join(', ')}`)
      .join('\n\n');

    return `Rexel Product Catalog Categories:\n\n${list}\n\nSearch for products with: /product <keyword>`;
  }

  // Pricing lookup
  if (lower.includes('price') || lower.includes('pricing') || lower.includes('cost')) {
    const skuMatch = lower.match(/(?:price|pricing|cost)\s+(?:for\s+)?(\S+)/);
    if (skuMatch) {
      const result = getProductPricing(skuMatch[1].toUpperCase());
      return result.message || `Price for ${result.sku}: ${result.pricing}`;
    }
    return 'Provide a SKU for pricing lookup. Example: "price THHN-12-BLK-500"';
  }

  // Stock check
  if (lower.includes('stock') || lower.includes('availability') || lower.includes('in stock')) {
    const skuMatch = lower.match(/(?:stock|availability)\s+(?:for\s+)?(\S+)/);
    if (skuMatch) {
      const result = checkStock(skuMatch[1].toUpperCase());
      return result.message || `Stock for ${result.sku}: ${result.inStock ? 'In Stock' : 'Out of Stock'}`;
    }
    return 'Provide a SKU for stock check. Example: "stock THHN-12-BLK-500"';
  }

  return null;
}

/** @type {import('../types.js').SkillPlugin} */
const rexel = {
  id: 'rexel',
  name: 'Rexel Product Catalog',
  description: 'Product search, pricing, stock availability, and catalog browsing for Rexel electrical supply',
  triggers: [
    '/product', '/catalog', '/rexel',
    'product search', 'part search', 'find product', 'sku',
    'rexel', 'catalog', 'categories',
    'stock check', 'availability', 'in stock',
    'price', 'pricing'
  ],
  process,
  async init() {
    const connected = !!REXEL_API_KEY;
    logger.info('Rexel plugin initialized', {
      connected,
      sampleProducts: SAMPLE_PRODUCTS.length,
      categories: Object.keys(CATALOG_CATEGORIES).length
    });
    if (!connected) {
      logger.warn('Rexel API key not configured -- running with sample catalog only');
    }
  },
  async cleanup() {
    logger.debug('Rexel plugin cleanup (no-op)');
  }
};

// Export for MiniApp routes
export { searchProducts, CATALOG_CATEGORIES, SAMPLE_PRODUCTS };

export default rexel;
