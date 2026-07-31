require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');

const { runAllRules, resolveB2BNames, getB2BCache } = require('./rules');
const { getRecordUrl, createCustomerNote, getCustomerFields, updateCustomer, updateTransaction, updateCustomerAddress, getCustomerAddressbook } = require('./netsuite');
const { getSFToken, findAccountByNetSuiteId, updateAccountAddress, getSFFieldConfig } = require('./salesforce');
const {
  upsertReview,
  getReviewMap,
  saveScanRun,
  getRecentScans,
} = require('./db');

const app = express();
const PORT = process.env.PORT || 3001;

app.set('trust proxy', 1);
app.use(cors());
app.use(express.json());
app.use(rateLimit({ windowMs: 60_000, max: 120 }));

// In-memory cache of the last scan result
let cachedResult = null;
let scanning = false;

async function runScan() {
  if (scanning) return null;
  scanning = true;
  const startedAt = new Date().toISOString();

  try {
    const { flags, errors } = await runAllRules();
    const finishedAt = new Date().toISOString();
    saveScanRun({ startedAt, finishedAt, flagCount: flags.length, errorCount: errors.length, errors });
    cachedResult = { flags, errors, scannedAt: finishedAt };
    return cachedResult;
  } finally {
    scanning = false;
  }
}

