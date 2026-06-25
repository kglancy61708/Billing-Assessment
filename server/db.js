const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const REVIEWS_FILE = path.join(DATA_DIR, 'reviews.json');
const SCANS_FILE   = path.join(DATA_DIR, 'scans.json');

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}

function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

// reviews: { "customerId:ruleId": { customer_id, rule_id, status, note, reviewed_by, reviewed_at } }
function upsertReview({ customerId, ruleId, status, note, reviewedBy }) {
  const reviews = readJSON(REVIEWS_FILE, {});
  const key = `${customerId}:${ruleId}`;
  reviews[key] = {
    customer_id: String(customerId),
    rule_id: ruleId,
    status,
    note: note || null,
    reviewed_by: reviewedBy || null,
    reviewed_at: new Date().toISOString(),
  };
  writeJSON(REVIEWS_FILE, reviews);
}

function getReviewMap() {
  return readJSON(REVIEWS_FILE, {});
}

function saveScanRun({ startedAt, finishedAt, flagCount, errorCount, errors }) {
  const scans = readJSON(SCANS_FILE, []);
  scans.unshift({ startedAt, finishedAt, flagCount, errorCount, errors: errors || [] });
  if (scans.length > 50) scans.length = 50; // keep last 50
  writeJSON(SCANS_FILE, scans);
}

function getRecentScans(limit = 10) {
  return readJSON(SCANS_FILE, []).slice(0, limit);
}

module.exports = { upsertReview, getReviewMap, saveScanRun, getRecentScans };
