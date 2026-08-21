const { suiteQLAll, getSalesOrderUrl } = require('./netsuite');

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Cache B2B system names for the lifetime of the server process
// Populated at startup via resolveB2BNames(), used read-only during scans
const b2bNameCache = {};

// Hardcoded fallback for customlist324 (B2B System) — used if SuiteQL query fails
const B2B_FALLBACK = {
  '13': 'Brass/New Orleans', '11': 'Coupa Supplier Portal',
  '22': 'Entrada / Vendor Access', '21': 'FacilGo',
  '20': 'Greystar Centralized Billing', '17': 'IRT Vendor Portal',
  '9': 'McKinley', '5': 'Nexus Systems', '2': 'Ops Technology',
  '23': 'Paymode-x', '24': 'SAP Ariba / Nexus Water Group',
  '16': 'Service Channel', '19': 'SPS Commerce', '7': 'Vendor Cafe / Yardi PayScan',
};

async function resolveB2BNames() {
  try {
    // Query customlist324 directly to get all B2B system options (not just ones in use)
    const rows = await suiteQLAll(`
      SELECT id, name FROM customlist324 WHERE isinactive = 'F' ORDER BY name
    `);
    for (const r of rows) {
      if (r.id && r.name) b2bNameCache[String(r.id)] = r.name;
    }
    if (Object.keys(b2bNameCache).length === 0) throw new Error('empty result');
    console.log(`B2B name cache: ${Object.keys(b2bNameCache).length} entries from customlist324`);
  } catch (err) {
    console.warn('resolveB2BNames SuiteQL failed, using fallback list:', err.message);
    Object.assign(b2bNameCache, B2B_FALLBACK);
  }
}

// Rule 1: Sub-account missing custentity310 when at least one sibling has it true
async function rule1_missingOnlineInvoiceVsSiblings() {
  const rows = await suiteQLAll(`
    SELECT c.id, c.companyname, c.parent, c.custentity310, c.category
    FROM customer c
    WHERE c.isinactive = 'F'
      AND c.entitystatus = 13
      AND LOWER(c.companyname) NOT LIKE '%test%'
      AND EXISTS (
        SELECT 1 FROM transaction t
        WHERE t.entity = c.id
          AND t.type = 'CustInvc'
          AND t.voided = 'F'
          AND t.status = 'A'
      )
      AND c.parent IS NOT NULL
      AND (c.custentity310 = 'F' OR c.custentity310 IS NULL)
      AND EXISTS (
        SELECT 1 FROM customer s
        WHERE s.parent = c.parent
          AND s.id != c.id
          AND s.custentity310 = 'T'
          AND s.isinactive = 'F'
          AND s.entitystatus = 13
      )
  `);

  // Fetch sibling accounts that have Online Invoice Service enabled (the "compared" siblings)
  const parentIds = [...new Set(rows.map(r => r.parent).filter(Boolean))];
  // Map: parentId -> array of { id, companyname, custentity318 }
  const siblingsByParent = {};
  if (parentIds.length > 0) {
    const siblingRows = await suiteQLAll(`
      SELECT s.id, s.parent, s.companyname, s.custentity318
      FROM customer s
      WHERE s.parent IN (${parentIds.join(',')})
        AND s.isinactive = 'F'
        AND s.entitystatus = 13
        AND s.custentity310 = 'T'
    `);
    for (const s of siblingRows) {
      const pid = String(s.parent);
      if (!siblingsByParent[pid]) siblingsByParent[pid] = [];
      siblingsByParent[pid].push({
        id: String(s.id),
        companyname: s.companyname,
        custentity318: s.custentity318 ? (b2bNameCache[s.custentity318] || s.custentity318) : null,
      });
    }
  }

  return rows.map(r => {
    const pid = r.parent ? String(r.parent) : null;
    const siblings = pid && siblingsByParent[pid] ? siblingsByParent[pid] : [];
    return {
      customerId: String(r.id),
      companyName: r.companyname,
      category: r.category ? String(r.category) : null,
      parentId: pid,
      ruleId: 1,
      ruleLabel: 'Missing Online Invoice Service (vs. siblings)',
      detail: 'One or more sibling sub-accounts have Customer has Online Invoice Service (custentity310) checked, but this account does not.',
      fields: { custentity310: r.custentity310, onlineInvoiceSiblings: siblings },
    };
  });
}

