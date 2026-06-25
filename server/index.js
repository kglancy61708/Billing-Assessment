require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');

const { runAllRules } = require('./rules');
const { getRecordUrl } = require('./netsuite');
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

    const flags = cachedResult.flags.map(f => {
      const key = `${f.customerId}:${f.ruleId}`;
      const review = reviewMap[key];
      return {
        ...f,
        netsuiteUrl: getRecordUrl(f.customerId),
        status: review?.status || 'open',
        note: review?.note || null,
        reviewedBy: review?.reviewed_by || null,
        reviewedAt: review?.reviewed_at || null,
      };
    });

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
app.patch('/api/flags/:customerId/:ruleId', (req, res) => {
  const { customerId, ruleId } = req.params;
  const { status, note, reviewedBy } = req.body;

  const valid = ['open', 'reviewed', 'dismissed'];
  if (!valid.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${valid.join(', ')}` });
  }

  upsertReview({ customerId, ruleId: Number(ruleId), status, note, reviewedBy });
  res.json({ success: true, customerId, ruleId, status });
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

// GET /api/diagnose — verifies NetSuite connectivity and SuiteQL table names
app.get('/api/diagnose', async (req, res) => {
  const { suiteQL } = require('./netsuite');
  const results = [];

  const tests = [
    {
      name: 'Auth & basic customer query',
      q: `SELECT id, companyname FROM customer WHERE rownum <= 1`,
    },
    {
      name: 'Auth & basic customer query (entity)',
      q: `SELECT id, companyname FROM entity WHERE rownum <= 1`,
    },
    {
      name: 'customeraddressbook sublist',
      q: `SELECT ca.id, ca.entity, ca.defaultbilling, ca.defaultshipping, ca.addressbookaddress
          FROM customeraddressbook ca WHERE rownum <= 1`,
    },
    {
      name: 'entityaddress join',
      q: `SELECT a.nkey, a.addressee, a.addr1, a.city, a.state, a.zip
          FROM entityaddress a WHERE rownum <= 1`,
    },
    {
      name: 'custentity_po_required field',
      q: `SELECT id, companyname, custentity_po_required FROM customer WHERE rownum <= 1`,
    },
    {
      name: 'custentity264 and custentity310 fields',
      q: `SELECT id, custentity264, custentity310 FROM customer WHERE rownum <= 1`,
    },
    {
      name: 'transaction table',
      q: `SELECT id, type, entity FROM transaction WHERE rownum <= 1`,
    },
  ];

  for (const test of tests) {
    try {
      const data = await suiteQL(test.q, 1, 0);
      results.push({ name: test.name, status: 'OK', rows: data.items?.length ?? 0, sample: data.items?.[0] ?? null });
    } catch (err) {
      results.push({ name: test.name, status: 'ERROR', error: err.message });
    }
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
  // Auto-run first scan on startup
  runScan().catch(console.error);
});
