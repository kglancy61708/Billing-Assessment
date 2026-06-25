import React, { useState } from 'react';
import { updateFlag } from '../api';

const RULE_COLORS = {
  1: '#dbeafe', 2: '#fce7f3', 3: '#ffedd5',
  4: '#ede9fe', 5: '#fef9c3', 6: '#dcfce7',
};

const STATUS_STYLE = {
  open:      { bg: '#fef3c7', text: '#92400e', label: 'Open' },
  reviewed:  { bg: '#d1fae5', text: '#065f46', label: 'Reviewed' },
  dismissed: { bg: '#f3f4f6', text: '#6b7280', label: 'Dismissed' },
};

export default function FlagRow({ flag, onUpdate }) {
  const [expanded, setExpanded] = useState(false);
  const [note, setNote] = useState(flag.note || '');
  const [reviewer, setReviewer] = useState(flag.reviewedBy || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const ss = STATUS_STYLE[flag.status] || STATUS_STYLE.open;

  async function handleSave(status) {
    setSaving(true);
    setError(null);
    try {
      await updateFlag(flag.customerId, flag.ruleId, {
        status,
        note: note || null,
        reviewedBy: reviewer || null,
      });
      onUpdate(flag.customerId, flag.ruleId, { status, note, reviewedBy: reviewer });
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ ...styles.card, borderLeft: `4px solid ${RULE_COLORS[flag.ruleId]}` }}>
      <div style={styles.cardHeader} onClick={() => setExpanded(e => !e)}>
        <div style={styles.left}>
          <span style={styles.chevron}>{expanded ? '▾' : '▸'}</span>
          <div>
            <div style={styles.company}>{flag.companyName}</div>
            <div style={styles.meta}>
              ID: {flag.customerId}
              {flag.parentId && <span style={styles.parentTag}>Parent: {flag.parentId}</span>}
            </div>
          </div>
        </div>
        <div style={styles.right}>
          <span style={styles.ruleTag}>Rule {flag.ruleId}</span>
          <span style={{ ...styles.statusBadge, background: ss.bg, color: ss.text }}>
            {ss.label}
          </span>
          <a
            href={flag.netsuiteUrl}
            target="_blank"
            rel="noreferrer"
            onClick={e => e.stopPropagation()}
            style={styles.nsLink}
          >
            Open in NetSuite ↗
          </a>
        </div>
      </div>

      {expanded && (
        <div style={styles.expandedBody}>
          <div style={styles.ruleLabel}>{flag.ruleLabel}</div>
          <p style={styles.detail}>{flag.detail}</p>

          <FieldDetails flag={flag} />

          <div style={styles.reviewForm}>
            <div style={styles.formRow}>
              <label style={styles.label}>Reviewer name</label>
              <input
                style={styles.input}
                value={reviewer}
                onChange={e => setReviewer(e.target.value)}
                placeholder="Your name"
              />
            </div>
            <div style={styles.formRow}>
              <label style={styles.label}>Note</label>
              <textarea
                style={styles.textarea}
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder="Add a note about this flag…"
                rows={2}
              />
            </div>
            {error && <p style={styles.error}>{error}</p>}
            {flag.reviewedAt && (
              <p style={styles.reviewedInfo}>
                Last updated {new Date(flag.reviewedAt).toLocaleString()}
                {flag.reviewedBy ? ` by ${flag.reviewedBy}` : ''}
              </p>
            )}
            <div style={styles.actions}>
              <ActionBtn
                label="Mark Reviewed"
                color="#057a55"
                bg="#d1fae5"
                onClick={() => handleSave('reviewed')}
                disabled={saving}
              />
              <ActionBtn
                label="Dismiss"
                color="#6b7280"
                bg="#f3f4f6"
                onClick={() => handleSave('dismissed')}
                disabled={saving}
              />
              {flag.status !== 'open' && (
                <ActionBtn
                  label="Re-open"
                  color="#1a56db"
                  bg="#dbeafe"
                  onClick={() => handleSave('open')}
                  disabled={saving}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FieldDetails({ flag }) {
  const { fields } = flag;
  if (!fields) return null;

  // Rule 5: show invoice list
  if (flag.ruleId === 5 && fields.invoices?.length) {
    return (
      <div style={styles.fieldBox}>
        <div style={styles.fieldTitle}>Invoices missing PO# ({fields.invoiceCount} total, showing first {fields.invoices.length}):</div>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Transaction ID</th>
              <th style={styles.th}>Tran #</th>
              <th style={styles.th}>Date</th>
            </tr>
          </thead>
          <tbody>
            {fields.invoices.map(inv => (
              <tr key={inv.transactionId}>
                <td style={styles.td}>{inv.transactionId}</td>
                <td style={styles.td}>{inv.tranId}</td>
                <td style={styles.td}>{inv.tranDate}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // Rule 6: show address gaps
  if (flag.ruleId === 6 && fields.addresses?.length) {
    return (
      <div style={styles.fieldBox}>
        <div style={styles.fieldTitle}>Address issues:</div>
        {fields.addresses.map((a, i) => (
          <div key={i} style={styles.fieldRow}>
            <span style={styles.fieldKey}>{a.type}</span>
            <span style={styles.fieldMissing}>Missing: {a.missingFields.join(', ')}</span>
          </div>
        ))}
      </div>
    );
  }

  // Generic field display
  const entries = Object.entries(fields).filter(([, v]) => v !== null && v !== undefined && !Array.isArray(v));
  if (!entries.length) return null;

  return (
    <div style={styles.fieldBox}>
      {entries.map(([k, v]) => (
        <div key={k} style={styles.fieldRow}>
          <span style={styles.fieldKey}>{k}</span>
          <span style={styles.fieldVal}>{String(v)}</span>
        </div>
      ))}
    </div>
  );
}

function ActionBtn({ label, color, bg, onClick, disabled }) {
  return (
    <button
      style={{ ...styles.actionBtn, color, background: bg, opacity: disabled ? 0.6 : 1 }}
      onClick={onClick}
      disabled={disabled}
    >
      {label}
    </button>
  );
}

const styles = {
  card: {
    background: '#fff',
    borderRadius: 8,
    boxShadow: '0 1px 3px rgba(0,0,0,0.07)',
    overflow: 'hidden',
    marginBottom: 8,
  },
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 16px',
    cursor: 'pointer',
    userSelect: 'none',
  },
  left: { display: 'flex', alignItems: 'center', gap: 10 },
  chevron: { fontSize: 16, color: '#9ca3af', width: 16 },
  company: { fontWeight: 600, fontSize: 14 },
  meta: { fontSize: 12, color: '#6b7a8d', marginTop: 2 },
  parentTag: {
    background: '#e5e7eb',
    borderRadius: 4,
    padding: '1px 6px',
    marginLeft: 8,
    fontSize: 11,
  },
  right: { display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 },
  ruleTag: {
    background: '#e0e7ff',
    color: '#3730a3',
    borderRadius: 4,
    padding: '2px 8px',
    fontSize: 11,
    fontWeight: 700,
  },
  statusBadge: {
    borderRadius: 12,
    padding: '2px 10px',
    fontSize: 12,
    fontWeight: 600,
  },
  nsLink: {
    fontSize: 12,
    color: '#1a56db',
    fontWeight: 500,
    whiteSpace: 'nowrap',
  },
  expandedBody: {
    borderTop: '1px solid #f3f4f6',
    padding: '14px 20px 16px',
  },
  ruleLabel: { fontWeight: 700, fontSize: 13, marginBottom: 4, color: '#374151' },
  detail: { fontSize: 13, color: '#4b5563', marginBottom: 12 },
  fieldBox: {
    background: '#f9fafb',
    borderRadius: 6,
    padding: '10px 12px',
    marginBottom: 14,
    fontSize: 13,
  },
  fieldTitle: { fontWeight: 600, marginBottom: 6 },
  fieldRow: { display: 'flex', gap: 8, marginBottom: 3 },
  fieldKey: { color: '#6b7280', minWidth: 140 },
  fieldVal: { color: '#111827', fontFamily: 'monospace' },
  fieldMissing: { color: '#dc2626', fontWeight: 500 },
  table: { width: '100%', borderCollapse: 'collapse', marginTop: 6 },
  th: { textAlign: 'left', fontWeight: 600, color: '#374151', padding: '4px 8px', borderBottom: '1px solid #e5e7eb', fontSize: 12 },
  td: { padding: '4px 8px', borderBottom: '1px solid #f3f4f6', color: '#374151', fontFamily: 'monospace', fontSize: 12 },
  reviewForm: { borderTop: '1px solid #f3f4f6', paddingTop: 12 },
  formRow: { display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 },
  label: { fontSize: 12, fontWeight: 600, color: '#374151' },
  input: {
    border: '1px solid #d1d5db',
    borderRadius: 6,
    padding: '6px 10px',
    fontSize: 13,
    outline: 'none',
    maxWidth: 300,
  },
  textarea: {
    border: '1px solid #d1d5db',
    borderRadius: 6,
    padding: '6px 10px',
    fontSize: 13,
    resize: 'vertical',
    outline: 'none',
    fontFamily: 'inherit',
  },
  error: { color: '#dc2626', fontSize: 13, marginBottom: 8 },
  reviewedInfo: { fontSize: 12, color: '#6b7280', marginBottom: 8 },
  actions: { display: 'flex', gap: 8 },
  actionBtn: {
    padding: '6px 14px',
    borderRadius: 6,
    fontWeight: 600,
    fontSize: 13,
    transition: 'opacity 0.15s',
  },
};
