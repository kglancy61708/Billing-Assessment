import React from 'react';

const RULE_LABELS = {
  1: 'Missing Online Invoice vs. Siblings',
  2: 'No Delivery Method',
  3: 'Email Flag, No Address',
  4: 'Email Domain Mismatch',
  5: 'PO Required, Missing on Invoice',
  6: 'Incomplete Address',
};

export default function SummaryBar({ summary, scanning, scannedAt, onScan, flags }) {
  const byRule = {};
  for (let i = 1; i <= 6; i++) byRule[i] = 0;
  for (const f of (flags || [])) {
    if (f.status === 'open') byRule[f.ruleId] = (byRule[f.ruleId] || 0) + 1;
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>Billing Assessment</h1>
          <p style={styles.subtitle}>
            {scannedAt
              ? `Last scan: ${new Date(scannedAt).toLocaleString()}`
              : 'No scan yet'}
          </p>
        </div>
        <button
          style={scanning ? styles.btnScanning : styles.btn}
          onClick={onScan}
          disabled={scanning}
        >
          {scanning ? '⟳ Scanning…' : '↺ Run Scan'}
        </button>
      </div>

      <div style={styles.statRow}>
        <StatCard label="Open" value={summary.open} color="#ef4444" />
        <StatCard label="Reviewed" value={summary.reviewed} color="#10b981" />
        <StatCard label="Dismissed" value={summary.dismissed} color="#9ca3af" />
        <StatCard label="Total Flags" value={summary.total} color="#6366f1" />
      </div>

      <div style={styles.ruleRow}>
        {Object.entries(byRule).map(([ruleId, count]) => (
          <div key={ruleId} style={styles.rulePill}>
            <span style={styles.ruleNum}>Rule {ruleId}</span>
            <span style={styles.ruleCount}>{count}</span>
            <span style={styles.ruleLabel}>{RULE_LABELS[ruleId]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatCard({ label, value, color }) {
  return (
    <div style={styles.stat}>
      <span style={{ ...styles.statValue, color }}>{value ?? '–'}</span>
      <span style={styles.statLabel}>{label}</span>
    </div>
  );
}

const styles = {
  container: {
    background: '#fff',
    borderBottom: '1px solid #e2e6ea',
    padding: '20px 28px 16px',
    boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  title: { fontSize: 22, fontWeight: 700, color: '#1a2332' },
  subtitle: { fontSize: 12, color: '#6b7a8d', marginTop: 2 },
  btn: {
    background: '#1a56db',
    color: '#fff',
    padding: '8px 18px',
    borderRadius: 6,
    fontWeight: 600,
    fontSize: 13,
    transition: 'background 0.15s',
  },
  btnScanning: {
    background: '#9ca3af',
    color: '#fff',
    padding: '8px 18px',
    borderRadius: 6,
    fontWeight: 600,
    fontSize: 13,
  },
  statRow: {
    display: 'flex',
    gap: 24,
    marginBottom: 14,
  },
  stat: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
  },
  statValue: { fontSize: 28, fontWeight: 700, lineHeight: 1 },
  statLabel: { fontSize: 12, color: '#6b7a8d', marginTop: 2 },
  ruleRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
  },
  rulePill: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    background: '#f3f4f6',
    borderRadius: 20,
    padding: '3px 10px 3px 8px',
    fontSize: 12,
  },
  ruleNum: { fontWeight: 700, color: '#374151' },
  ruleCount: {
    background: '#e5e7eb',
    borderRadius: 10,
    padding: '0 6px',
    fontWeight: 700,
    color: '#111827',
  },
  ruleLabel: { color: '#6b7280' },
};
