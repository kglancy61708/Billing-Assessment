const OAuth = require('oauth-1.0a');
const crypto = require('crypto');
const fetch = require('node-fetch');

const {
  NS_ACCOUNT_ID,
  NS_CONSUMER_KEY,
  NS_CONSUMER_SECRET,
  NS_TOKEN_ID,
  NS_TOKEN_SECRET,
} = process.env;

function getOAuth() {
  return OAuth({
    consumer: { key: NS_CONSUMER_KEY, secret: NS_CONSUMER_SECRET },
    signature_method: 'HMAC-SHA256',
    hash_function(base_string, key) {
      return crypto.createHmac('sha256', key).update(base_string).digest('base64');
    },
  });
}

function getBaseUrl() {
  const acct = NS_ACCOUNT_ID.replace(/_/g, '-').toLowerCase();
  return `https://${acct}.suitetalk.api.netsuite.com`;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function suiteQL(query, limit = 1000, offset = 0, retries = 6) {
  const url = `${getBaseUrl()}/services/rest/query/v1/suiteql?limit=${limit}&offset=${offset}`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const oauth = getOAuth();
    const token = { key: NS_TOKEN_ID, secret: NS_TOKEN_SECRET };
    const authData = oauth.authorize({ url, method: 'POST' }, token);
    const authHeader = oauth.toHeader(authData);
    authHeader.Authorization = authHeader.Authorization.replace(
      'OAuth ', `OAuth realm="${NS_ACCOUNT_ID.toUpperCase()}",`
    );

    const res = await fetch(url, {
      method: 'POST',
      headers: { ...authHeader, 'Content-Type': 'application/json', prefer: 'transient' },
      body: JSON.stringify({ q: query }),
    });

    if (res.status === 429 && attempt < retries) {
      await sleep(5000 * (attempt + 1)); // 5s, 10s, 15s, 20s, 25s
      continue;
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`NetSuite SuiteQL error ${res.status}: ${text}`);
    }

    return res.json();
  }
}

// Paginate through all results automatically
async function suiteQLAll(query) {
  const pageSize = 1000;
  let offset = 0;
  let allItems = [];

  while (true) {
    const data = await suiteQL(query, pageSize, offset);
    allItems = allItems.concat(data.items || []);
    if (!data.hasMore) break;
    offset += pageSize;
  }

  return allItems;
}

// Update a customer record via REST record API
async function updateCustomer(customerId, fields) {
  const url = `${getBaseUrl()}/services/rest/record/v1/customer/${customerId}`;
  const oauth = getOAuth();
  const token = { key: NS_TOKEN_ID, secret: NS_TOKEN_SECRET };

  const authData = oauth.authorize({ url, method: 'PATCH' }, token);
  const authHeader = oauth.toHeader(authData);
  authHeader.Authorization = authHeader.Authorization.replace(
    'OAuth ', `OAuth realm="${NS_ACCOUNT_ID.toUpperCase()}",`
  );

  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      ...authHeader,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(fields),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`NetSuite update error ${res.status}: ${text}`);
  }

  return res.status === 204 ? { success: true } : res.json();
}

// Fetch specific fields from a customer record
async function getCustomerFields(customerId, fieldList, retries = 6) {
  const fields = Array.isArray(fieldList) ? fieldList.join(',') : fieldList;
  const url = `${getBaseUrl()}/services/rest/record/v1/customer/${customerId}?fields=${fields}`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const oauth = getOAuth();
    const token = { key: NS_TOKEN_ID, secret: NS_TOKEN_SECRET };
    const authData = oauth.authorize({ url, method: 'GET' }, token);
    const authHeader = oauth.toHeader(authData);
    authHeader.Authorization = authHeader.Authorization.replace(
      'OAuth ', `OAuth realm="${NS_ACCOUNT_ID.toUpperCase()}",`
    );

    const res = await fetch(url, { method: 'GET', headers: authHeader });

    if (res.status === 429 && attempt < retries) {
      await sleep(5000 * (attempt + 1));
      continue;
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`NetSuite getCustomerFields error ${res.status}: ${text}`);
    }

    return res.json();
  }
}

// Update an invoice/transaction record
async function updateTransaction(transactionId, fields, retries = 6) {
  const url = `${getBaseUrl()}/services/rest/record/v1/invoice/${transactionId}`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const oauth = getOAuth();
    const token = { key: NS_TOKEN_ID, secret: NS_TOKEN_SECRET };
    const authData = oauth.authorize({ url, method: 'PATCH' }, token);
    const authHeader = oauth.toHeader(authData);
    authHeader.Authorization = authHeader.Authorization.replace(
      'OAuth ', `OAuth realm="${NS_ACCOUNT_ID.toUpperCase()}",`
    );

    const res = await fetch(url, {
      method: 'PATCH',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
    });

    if (res.status === 429 && attempt < retries) {
      await sleep(5000 * (attempt + 1));
      continue;
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`NetSuite updateTransaction error ${res.status}: ${text}`);
    }

    return res.status === 204 ? { success: true } : res.json();
  }
}

