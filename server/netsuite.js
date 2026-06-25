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

async function suiteQL(query, limit = 1000, offset = 0) {
  const url = `${getBaseUrl()}/services/rest/query/v1/suiteql?limit=${limit}&offset=${offset}`;
  const oauth = getOAuth();
  const token = { key: NS_TOKEN_ID, secret: NS_TOKEN_SECRET };

  const authHeader = oauth.toHeader(
    oauth.authorize({ url, method: 'POST' }, token)
  );

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      ...authHeader,
      'Content-Type': 'application/json',
      prefer: 'transient',
    },
    body: JSON.stringify({ q: query }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`NetSuite SuiteQL error ${res.status}: ${text}`);
  }

  return res.json();
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

  const authHeader = oauth.toHeader(
    oauth.authorize({ url, method: 'PATCH' }, token)
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

function getRecordUrl(customerId) {
  const acct = NS_ACCOUNT_ID.replace(/_/g, '-').toLowerCase();
  return `https://${acct}.app.netsuite.com/app/common/entity/custjob.nl?id=${customerId}`;
}

module.exports = { suiteQL, suiteQLAll, updateCustomer, getRecordUrl };