// Rule 2: None of the three billing delivery methods are enabled
async function rule2_noDeliveryMethodSet() {
  const rows = await suiteQLAll(`
    SELECT c.id, c.companyname, c.category, c.printtransactions, c.custentity264, c.custentity310,
           c.custentity571, c.custentity594, c.email, c.custentity562, c.custentity563,
           c.custentity531, c.custentity532
    FROM customer c
    WHERE c.isinactive = 'F'
      AND c.entitystatus = 13
      AND LOWER(c.companyname) NOT LIKE '%test%'
      AND EXISTS (
        SELECT 1 FROM transaction t
        WHERE t.entity = c.id
          AND t.type = 'CustInvc'
          AND t.voided = 'F'
          AND t.status = 'A'
      )
      AND (c.printtransactions = 'F' OR c.printtransactions IS NULL)
      AND (c.custentity264 = 'F' OR c.custentity264 IS NULL)
      AND (c.custentity310 = 'F' OR c.custentity310 IS NULL)
      AND (c.custentity276 IS NULL OR c.custentity276 = '')
      AND (c.custentity756 IS NULL OR c.custentity756 = '')
  `);

  return rows.map(r => ({
    customerId: String(r.id),
    companyName: r.companyname,
    category: r.category ? String(r.category) : null,
    parentId: null,
    ruleId: 2,
    ruleLabel: 'No Invoice Delivery Method Set',
    detail: 'None of Print Transactions, Invoices to Email, or Online Invoice Service are enabled.',
    fields: {
      printtransactions: r.printtransactions,
      custentity264: r.custentity264,
      custentity310: r.custentity310,
      custentity571: r.custentity571,
      custentity594: r.custentity594,
      email: r.email,
      custentity562: r.custentity562,
      custentity563: r.custentity563,
      custentity531: r.custentity531,
      custentity532: r.custentity532,
    },
  }));
}

// Rule 3: Invoices to Email is true but no email address on file
async function rule3_emailFlagNoAddress() {
  const rows = await suiteQLAll(`
    SELECT c.id, c.companyname, c.category, c.email, c.custentity264, c.custentity562, c.custentity563
    FROM customer c
    WHERE c.isinactive = 'F'
      AND c.entitystatus = 13
      AND LOWER(c.companyname) NOT LIKE '%test%'
      AND EXISTS (
        SELECT 1 FROM transaction t
        WHERE t.entity = c.id
          AND t.type = 'CustInvc'
          AND t.voided = 'F'
          AND t.status = 'A'
      )
      AND c.custentity264 = 'T'
      AND (c.email IS NULL OR c.email = '')
  `);

  return rows.map(r => ({
    customerId: String(r.id),
    companyName: r.companyname,
    category: r.category ? String(r.category) : null,
    parentId: null,
    ruleId: 3,
    ruleLabel: 'Invoices to Email — No Email Address',
    detail: '"Invoices to Email" (custentity264) is enabled but the Email field is empty.',
    fields: { email: r.email, custentity264: r.custentity264, custentity562: r.custentity562, custentity563: r.custentity563 },
  }));
}

