const BASE = import.meta.env.VITE_API_URL || '';

async function apiFetch(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

export const getFlags = (params = {}) => {
  const qs = new URLSearchParams(params).toString();
  return apiFetch(`/api/flags${qs ? '?' + qs : ''}`);
};

export const getSummary = () => apiFetch('/api/summary');

export const triggerScan = () => apiFetch('/api/scan', { method: 'POST' });

export const getScanStatus = () => apiFetch('/api/scan/status');

export const updateFlag = (customerId, ruleId, body) =>
  apiFetch(`/api/flags/${customerId}/${ruleId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
