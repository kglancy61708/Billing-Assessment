const fetch = require('node-fetch');

const WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
const APP_URL     = (process.env.APP_URL || '').replace(/\/$/, '');

const RULE_LABELS = {
  1: 'Rule 1 — Online Invoice Service',
  2: 'Rule 2 — Invoice Delivery Method',
  3: 'Rule 3 — Missing Email (w/ Invoice)',
  4: 'Rule 4 — Missing Email (Sibling)',
  5: 'Rule 5 — Missing PO Number',
  6: 'Rule 6 — Address Incomplete',
  7: 'Rule 7 — Sales Order Address Mismatch',
};

async function postNewFlags(newFlags) {
  if (!WEBHOOK_URL || newFlags.length === 0) return;

  for (const f of newFlags) {
    const ruleLabel   = RULE_LABELS[f.ruleId] || `Rule ${f.ruleId}`;
    const category    = f.categoryName || f.category || '—';
    const appLink     = APP_URL ? `<${APP_URL}|Open Billing Assessment>` : 'Billing Assessment';

    const text = [
      `*New billing flag detected*`,
      `*Flag type:* ${ruleLabel}`,
      `*Account:* ${f.companyName || f.customerId}`,
      `*Category:* ${category}`,
      appLink,
    ].join('\n');

    try {
      await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
    } catch (e) {
      console.error(`Slack notify failed for ${f.customerId}:${f.ruleId} — ${e.message}`);
    }
  }
}

module.exports = { postNewFlags };