// Rule 4: Email domain differs from sibling sub-accounts under the same parent
// Checks c.email, custentity562 (Invoice Email #1), and custentity563 (Invoice Email #2)
// Strategy: flag only accounts with open invoices, but compute majority domain from ALL
// active siblings (not just those with invoices) so centrally-billed greystar.com accounts
// still set the expected domain even if they have no individual open invoices.
async function rule4_emailDomainMismatch() {
  function getEmails(r) {
    return [r.email, r.custentity562, r.custentity563].filter(e => e && e.trim() !== '');
  }
  function getDomain(email) {
    const parts = (email || '').toLowerCase().split('@');
    return parts.length === 2 && parts[1] ? parts[1] : null;
  }

  // Step 1: Candidates — active sub-accounts with open invoices and a primary email.
  // Filter only on c.email (a known-valid WHERE column in SuiteQL); custentity562/563 are
  // read in SELECT for JS processing but must NOT appear in the WHERE OR — SuiteQL silently
  // returns 0 rows when those custom fields are used as compound OR filters.
  const candidates = await suiteQLAll(`
    SELECT c.id, c.companyname, c.category, c.parent,
           c.email, c.custentity562, c.custentity563
    FROM customer c
    WHERE c.isinactive = 'F'
      AND c.entitystatus = 13
      AND LOWER(c.companyname) NOT LIKE '%test%'
      AND c.parent IS NOT NULL
      AND c.email IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM transaction t
        WHERE t.entity = c.id
          AND t.type = 'CustInvc'
          AND t.voided = 'F'
          AND t.status = 'A'
      )
  `);
  console.log(`Rule 4: candidates=${candidates.length}`);

  if (candidates.length === 0) return [];

  // Step 2: ALL active sub-accounts with a primary email — used to compute majority domain.
  // Filter only on c.email in WHERE (same reason as Step 1).
  const candidateParentSet = new Set(candidates.map(r => String(r.parent)));

  const siblingPool = await suiteQLAll(`
    SELECT c.id, c.companyname, c.parent, c.email, c.custentity562, c.custentity563
    FROM customer c
    WHERE c.isinactive = 'F'
      AND c.parent IS NOT NULL
      AND c.email IS NOT NULL
  `);
  console.log(`Rule 4: siblingPool=${siblingPool.length}, candidateParents=${candidateParentSet.size}`);

  // Build majority domain per parent — only for parents that have candidates
  const domainsByParent = {};
  for (const s of siblingPool) {
    const pid = String(s.parent);
    if (!candidateParentSet.has(pid)) continue;
    const preferred = [s.custentity562, s.email, s.custentity563].find(e => e && e.trim());
    if (!preferred) continue;
    const domain = getDomain(preferred);
    if (!domain) continue;
    if (!domainsByParent[pid]) domainsByParent[pid] = [];
    domainsByParent[pid].push(domain);
  }

  const majorityByParent = {};
  for (const [pid, domains] of Object.entries(domainsByParent)) {
    if (domains.length < 2) continue;
    const freq = {};
    for (const d of domains) freq[d] = (freq[d] || 0) + 1;
    majorityByParent[pid] = Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0];
  }

  // Step 3: Flag candidates whose email domain doesn't match their parent's majority domain
  const flags = [];
  for (const r of candidates) {
    const pid = String(r.parent);
    const majorityDomain = majorityByParent[pid];
    if (!majorityDomain) continue;

    const emailFields = [
      { key: 'email', label: 'Email', value: r.email },
      { key: 'custentity562', label: 'Invoice Email #1', value: r.custentity562 },
      { key: 'custentity563', label: 'Invoice Email #2', value: r.custentity563 },
    ];

    const deviantFields = emailFields.filter(ef => {
      if (!ef.value || !ef.value.trim()) return false;
      const d = getDomain(ef.value);
      return d && d !== majorityDomain;
    });

    if (deviantFields.length === 0) continue;

    const deviantSummary = deviantFields
      .map(ef => `${ef.label} (@${getDomain(ef.value)})`)
      .join(', ');
    const siblingContext = siblingPool
      .filter(s => String(s.parent) === pid && String(s.id) !== String(r.id))
      .map(s => ({ id: String(s.id), companyname: s.companyname || '', email: getEmails(s).join(', ') }))
      .filter(s => s.email)
      .slice(0, 10);

    flags.push({
      customerId: String(r.id),
      companyName: r.companyname,
      category: r.category ? String(r.category) : null,
      parentId: pid,
      ruleId: 4,
      ruleLabel: 'Email Domain Mismatch vs. Siblings',
      detail: `${deviantSummary} — domain differs from the majority "@${majorityDomain}" used by sibling sub-accounts.`,
      fields: {
        email: r.email || '',
        custentity562: r.custentity562 || '',
        custentity563: r.custentity563 || '',
        expectedDomain: majorityDomain,
        siblingEmails: siblingContext,
      },
    });
  }

  console.log(`Rule 4: flags=${flags.length}`);
  return flags;
}

