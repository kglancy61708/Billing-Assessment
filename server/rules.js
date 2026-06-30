const { suiteQLAll } = require('./netsuite');

// Rule 1: Sub-account missing custentity310 when at least one sibling has it true
async function rule1_missingOnlineInvoiceVsSiblings() {
  const rows = await suiteQLAll(`
    SELECT c.id, c.companyname, c.parent, c.custentity310
    FROM customer c
    WHERE c.isinactive = 'F'
      AND c.entitystatus = 13
      AND c.balance > 0
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

  return rows.map(r => ({
    customerId: String(r.id),
    companyName: r.companyname,
    parentId: r.parent ? String(r.parent) : null,
    ruleId: 1,
    ruleLabel: 'Missing Online Invoice Service (vs. siblings)',
    detail: 'One or more sibling sub-accounts have Customer has Online Invoice Service (custentity310) checked, but this account does not.',
    fields: { custentity310: r.custentity310 },
  }));
}

// Rule 2: None of the three billing delivery methods are enabled
async function rule2_noDeliveryMethodSet() {
  const rows = await suiteQLAll(`
    SELECT c.id, c.companyname, c.printtransactions, c.custentity264, c.custentity310
    FROM customer c
    WHERE c.isinactive = 'F'
      AND c.entitystatus = 13
      AND c.balance > 0
      AND (c.printtransactions = 'F' OR c.printtransactions IS NULL)
      AND (c.custentity264 = 'F' OR c.custentity264 IS NULL)
      AND (c.custentity310 = 'F' OR c.custentity310 IS NULL)
      AND (c.custentity276 IS NULL OR c.custentity276 = '')
  `);

  return rows.map(r => ({
    customerId: String(r.id),
    companyName: r.companyname,
    parentId: null,
    ruleId: 2,
    ruleLabel: 'No Invoice Delivery Method Set',
    detail: 'None of Print Transactions, Invoices to Email, or Online Invoice Service are enabled.',
    fields: {
      printtransactions: r.printtransactions,
      custentity264: r.custentity264,
      custentity310: r.custentity310,
    },
  }));
}

// Rule 3: Invoices to Email is true but no email address on file
async function rule3_emailFlagNoAddress() {
  const rows = await suiteQLAll(`
    SELECT c.id, c.companyname, c.email
    FROM customer c
    WHERE c.isinactive = 'F'
      AND c.entitystatus = 13
      AND c.balance > 0
      AND c.custentity264 = 'T'
      AND (c.email IS NULL OR c.email = '')
  `);

  return rows.map(r => ({
    customerId: String(r.id),
    companyName: r.companyname,
    parentId: null,
    ruleId: 3,
    ruleLabel: 'Invoices to Email — No Email Address',
    detail: '"Invoices to Email" (custentity264) is enabled but the Email field is empty.',
    fields: { email: r.email },
  }));
}

// Rule 4: Email domain differs from sibling sub-accounts under the same parent
async function rule4_emailDomainMismatch() {
  const rows = await suiteQLAll(`
    SELECT c.id, c.companyname, c.parent, c.email
    FROM customer c
    WHERE c.isinactive = 'F'
      AND c.entitystatus = 13
      AND c.balance > 0
      AND c.parent IS NOT NULL
      AND c.email IS NOT NULL
      AND c.email != ''
  `);

  // Group by parent
  const byParent = {};
  for (const r of rows) {
    const pid = String(r.parent);
    if (!byParent[pid]) byParent[pid] = [];
    byParent[pid].push(r);
  }

  const flags = [];
  for (const [parentId, siblings] of Object.entries(byParent)) {
    if (siblings.length < 2) continue;

    const domains = siblings.map(s => {
      const parts = (s.email || '').toLowerCase().split('@');
      return parts.length === 2 ? parts[1] : null;
    }).filter(Boolean);

    if (domains.length < 2) continue;

    // Find the majority domain
    const freq = {};
    for (const d of domains) freq[d] = (freq[d] || 0) + 1;
    const majorityDomain = Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0];
    const uniqueDomains = new Set(domains);

    if (uniqueDomains.size === 1) continue; // all same domain, fine

    for (const r of siblings) {
      const emailParts = (r.email || '').toLowerCase().split('@');
      const domain = emailParts.length === 2 ? emailParts[1] : null;
      if (domain && domain !== majorityDomain) {
        flags.push({
          customerId: String(r.id),
          companyName: r.companyname,
          parentId,
          ruleId: 4,
          ruleLabel: 'Email Domain Mismatch vs. Siblings',
          detail: `Email domain "@${domain}" differs from the majority domain "@${majorityDomain}" used by sibling sub-accounts under the same parent.`,
          fields: { email: r.email, expectedDomain: majorityDomain },
        });
      }
    }
  }

  return flags;
}

// Rule 5: PO required but open invoices have no PO number
async function rule5_poRequiredMissing() {
  const rows = await suiteQLAll(`
    SELECT DISTINCT c.id, c.companyname, t.id AS transactionid, t.tranid, t.otherrefnum, t.trandate
    FROM customer c
    JOIN transaction t ON t.entity = c.id
    WHERE c.isinactive = 'F'
      AND c.entitystatus = 13
      AND c.balance > 0
      AND c.custentity_po_required = 'T'
      AND t.type = 'CustInvc'
      AND t.voided = 'F'
      AND (t.otherrefnum IS NULL OR TRIM(t.otherrefnum) = '')
    ORDER BY c.id, t.trandate DESC
  `);

  // Group by customer, collect invoice list
  const byCustomer = {};
  for (const r of rows) {
    const cid = String(r.id);
    if (!byCustomer[cid]) {
      byCustomer[cid] = { id: r.id, companyname: r.companyname, invoices: [] };
    }
    byCustomer[cid].invoices.push({
      transactionId: String(r.transactionid),
      tranId: r.tranid,
      tranDate: r.trandate,
    });
  }

  return Object.values(byCustomer).map(c => ({
    customerId: String(c.id),
    companyName: c.companyname,
    parentId: null,
    ruleId: 5,
    ruleLabel: 'PO Required — Invoices Missing PO#',
    detail: `Customer requires a PO but ${c.invoices.length} invoice(s) have no PO# (otherrefnum).`,
    fields: { invoiceCount: c.invoices.length, invoices: c.invoices.slice(0, 10) },
  }));
}

