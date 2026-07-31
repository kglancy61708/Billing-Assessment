const fetch = require('node-fetch');

const { SF_CLIENT_ID, SF_CLIENT_SECRET, SF_LOGIN_URL } = process.env;

// Cached token — refreshed when expired
let _token = null;
let _tokenExpiry = 0;

async function getSFToken() {
  if (_token && Date.now() < _tokenExpiry) return _token;

  const url = `${SF_LOGIN_URL}/services/oauth2/token`;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: SF_CLIENT_ID,
    client_secret: SF_CLIENT_SECRET,
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Salesforce auth error ${res.status}: ${text}`);
  }

  const data = await res.json();
  _token = data;
  // expires_in is in seconds; subtract 60s buffer
  _tokenExpiry = Date.now() + ((data.expires_in ? data.expires_in - 60 : 7140) * 1000);
  return _token;
}

// Find a Salesforce Account Id by the NetSuite customer ID stored in the "NetSuite Id (IO)" field
// Field API name: celigo_sfnsio__NetSuite_Id__c (label: "NetSuite Id (IO)")
const NS_ID_FIELD = process.env.SF_NS_ID_FIELD || 'celigo_sfnsio__NetSuite_Id__c';

async function findAccountByNetSuiteId(netSuiteId) {
  const token = await getSFToken();
  const query = `SELECT Id FROM Account WHERE ${NS_ID_FIELD} = '${String(netSuiteId).replace(/'/g, "\\'")}' LIMIT 1`;
  const url = `${token.instance_url}/services/data/v58.0/query?q=${encodeURIComponent(query)}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Salesforce query error ${res.status}: ${text}`);
  }

  const data = await res.json();
  if (!data.records || data.records.length === 0) return null;
  return data.records[0].Id;
}

// Update a Salesforce Account's billing address fields
// Mapping from our internal field names to Salesforce field API names:
//   attention  → SF_ATTENTION_FIELD  (custom, e.g. Billing_Attention__c)
//   addressee  → SF_ADDRESSEE_FIELD  (custom, e.g. Billing_Addressee__c)
//   addr1      → BillingStreet       (standard compound component)
//   city       → BillingCity
//   state      → BillingState
//   zip        → BillingPostalCode
// addressType is 'billing', 'shipping', or 'billing & shipping'
async function updateAccountAddress(sfAccountId, addressFields, addressType = 'billing') {
  const token = await getSFToken();
  const url = `${token.instance_url}/services/data/v58.0/sobjects/Account/${sfAccountId}`;

  const isBilling  = !addressType || addressType.includes('billing');
  const isShipping = addressType.includes('shipping');

  const payload = {};
  if (isBilling) {
    if (addressFields.attention !== undefined) payload['Billing_Attention__c']  = addressFields.attention;
    if (addressFields.addressee !== undefined) payload['Billing_Addressee__c']  = addressFields.addressee;
    if (addressFields.addr1     !== undefined) payload.BillingStreet            = addressFields.addr1;
    if (addressFields.city      !== undefined) payload.BillingCity              = addressFields.city;
    if (addressFields.state     !== undefined) payload.BillingState             = addressFields.state;
    if (addressFields.zip       !== undefined) payload.BillingPostalCode        = addressFields.zip;
  }
  if (isShipping) {
    if (addressFields.attention !== undefined) payload['Shipping_Attention__c'] = addressFields.attention;
    if (addressFields.addressee !== undefined) payload['Shipping_Addressee__c'] = addressFields.addressee;
    if (addressFields.addr1     !== undefined) payload.ShippingStreet           = addressFields.addr1;
    if (addressFields.city      !== undefined) payload.ShippingCity             = addressFields.city;
    if (addressFields.state     !== undefined) payload.ShippingState            = addressFields.state;
    if (addressFields.zip       !== undefined) payload.ShippingPostalCode       = addressFields.zip;
  }

  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Salesforce update error ${res.status}: ${text}`);
  }

  return res.status === 204 ? { success: true } : res.json();
}

// Return the field names the server is using (for diagnostics)
function getSFFieldConfig() {
  return {
    nsIdField: NS_ID_FIELD,
    billingAttentionField: 'Billing_Attention__c',
    billingAddresseeField: 'Billing_Addressee__c',
    shippingAttentionField: 'Shipping_Attention__c',
    shippingAddresseeField: 'Shipping_Addressee__c',
  };
}

module.exports = { getSFToken, findAccountByNetSuiteId, updateAccountAddress, getSFFieldConfig };