// Update a customer address book entry
async function updateCustomerAddress(customerId, addressbookId, addressFields, retries = 6) {
  const url = `${getBaseUrl()}/services/rest/record/v1/customer/${customerId}`;
  const payload = {
    addressbook: {
      items: [{ id: String(addressbookId), addressbookaddress: addressFields }],
    },
  };

  for (let attempt = 0; attempt <= retries; attempt++) {
    const oauth = getOAuth();
    const token = { key: NS_TOKEN_ID, secret: NS_TOKEN_SECRET };
    const authData = oauth.authorize({ url, method: 'PATCH' }, token);
    const authHeader = oauth.toHeader(authData);
    authHeader.Authorization = authHeader.Authorization.replace(
      'OAuth ', `OAuth realm="${NS_ACCOUNT_ID.toUpperCase()}",`
    );

    const res = await fetch(url, {
      method: 'PATCH',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (res.status === 429 && attempt < retries) {
      await sleep(5000 * (attempt + 1));
      continue;
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`NetSuite updateCustomerAddress error ${res.status}: ${text}`);
    }

    return res.status === 204 ? { success: true } : res.json();
  }
}

// Fetch the addressbook sublist for a customer to get line IDs (not available via SuiteQL)
async function getCustomerAddressbook(customerId, retries = 6) {
  const url = `${getBaseUrl()}/services/rest/record/v1/customer/${customerId}/addressbook?limit=100`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const oauth = getOAuth();
    const token = { key: NS_TOKEN_ID, secret: NS_TOKEN_SECRET };
    const authData = oauth.authorize({ url, method: 'GET' }, token);
    const authHeader = oauth.toHeader(authData);
    authHeader.Authorization = authHeader.Authorization.replace(
      'OAuth ', `OAuth realm="${NS_ACCOUNT_ID.toUpperCase()}",`
    );

    const res = await fetch(url, { method: 'GET', headers: authHeader });

    if (res.status === 429 && attempt < retries) {
      await sleep(5000 * (attempt + 1));
      continue;
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`NetSuite getCustomerAddressbook error ${res.status}: ${text}`);
    }

    return res.json();
  }
}

function getRecordUrl(customerId) {
  const acct = NS_ACCOUNT_ID.replace(/_/g, '-').toLowerCase();
  return `https://${acct}.app.netsuite.com/app/common/entity/custjob.nl?id=${customerId}`;
}

function getSalesOrderUrl(soId) {
  const acct = NS_ACCOUNT_ID.replace(/_/g, '-').toLowerCase();
  return `https://${acct}.app.netsuite.com/app/accounting/transactions/salesord.nl?id=${soId}`;
}

async function getSalesOrder(soId, retries = 6) {
  const url = `${getBaseUrl()}/services/rest/record/v1/salesorder/${soId}?expandSubResources=true`;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const oauth = getOAuth();
    const token = { key: NS_TOKEN_ID, secret: NS_TOKEN_SECRET };
    const authData = oauth.authorize({ url, method: 'GET' }, token);
    const authHeader = oauth.toHeader(authData);
    authHeader.Authorization = authHeader.Authorization.replace('OAuth ', `OAuth realm="${NS_ACCOUNT_ID.toUpperCase()}",`);
    const res = await fetch(url, { method: 'GET', headers: authHeader });
    if (res.status === 429 && attempt < retries) { await sleep(5000 * (attempt + 1)); continue; }
    if (!res.ok) { const text = await res.text(); throw new Error(`NetSuite getSalesOrder error ${res.status}: ${text}`); }
    return res.json();
  }
}

// Creates a new sales order; returns the new SO's internal ID (parsed from Location header)
async function createSalesOrder(payload, retries = 6) {
  const url = `${getBaseUrl()}/services/rest/record/v1/salesorder`;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const oauth = getOAuth();
    const token = { key: NS_TOKEN_ID, secret: NS_TOKEN_SECRET };
    const authData = oauth.authorize({ url, method: 'POST' }, token);
    const authHeader = oauth.toHeader(authData);
    authHeader.Authorization = authHeader.Authorization.replace('OAuth ', `OAuth realm="${NS_ACCOUNT_ID.toUpperCase()}",`);
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.status === 429 && attempt < retries) { await sleep(5000 * (attempt + 1)); continue; }
    if (!res.ok) { const text = await res.text(); throw new Error(`NetSuite createSalesOrder error ${res.status}: ${text}`); }
    // 204 — new ID is in the Location header e.g. /services/rest/record/v1/salesorder/12345
    const loc = res.headers.get('location') || '';
    const match = loc.match(/\/salesorder\/(\d+)/i);
    if (!match) throw new Error(`createSalesOrder: cannot parse ID from Location: ${loc}`);
    return match[1];
  }
}