// Rule 6: Incomplete shipping or billing address
async function rule6_incompleteAddress() {
  // Query the customer address book — join to get default billing and shipping addresses
  const rows = await suiteQLAll(`
    SELECT c.id, c.companyname,
           ca.defaultbilling, ca.defaultshipping,
           a.addr1,
           a.city,
           a.state,
           a.zip
    FROM customer c
    JOIN customeraddressbook ca ON ca.entity = c.id
    JOIN customeraddressbookentityaddress a ON a.nkey = ca.addressbookaddress
    WHERE c.isinactive = 'F'
      AND c.entitystatus = 13
      AND c.balance > 0
      AND (ca.defaultbilling = 'T' OR ca.defaultshipping = 'T')
  `);

  const byCustomer = {};
  for (const r of rows) {
    const cid = String(r.id);
    if (!byCustomer[cid]) {
      byCustomer[cid] = { id: r.id, companyname: r.companyname, addresses: [] };
    }

    const missing = [];
    if (!r.addr1 || r.addr1.trim() === '') missing.push('Address 1');
    if (!r.city || r.city.trim() === '') missing.push('City');
    if (!r.state || r.state.trim() === '') missing.push('State');
    if (!r.zip || r.zip.trim() === '') missing.push('Zip');

    if (missing.length > 0) {
      const type = r.defaultbilling === 'T' && r.defaultshipping === 'T'
        ? 'billing & shipping'
        : r.defaultbilling === 'T' ? 'billing' : 'shipping';
      byCustomer[cid].addresses.push({ type, missingFields: missing });
    }
  }

  const flags = [];
  for (const c of Object.values(byCustomer)) {
    if (c.addresses.length === 0) continue;
    const allMissing = [...new Set(c.addresses.flatMap(a => a.missingFields))];
    flags.push({
      customerId: String(c.id),
      companyName: c.companyname,
      parentId: null,
      ruleId: 6,
      ruleLabel: 'Incomplete Shipping/Billing Address',
      detail: `Default address is missing required fields: ${allMissing.join(', ')}.`,
      fields: { addresses: c.addresses, missingFields: allMissing },
    });
  }

  return flags;
}

const RULES = [
  rule1_missingOnlineInvoiceVsSiblings,
  rule2_noDeliveryMethodSet,
  rule3_emailFlagNoAddress,
  rule4_emailDomainMismatch,
  rule5_poRequiredMissing,
  rule6_incompleteAddress,
];

async function runAllRules() {
  const results = await Promise.allSettled(RULES.map(fn => fn()));
  const flags = [];
  const errors = [];

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === 'fulfilled') {
      flags.push(...r.value);
    } else {
      errors.push({ ruleId: i + 1, error: r.reason?.message || String(r.reason) });
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

  return { flags, errors };
}

module.exports = { runAllRules, RULES };