// GET /api/customer/:id/fields?fields=f1,f2,...
app.get('/api/customer/:id/fields', async (req, res) => {
  try {
    const { id } = req.params;
    const { fields } = req.query;
    if (!fields) return res.status(400).json({ error: 'fields query param required' });
    const data = await getCustomerFields(id, fields);
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/customer/:id — update customer fields
app.patch('/api/customer/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { fields } = req.body;
    if (!fields) return res.status(400).json({ error: 'body.fields required' });
    const result = await updateCustomer(id, fields);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/transaction/:id — update invoice fields
app.patch('/api/transaction/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { fields } = req.body;
    if (!fields) return res.status(400).json({ error: 'body.fields required' });
    const result = await updateTransaction(id, fields);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/customer/:id/address/:addressbookId — legacy endpoint kept for compatibility
// PATCH /api/customer/:id/address/sf — Rule 6: write billing/shipping address to Salesforce
app.patch('/api/customer/:id/address/:addressbookId', async (req, res) => {
  try {
    const { id } = req.params;
    const { fields, addressType } = req.body;
    if (!fields) return res.status(400).json({ error: 'body.fields required' });

    const sfId = await findAccountByNetSuiteId(id);
    if (!sfId) return res.status(404).json({ error: `No Salesforce Account found with NetSuite ID ${id}` });

    const result = await updateAccountAddress(sfId, fields, addressType || 'billing');
    res.json({ ...result, sfAccountId: sfId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/customer/:id/addressbook — return addressbook sublist with line IDs
app.get('/api/customer/:id/addressbook', async (req, res) => {
  try {
    const data = await getCustomerAddressbook(req.params.id);
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/b2bsystems — return B2B system options from rules module cache
app.get('/api/b2bsystems', (req, res) => {
  const cache = getB2BCache();
  const systems = Object.entries(cache).map(([id, name]) => ({ id, name }));
  res.json(systems);
});

// GET /api/flags — return flags merged with review state
app.get('/api/flags', async (req, res) => {
  try {
    if (!cachedResult) {
      await runScan();
    }

    if (!cachedResult) {
      return res.status(503).json({ error: 'Scan not yet complete' });
    }

    const reviewMap = getReviewMap();

    const activeFlagKeys = new Set();
    const flags = cachedResult.flags.map(f => {
      const key = `${f.customerId}:${f.ruleId}`;
      activeFlagKeys.add(key);
      const review = reviewMap[key];

      const parentChanged = review?.parent_id != null &&
        f.parentId != null &&
        String(review.parent_id) !== String(f.parentId);

      const effectiveStatus = (!review || parentChanged) ? 'open' : review.status;

      return {
        ...f,
        netsuiteUrl: getRecordUrl(f.customerId),
        status: effectiveStatus,
        note: parentChanged ? null : (review?.note || null),
        reviewedBy: parentChanged ? null : (review?.reviewed_by || null),
        reviewedAt: parentChanged ? null : (review?.reviewed_at || null),
        parentChanged: parentChanged || false,
      };
    });

    // Include reviewed/dismissed flags that are no longer in the current scan (issue resolved in NetSuite)
    for (const [key, review] of Object.entries(reviewMap)) {
      if (activeFlagKeys.has(key)) continue;
      if (review.status === 'open') continue;
      const meta = review.flag_meta || {
        customerId: review.customer_id,
        companyName: `Customer ID ${review.customer_id}`,
        ruleId: review.rule_id,
        ruleLabel: `Rule ${review.rule_id}`,
        detail: 'Flag details unavailable — record was reviewed before metadata storage was added.',
        parentId: review.parent_id || null,
        parentName: null,
        fields: {},
      };
      flags.push({
        ...meta,
        netsuiteUrl: getRecordUrl(review.customer_id),
        status: review.status,
        note: review.note || null,
        reviewedBy: review.reviewed_by || null,
        reviewedAt: review.reviewed_at || null,
        parentChanged: false,
        resolvedInNetSuite: true,
      });
    }

    const { statusFilter, ruleFilter } = req.query;
    let filtered = flags;
    if (statusFilter) filtered = filtered.filter(f => f.status === statusFilter);
    if (ruleFilter) filtered = filtered.filter(f => String(f.ruleId) === String(ruleFilter));

    res.json({
      flags: filtered,
      total: filtered.length,
      scannedAt: cachedResult.scannedAt,
      errors: cachedResult.errors,
      scanning,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/scan — trigger a fresh scan
app.post('/api/scan', async (req, res) => {
  if (scanning) {
    return res.json({ message: 'Scan already in progress', scanning: true });
  }
  // Start scan async, don't wait
  runScan().catch(console.error);
  res.json({ message: 'Scan started', scanning: true });
});

// GET /api/scan/status
app.get('/api/scan/status', (req, res) => {
  res.json({
    scanning,
    scannedAt: cachedResult?.scannedAt || null,
    flagCount: cachedResult?.flags?.length || 0,
    recent: getRecentScans(5),
  });
});

// PATCH /api/flags/:customerId/:ruleId — mark reviewed or dismissed
app.patch('/api/flags/:customerId/:ruleId', async (req, res) => {
  const { customerId, ruleId } = req.params;
  const { status, note, reviewedBy, parentId, addToNetSuite, companyName, ruleLabel, flagMeta } = req.body;

  const valid = ['open', 'reviewed', 'dismissed'];
  if (!valid.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${valid.join(', ')}` });
  }

  upsertReview({ customerId, ruleId: Number(ruleId), status, note, reviewedBy, parentId, flagMeta });

  // Write note to NetSuite if requested
  let netsuiteNoteError = null;
  if (addToNetSuite && status !== 'open') {
    try {
      const actionLabel = status === 'reviewed' ? 'Reviewed' : 'Dismissed';
      const lines = [`Action: ${actionLabel}`, `Rule ${ruleId}: ${ruleLabel || ''}`];
      if (reviewedBy) lines.push(`Reviewed by: ${reviewedBy}`);
      if (note) lines.push(`Note: ${note}`);
      lines.push(`Date: ${new Date().toLocaleDateString('en-US')}`);
      await createCustomerNote(customerId, lines.join('\n'), status, Number(ruleId), reviewedBy);
    } catch (err) {
      netsuiteNoteError = err.message;
    }
  }

  res.json({ success: true, customerId, ruleId, status, netsuiteNoteError });
});

// GET /api/credentials — shows masked credential values to verify Railway vars are set
app.get('/api/credentials', (req, res) => {
  const mask = (val) => {
    if (!val) return '(not set)';
    if (val.length <= 6) return '***';
    return val.slice(0, 3) + '***' + val.slice(-3);
  };
  res.json({
    NS_ACCOUNT_ID:      process.env.NS_ACCOUNT_ID     || '(not set)',
    NS_CONSUMER_KEY:    mask(process.env.NS_CONSUMER_KEY),
    NS_CONSUMER_SECRET: mask(process.env.NS_CONSUMER_SECRET),
    NS_TOKEN_ID:        mask(process.env.NS_TOKEN_ID),
    NS_TOKEN_SECRET:    mask(process.env.NS_TOKEN_SECRET),
  });
});

// GET /api/diagnose/rule4?ids=2893761,9319 — debug Rule 4 for specific customer IDs
app.get('/api/diagnose/rule4', async (req, res) => {
  const { suiteQLAll } = require('./netsuite');
  const ids = (req.query.ids || '').split(',').map(s => s.trim()).filter(Boolean);
  if (ids.length === 0) return res.status(400).json({ error: 'ids query param required' });

  try {
    // Check the customer fields directly
    const customers = await suiteQLAll(`
      SELECT c.id, c.companyname, c.parent, c.entitystatus, c.isinactive,
             c.email, c.custentity562, c.custentity563
      FROM customer c
      WHERE c.id IN (${ids.join(',')})
    `);

    // Check open invoices for these customers
    const invoices = await suiteQLAll(`
      SELECT t.entity, COUNT(*) AS cnt
      FROM transaction t
      WHERE t.entity IN (${ids.join(',')})
        AND t.type = 'CustInvc'
        AND t.voided = 'F'
        AND t.status = 'A'
      GROUP BY t.entity
    `);
    const invoiceMap = {};
    for (const row of invoices) invoiceMap[String(row.entity)] = row.cnt;

    // Check all accounts under the same parent — no filters — to see what's there
    const parentIds = [...new Set(customers.map(c => c.parent).filter(Boolean))];
    let allSiblings = [], filteredSiblings = [];
    if (parentIds.length > 0) {
      // No filters — see everything under the parent
      allSiblings = await suiteQLAll(`
        SELECT c.id, c.companyname, c.parent, c.entitystatus, c.isinactive,
               c.email, c.custentity562, c.custentity563
        FROM customer c
        WHERE c.id IN (
          SELECT id FROM customer WHERE parent IN (${parentIds.join(',')})
        )
      `);
      // With all Rule 4 filters applied
      filteredSiblings = await suiteQLAll(`
        SELECT c.id, c.companyname, c.parent, c.email, c.custentity562, c.custentity563
        FROM customer c
        WHERE c.isinactive = 'F'
          AND c.entitystatus = 13
          AND c.id IN (
            SELECT id FROM customer WHERE parent IN (${parentIds.join(',')})
          )
          AND (
            (c.email IS NOT NULL AND c.email != '')
            OR (c.custentity562 IS NOT NULL AND c.custentity562 != '')
            OR (c.custentity563 IS NOT NULL AND c.custentity563 != '')
          )
          AND EXISTS (
            SELECT 1 FROM transaction t
            WHERE t.entity = c.id AND t.type = 'CustInvc' AND t.voided = 'F' AND t.status = 'A'
          )
      `);
    }

    res.json({
      customers: customers.map(c => ({ ...c, openInvoices: invoiceMap[String(c.id)] || 0 })),
      siblingsByParent: parentIds.map(pid => ({
        parentId: pid,
        allSiblingsCount: allSiblings.filter(s => String(s.parent) === String(pid)).length,
        allSiblings: allSiblings.filter(s => String(s.parent) === String(pid)).map(s => ({
          id: s.id, companyname: s.companyname,
          entitystatus: s.entitystatus, isinactive: s.isinactive,
          email: s.email, custentity562: s.custentity562, custentity563: s.custentity563,
        })),
        filteredSiblingsCount: filteredSiblings.filter(s => String(s.parent) === String(pid)).length,
        filteredSiblings: filteredSiblings.filter(s => String(s.parent) === String(pid)).map(s => ({
          id: s.id, companyname: s.companyname, email: s.email,
          custentity562: s.custentity562, custentity563: s.custentity563,
        })),
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/diagnose/salesforce — verify SF connection and confirm custom field API names
app.get('/api/diagnose/salesforce', async (req, res) => {
  try {
    const token = await getSFToken();
    const config = getSFFieldConfig();

    // Describe the Account object and return fields relevant to addresses + the NS ID field
    const url = `${token.instance_url}/services/data/v58.0/sobjects/Account/describe`;
    const descRes = await fetch(url, { headers: { Authorization: `Bearer ${token.access_token}` } });
    const desc = await descRes.json();

    const relevant = (desc.fields || [])
      .filter(f => /billing|attention|addressee|netsuite/i.test(f.name) || /billing|attention|addressee|netsuite/i.test(f.label))
      .map(f => ({ name: f.name, label: f.label, type: f.type, updateable: f.updateable }));

    res.json({ connected: true, instanceUrl: token.instance_url, fieldConfig: config, relevantFields: relevant });
  } catch (err) {
    res.status(500).json({ connected: false, error: err.message });
  }
});

// GET /api/diagnose — verifies NetSuite connectivity and SuiteQL table names
app.get('/api/diagnose', async (req, res) => {
  const { suiteQL, listCustomersREST } = require('./netsuite');
  const results = [];

  // SuiteQL tests
  const tests = [
    { name: 'SuiteQL: transaction', q: `SELECT id, type FROM transaction WHERE rownum <= 1` },
    { name: 'SuiteQL: customer', q: `SELECT id FROM customer WHERE rownum <= 1` },
    { name: 'SuiteQL: department', q: `SELECT id, name FROM department WHERE rownum <= 1` },
    { name: 'SuiteQL: customeraddressbook', q: `SELECT * FROM customeraddressbook WHERE rownum <= 1` },
    { name: 'SuiteQL: customeraddressbookentityaddress', q: `SELECT * FROM customeraddressbookentityaddress WHERE rownum <= 1` },
    { name: 'SuiteQL: transaction all fields', q: `SELECT * FROM transaction WHERE type = 'CustInvc' AND rownum <= 1` },
  ];

  for (const test of tests) {
    try {
      const data = await suiteQL(test.q, 1, 0);
      results.push({ name: test.name, status: 'OK', rows: data.items?.length ?? 0, sample: data.items?.[0] ?? null });
    } catch (err) {
      results.push({ name: test.name, status: 'ERROR', error: err.message });
    }
  }

  // REST Record API test
  try {
    const data = await listCustomersREST(3);
    results.push({ name: 'REST Record API: customer list', status: 'OK', rows: data.items?.length ?? 0, sample: data.items?.[0] ?? null });
  } catch (err) {
    results.push({ name: 'REST Record API: customer list', status: 'ERROR', error: err.message });
  }

  const allOk = results.every(r => r.status === 'OK');
  res.json({ allOk, results });
});

// Summary stats for dashboard header
app.get('/api/summary', (req, res) => {
  if (!cachedResult) return res.json({ open: 0, reviewed: 0, dismissed: 0, total: 0 });

  const reviewMap = getReviewMap();
  const counts = { open: 0, reviewed: 0, dismissed: 0 };

  for (const f of cachedResult.flags) {
    const key = `${f.customerId}:${f.ruleId}`;
    const status = reviewMap[key]?.status || 'open';
    counts[status] = (counts[status] || 0) + 1;
  }

  res.json({ ...counts, total: cachedResult.flags.length, scannedAt: cachedResult.scannedAt });
});

// Serve built React client (production) or standalone HTML (development)
const clientDist = path.join(__dirname, '..', 'client', 'dist');
const clientHtml = path.join(__dirname, '..', 'client', 'index.html');
if (require('fs').existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res) => res.sendFile(path.join(clientDist, 'index.html')));
} else if (require('fs').existsSync(clientHtml)) {
  app.use(express.static(path.join(__dirname, '..', 'client')));
  app.get('/', (req, res) => res.sendFile(clientHtml));
}

app.listen(PORT, () => {
  console.log(`Billing Assessment server running on port ${PORT}`);
  // Resolve B2B display names first, then run the initial scan
  resolveB2BNames()
    .catch(console.error)
    .finally(() => runScan().catch(console.error));
});