// Rule 5: PO required but open invoices have no PO number
async function rule5_poRequiredMissing() {
  const rows = await suiteQLAll(`
    SELECT DISTINCT c.id, c.companyname, c.category, c.custentity_po_required,
                    t.id AS transactionid, t.tranid, t.otherrefnum, t.trandate
    FROM customer c
    JOIN transaction t ON t.entity = c.id
    WHERE c.isinactive = 'F'
      AND c.entitystatus = 13
      AND LOWER(c.companyname) NOT LIKE '%test%'
      AND EXISTS (
        SELECT 1 FROM transaction t
        WHERE t.entity = c.id
          AND t.type = 'CustInvc'
          AND t.voided = 'F'
          AND t.status = 'A'
      )
      AND c.custentity_po_required = 'T'
      AND (c.custentity310 IS NULL OR c.custentity310 = 'F')
      AND t.type = 'CustInvc'
      AND t.voided = 'F'
      AND t.status = 'A'
      AND (t.otherrefnum IS NULL OR TRIM(t.otherrefnum) = '')
      AND (t.custbody28 IS NULL OR t.custbody28 = 'F')
    ORDER BY c.id, t.trandate DESC
  `);

  // Group by customer, collect invoice list
  const byCustomer = {};
  for (const r of rows) {
    const cid = String(r.id);
    if (!byCustomer[cid]) {
      byCustomer[cid] = { id: r.id, companyname: r.companyname, category: r.category ? String(r.category) : null, custentity_po_required: r.custentity_po_required, invoices: [] };
    }
    byCustomer[cid].invoices.push({
      transactionId: String(r.transactionid),
      tranId: r.tranid,
      tranDate: r.trandate,
      otherrefnum: r.otherrefnum || '',
    });
  }

  return Object.values(byCustomer).map(c => ({
    customerId: String(c.id),
    companyName: c.companyname,
    category: c.category || null,
    parentId: null,
    ruleId: 5,
    ruleLabel: 'PO Required — Invoices Missing PO#',
    detail: `Customer requires a PO but ${c.invoices.length} invoice(s) have no PO# (otherrefnum).`,
    fields: { invoiceCount: c.invoices.length, invoices: c.invoices.slice(0, 10), custentity_po_required: c.custentity_po_required },
  }));
}

// Rule 6: Incomplete shipping or billing address
async function rule6_incompleteAddress() {
  // Query the customer address book — join to get default billing and shipping addresses
  const rows = await suiteQLAll(`
    SELECT c.id, c.companyname, c.category,
           ca.defaultbilling, ca.defaultshipping,
           a.addressee,
           a.attention,
           a.addr1,
           a.city,
           a.state,
           a.zip
    FROM customer c
    JOIN customeraddressbook ca ON ca.entity = c.id
    JOIN customeraddressbookentityaddress a ON a.nkey = ca.addressbookaddress
    WHERE c.isinactive = 'F'
      AND c.entitystatus = 13
      AND LOWER(c.companyname) NOT LIKE '%test%'
      AND EXISTS (
        SELECT 1 FROM transaction t
        WHERE t.entity = c.id
          AND t.type = 'CustInvc'
          AND t.voided = 'F'
          AND t.status = 'A'
      )
      AND (ca.defaultbilling = 'T' OR ca.defaultshipping = 'T')
  `);

  const byCustomer = {};
  for (const r of rows) {
    const cid = String(r.id);
    if (!byCustomer[cid]) {
      byCustomer[cid] = { id: r.id, companyname: r.companyname, category: r.category ? String(r.category) : null, addresses: [] };
    }

    const missing = [];
    const isBilling = r.defaultbilling === 'T';
    if (isBilling && (!r.addressee || r.addressee.trim() === '')) missing.push('Addressee');
    if (!r.addr1 || r.addr1.trim() === '') missing.push('Address 1');
    if (!r.city || r.city.trim() === '') missing.push('City');
    if (!r.state || r.state.trim() === '') missing.push('State');
    if (!r.zip || r.zip.trim() === '') missing.push('Zip');

    if (missing.length > 0) {
      const type = r.defaultbilling === 'T' && r.defaultshipping === 'T'
        ? 'billing & shipping'
        : r.defaultbilling === 'T' ? 'billing' : 'shipping';
      byCustomer[cid].addresses.push({
        type,
        missingFields: missing,
        addressee: r.addressee || '',
        attention: r.attention || '',
        addr1: r.addr1 || '',
        city: r.city || '',
        state: r.state || '',
        zip: r.zip || '',
      });
    }
  }

  const flags = [];
  for (const c of Object.values(byCustomer)) {
    if (c.addresses.length === 0) continue;
    const allMissing = [...new Set(c.addresses.flatMap(a => a.missingFields))];
    flags.push({
      customerId: String(c.id),
      companyName: c.companyname,
      category: c.category || null,
      parentId: null,
      ruleId: 6,
      ruleLabel: 'Incomplete Shipping/Billing Address',
      detail: `Default address is missing required fields: ${allMissing.join(', ')}.`,
      fields: { addresses: c.addresses, missingFields: allMissing },
    });
  }

  return flags;
}