// Sets the end date on an existing SO to stop the invoice script from generating new invoices
async function setSOEndDate(soId, endDate, retries = 6) {
  const url = `${getBaseUrl()}/services/rest/record/v1/salesorder/${soId}`;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const oauth = getOAuth();
    const token = { key: NS_TOKEN_ID, secret: NS_TOKEN_SECRET };
    const authData = oauth.authorize({ url, method: 'PATCH' }, token);
    const authHeader = oauth.toHeader(authData);
    authHeader.Authorization = authHeader.Authorization.replace('OAuth ', `OAuth realm="${NS_ACCOUNT_ID.toUpperCase()}",`);
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ enddate: endDate }),
    });
    if (res.status === 429 && attempt < retries) { await sleep(5000 * (attempt + 1)); continue; }
    if (!res.ok) { const text = await res.text(); throw new Error(`NetSuite setSOEndDate error ${res.status}: ${text}`); }
    return res.status === 204 ? { success: true } : res.json();
  }
}

// Test REST Record API access to customer list
async function listCustomersREST(limit = 3) {
  const url = `${getBaseUrl()}/services/rest/record/v1/customer?limit=${limit}`;
  const oauth = getOAuth();
  const token = { key: NS_TOKEN_ID, secret: NS_TOKEN_SECRET };

  const authData = oauth.authorize({ url, method: 'GET' }, token);
  const authHeader = oauth.toHeader(authData);
  authHeader.Authorization = authHeader.Authorization.replace(
    'OAuth ', `OAuth realm="${NS_ACCOUNT_ID.toUpperCase()}",`
  );

  const res = await fetch(url, { method: 'GET', headers: authHeader });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`REST Record API error ${res.status}: ${text}`);
  }
  return res.json();
}

// Post a note to a customer record in NetSuite via custom record type customrecord3018
// custrecord3604 (Note Type list): Dismissed=1, Reviewed=2
// custrecord3605 (Flag Type list): Rule 1=1, Rule 2=2, ... Rule 6=6
async function createCustomerNote(customerId, noteText, status, ruleId, reviewedBy, retries = 6) {
  const url = `${getBaseUrl()}/services/rest/record/v1/customrecord3018`;
  const noteTypeId = status === 'reviewed' ? '2' : '1';

  const payload = {
    custrecord3601: { id: String(customerId) },   // customer link
    custrecord3602: reviewedBy || '',              // reviewer name (free text)
    custrecord3604: { id: noteTypeId },            // note type (Dismissed/Reviewed)
    custrecord3605: { id: String(ruleId) },        // flag type (rule 1-6)
    custrecord3603: noteText,                      // note text
  };

  const body = JSON.stringify(payload);

  for (let attempt = 0; attempt <= retries; attempt++) {
    const oauth = getOAuth();
    const token = { key: NS_TOKEN_ID, secret: NS_TOKEN_SECRET };
    const authData = oauth.authorize({ url, method: 'POST' }, token);
    const authHeader = oauth.toHeader(authData);
    authHeader.Authorization = authHeader.Authorization.replace(
      'OAuth ', `OAuth realm="${NS_ACCOUNT_ID.toUpperCase()}",`
    );

    const res = await fetch(url, {
      method: 'POST',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body,
    });

    if (res.status === 429 && attempt < retries) {
      await sleep(5000 * (attempt + 1));
      continue;
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`NetSuite note error ${res.status}: ${text}`);
    }

    return res.status === 204 ? { success: true } : res.json();
  }
}

// Fetch a single customer record via REST and return a specific field's refName (display value)
async function getFieldRefName(customerId, fieldName) {
  const url = `${getBaseUrl()}/services/rest/record/v1/customer/${customerId}?fields=${fieldName}`;
  const oauth = getOAuth();
  const token = { key: NS_TOKEN_ID, secret: NS_TOKEN_SECRET };
  const authData = oauth.authorize({ url, method: 'GET' }, token);
  const authHeader = oauth.toHeader(authData);
  authHeader.Authorization = authHeader.Authorization.replace(
    'OAuth ', `OAuth realm="${NS_ACCOUNT_ID.toUpperCase()}",`
  );
  const res = await fetch(url, { method: 'GET', headers: authHeader });
  if (!res.ok) return null;
  const data = await res.json();
  const val = data[fieldName];
  if (!val) return null;
  return val.refName || val.name || null;
}

module.exports = { suiteQL, suiteQLAll, updateCustomer, getRecordUrl, getSalesOrderUrl, listCustomersREST, createCustomerNote, getFieldRefName, getCustomerFields, updateTransaction, updateCustomerAddress, getCustomerAddressbook, getSalesOrder, createSalesOrder, setSOEndDate };
