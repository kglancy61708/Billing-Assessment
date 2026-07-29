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

// reviews: { "customerId:ruleId": { customer_id, rule_id, status, note, reviewed_by, reviewed_at, parent_id, flag_meta } }
function upsertReview({ customerId, ruleId, status, note, reviewedBy, parentId, flagMeta }) {
  const reviews = readJSON(REVIEWS_FILE, {});
  const key = `${customerId}:${ruleId}`;
  const existing = reviews[key] || {};
  reviews[key] = {
    customer_id: String(customerId),
    rule_id: ruleId,
    status,
    note: note || null,
    reviewed_by: reviewedBy || null,
    reviewed_at: new Date().toISOString(),
    parent_id: parentId ? String(parentId) : null,
    // Preserve flag metadata so ghost entries can be shown after rescan
    flag_meta: flagMeta || existing.flag_meta || null,
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