// Rule 7: Water Management sales order address doesn't match current customer address.
// Two-step approach: SuiteQL for active SOs + customer addresses, then a separate
// t.billingaddress and t.shippingaddress are numeric IDs joinable to customeraddressbookentityaddress.
// t.billaddr1 etc. do NOT exist. transactionaddressbook is isolated (no joinable columns).
async function rule7_soAddressMismatch() {
  const rows = await suiteQLAll(`
    SELECT t.id AS soid, t.tranid, t.entity,
           c.companyname, c.category,
           ab.attention AS c_bill_attention, ab.addressee AS c_bill_addressee, ab.addr1 AS c_bill_addr1,
           ab.city AS c_bill_city, ab.state AS c_bill_state, ab.zip AS c_bill_zip,
           sb.addressee AS c_ship_addressee, sb.addr1 AS c_ship_addr1,
           sb.city AS c_ship_city, sb.state AS c_ship_state, sb.zip AS c_ship_zip,
           ba.attention AS so_bill_attention, ba.addressee AS so_bill_addressee, ba.addr1 AS so_bill_addr1,
           ba.city AS so_bill_city, ba.state AS so_bill_state, ba.zip AS so_bill_zip,
           sa.addressee AS so_ship_addressee, sa.addr1 AS so_ship_addr1,
           sa.city AS so_ship_city, sa.state AS so_ship_state, sa.zip AS so_ship_zip
    FROM transaction t
    JOIN customer c ON c.id = t.entity
    LEFT JOIN customeraddressbook cab ON cab.entity = c.id AND cab.defaultbilling = 'T'
    LEFT JOIN customeraddressbookentityaddress ab ON ab.nkey = cab.addressbookaddress
    LEFT JOIN customeraddressbook cas ON cas.entity = c.id AND cas.defaultshipping = 'T'
    LEFT JOIN customeraddressbookentityaddress sb ON sb.nkey = cas.addressbookaddress
    LEFT JOIN customeraddressbookentityaddress ba ON ba.nkey = t.billingaddress
    LEFT JOIN customeraddressbookentityaddress sa ON sa.nkey = t.shippingaddress
    WHERE t.type = 'SalesOrd'
      AND t.customform = '101'
      AND t.enddate IS NULL
      AND c.isinactive = 'F'
  `);

  console.log(`Rule 7: active WM SOs = ${rows.length}`);
  if (rows.length === 0) return [];

  const norm = s => (s || '').trim().toLowerCase();
  const BILL_FIELDS = ['attention', 'addressee', 'addr1', 'city', 'state', 'zip'];
  const SHIP_FIELDS = ['addressee', 'addr1', 'city', 'state', 'zip'];

  function mismatchedFields(soAddr, custAddr, fields) {
    if (!soAddr || fields.every(f => !soAddr[f])) return [];
    return fields.filter(f => norm(soAddr[f]) !== norm(custAddr[f]));
  }

  const flags = [];

  for (const r of rows) {
    const sid = String(r.soid);
    const custBill = { attention: r.c_bill_attention, addressee: r.c_bill_addressee, addr1: r.c_bill_addr1, city: r.c_bill_city, state: r.c_bill_state, zip: r.c_bill_zip };
    const custShip = { addressee: r.c_ship_addressee, addr1: r.c_ship_addr1, city: r.c_ship_city, state: r.c_ship_state, zip: r.c_ship_zip };
    const soBill   = { attention: r.so_bill_attention, addressee: r.so_bill_addressee, addr1: r.so_bill_addr1, city: r.so_bill_city, state: r.so_bill_state, zip: r.so_bill_zip };
    const soShip   = { addressee: r.so_ship_addressee, addr1: r.so_ship_addr1, city: r.so_ship_city, state: r.so_ship_state, zip: r.so_ship_zip };

    const billDiffs = mismatchedFields(soBill, custBill, BILL_FIELDS);
    const shipDiffs = mismatchedFields(soShip, custShip, SHIP_FIELDS);

    if (billDiffs.length === 0 && shipDiffs.length === 0) continue;

    const which = [billDiffs.length && 'billing', shipDiffs.length && 'shipping'].filter(Boolean).join(' and ');

    flags.push({
      customerId: String(r.entity),
      companyName: r.companyname,
      category: r.category ? String(r.category) : null,
      parentId: null,
      ruleId: 7,
      ruleLabel: 'Sales Order Address Mismatch',
      detail: `${which.charAt(0).toUpperCase() + which.slice(1)} address on Water Management SO ${r.tranid} differs from the current customer address. Recreate the sales order to stamp the corrected address on future invoices.`,
      fields: {
        soId: sid,
        soTranId: r.tranid,
        soUrl: getSalesOrderUrl(sid),
        billing: { mismatch: billDiffs.length > 0, diffFields: billDiffs, so: soBill, customer: custBill },
        shipping: { mismatch: shipDiffs.length > 0, diffFields: shipDiffs, so: soShip, customer: custShip },
      },
    });
  }

  console.log(`Rule 7: flags = ${flags.length}`);
  return flags;
}

