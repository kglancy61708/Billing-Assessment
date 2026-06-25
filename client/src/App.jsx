import React, { useEffect, useState, useCallback } from 'react';
import SummaryBar from './components/SummaryBar';
import FlagRow from './components/FlagRow';
import { getFlags, getSummary, triggerScan, getScanStatus } from './api';

const RULE_OPTIONS = [
  { value: '', label: 'All Rules' },
  { value: '1', label: 'Rule 1 — Missing Online Invoice vs. Siblings' },
  { value: '2', label: 'Rule 2 — No Delivery Method' },
  { value: '3', label: 'Rule 3 — Email Flag, No Address' },
  { value: '4', label: 'Rule 4 — Email Domain Mismatch' },
  { value: '5', label: 'Rule 5 — PO Required, Missing on Invoice' },
  { value: '6', label: 'Rule 6 — Incomplete Address' },
];

export default function App() {
  const [flags, setFlags] = useState([]);
  const [summary, setSummary] = useState({ open: 0, reviewed: 0, dismissed: 0, total: 0 });
  const [scannedAt, setScannedAt] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState('open');
  const [ruleFilter, setRuleFilter] = useState('');
  const [search, setSearch] = useState('');

  const loadData = useCallback(async () => {
    try {
      const [flagData, sumData] = await Promise.all([
        getFlags(),
        getSummary(),
      ]);
      setFlags(flagData.flags || []);
      setScannedAt(flagData.scannedAt);
      setScanning(flagData.scanning || false);
      setSummary(sumData);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Poll while scanning
  useEffect(() => {
    if (!scanning) return;
    const interval = setInterval(async () => {
      const status = await getScanStatus().catch(() => null);
      if (status && !status.scanning) {
        setScanning(false);
        await loadData();
        clearInterval(interval);
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [scanning, loadData]);

  async function handleScan() {
    setScanning(true);
    await triggerScan().catch(() => {});
  }

  function handleFlagUpdate(customerId, ruleId, changes) {
    setFlags(prev => prev.map(f =>
      f.customerId === customerId && f.ruleId === ruleId
        ? { ...f, ...changes }
        : f
    ));
    // Recompute summary counts locally
    setSummary(prev => {
      const oldStatus = flags.find(f => f.customerId === customerId && f.ruleId === ruleId)?.status || 'open';
      const newStatus = changes.status;
      if (oldStatus === newStatus) return prev;
      return {
        ...prev,
        [oldStatus]: Math.max(0, (prev[oldStatus] || 0) - 1),
        [newStatus]: (prev[newStatus] || 0) + 1,
      };
    });
  }

  // Apply filters
  const filteredFlags = flags.filter(f => {
    if (statusFilter && f.status !== statusFilter) return false;
    if (ruleFilter && String(f.ruleId) !== ruleFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (
        !f.companyName?.toLowerCase().includes(q) &&
        !f.customerId?.toLowerCase().includes(q)
      ) return false;
    }
    return true;
  });

  return (
    <div style={styles.app}>
      <SummaryBar
        summary={summary}
        scanning={scanning}
        scannedAt={scannedAt}
        onScan={handleScan}
        flags={flags}
      />

      <div style={styles.content}>
        <div style={styles.toolbar}>
          <input
            style={styles.search}
            placeholder="Search by name or ID…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <select style={styles.select} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">All Statuses</option>
            <option value="open">Open</option>
            <option value="reviewed">Reviewed</option>
            <option value="dismissed">Dismissed</option>
          </select>
          <select style={styles.select} value={ruleFilter} onChange={e => setRuleFilter(e.target.value)}>
            {RULE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <span style={styles.count}>
            {filteredFlags.length} flag{filteredFlags.length !== 1 ? 's' : ''}
          </span>
        </div>

        {loading && <div style={styles.center}>Loading flags…</div>}
        {error && <div style={styles.errorBanner}>Error: {error}</div>}
        {scanning && !loading && (
          <div style={styles.scanBanner}>Scan in progress — results will update automatically…</div>
        )}

        {!loading && !error && filteredFlags.length === 0 && (
          <div style={styles.empty}>
            {flags.length === 0
              ? scanning ? 'Scan running…' : 'No flags found. Run a scan to check your accounts.'
              : 'No flags match the current filters.'}
          </div>
        )}

        <div style={styles.list}>
          {filteredFlags.map(f => (
            <FlagRow
              key={`${f.customerId}-${f.ruleId}`}
              flag={f}
              onUpdate={handleFlagUpdate}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

const styles = {
  app: { minHeight: '100vh', display: 'flex', flexDirection: 'column' },
  content: { padding: '20px 28px', flex: 1 },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    marginBottom: 16,
    flexWrap: 'wrap',
  },
  search: {
    border: '1px solid #d1d5db',
    borderRadius: 6,
    padding: '7px 12px',
    fontSize: 13,
    outline: 'none',
    minWidth: 220,
  },
  select: {
    border: '1px solid #d1d5db',
    borderRadius: 6,
    padding: '7px 10px',
    fontSize: 13,
    background: '#fff',
    cursor: 'pointer',
    outline: 'none',
  },
  count: { marginLeft: 'auto', fontSize: 13, color: '#6b7280' },
  list: {},
  center: { textAlign: 'center', color: '#6b7280', padding: '60px 0' },
  empty: { textAlign: 'center', color: '#6b7280', padding: '60px 0', fontSize: 15 },
  errorBanner: {
    background: '#fef2f2',
    border: '1px solid #fca5a5',
    borderRadius: 6,
    padding: '10px 14px',
    color: '#dc2626',
    marginBottom: 14,
    fontSize: 13,
  },
  scanBanner: {
    background: '#eff6ff',
    border: '1px solid #bfdbfe',
    borderRadius: 6,
    padding: '10px 14px',
    color: '#1d4ed8',
    marginBottom: 14,
    fontSize: 13,
  },
};