const RULES = [
  rule1_missingOnlineInvoiceVsSiblings,
  rule2_noDeliveryMethodSet,
  rule3_emailFlagNoAddress,
  rule4_emailDomainMismatch,
  rule5_poRequiredMissing,
  rule6_incompleteAddress,
  rule7_soAddressMismatch,
];

async function runAllRules() {
  const flags = [];
  const errors = [];

  for (let i = 0; i < RULES.length; i++) {
    if (i > 0) await sleep(2000); // give NetSuite's concurrency slot time to clear between rules
    try {
      const result = await RULES[i]();
      flags.push(...result);
    } catch (err) {
      errors.push({ ruleId: i + 1, error: err.message || String(err) });
    }
  }

  // Resolve parent names in one batch query
  const parentIds = [...new Set(flags.map(f => f.parentId).filter(Boolean))];
  if (parentIds.length > 0) {
    try {
      const idList = parentIds.join(',');
      const rows = await suiteQLAll(`SELECT id, companyname FROM customer WHERE id IN (${idList})`);
      const nameById = {};
      for (const r of rows) nameById[String(r.id)] = r.companyname;
      for (const f of flags) {
        if (f.parentId) f.parentName = nameById[String(f.parentId)] || null;
      }
    } catch (e) {
      // Non-fatal — parent names just won't show
    }
  }

  // Resolve category display names by customer ID using BUILTIN.DF
  const flaggedCustomerIds = [...new Set(flags.map(f => f.customerId).filter(Boolean))];
  if (flaggedCustomerIds.length > 0) {
    try {
      const rows = await suiteQLAll(`
        SELECT id, BUILTIN.DF(category) AS catname
        FROM customer WHERE id IN (${flaggedCustomerIds.join(',')}) AND category IS NOT NULL
      `);
      const catNames = {};
      for (const r of rows) if (r.catname) catNames[String(r.id)] = r.catname;
      for (const f of flags) {
        f.categoryName = catNames[String(f.customerId)] || null;
      }
      console.log(`Category names resolved for ${Object.keys(catNames).length} customers`);
    } catch (e) {
      console.warn('Category name resolution failed:', e.message);
    }
  }

  return { flags, errors };
}

function getB2BCache() { return b2bNameCache; }

module.exports = { runAllRules, RULES, resolveB2BNames, getB2BCache };
