# Billing Assessment App

Proactive billing flag review for NetSuite — surfaces accounts with billing setup issues so your team can investigate and resolve them. Flags are reviewed in-app and edits push back to NetSuite (or Salesforce for addresses).

## What it flags

| Rule | Description |
|------|-------------|
| 1 | Sub-account is missing **Online Invoice Service** when sibling sub-accounts under the same parent have it enabled |
| 2 | Customer has **none** of: Print Transactions, Invoices to Email, or Online Invoice Service enabled |
| 3 | **Invoices to Email** is checked but all email fields (Email, Invoice Email #1, Invoice Email #2) are blank |
| 4 | Any of the customer's email fields have a domain that **doesn't match the majority domain** used by sibling sub-accounts under the same parent |
| 5 | Customer has **PO Required** set but one or more open invoices are **missing a PO#** — auto-reopens if new non-PO invoices appear after a dismissal |
| 6 | Customer's default billing or shipping address is **missing** Addressee, Address 1, City, State, or Zip |

---

## Setup

### 1. NetSuite — create an Integration and Access Token

1. Go to **Setup > Integration > Manage Integrations > New**
   - Enable **Token-Based Authentication**
   - Note the **Consumer Key** and **Consumer Secret** (only shown once)

2. Go to **Setup > Users/Roles > Access Tokens > New**
   - Select the integration you just created and the user who will run the app
   - Note the **Token ID** and **Token Secret** (only shown once)

3. The user needs a role with at least:
   - **Lists > Customers** — View
   - **Transactions > Find Transaction** — View
   - **SuiteQL** access (Setup > Company > Enable Features > SuiteCloud > SuiteQL)

### 2. Salesforce — create a Connected App (for Rule 6 address saves)

1. Go to **Setup > App Manager > New Connected App**
   - Enable **OAuth Settings**
   - Add scope: **Manage user data via APIs (api)**
   - Enable **Client Credentials Flow** and assign a Run-As user
2. Note the **Consumer Key** (Client ID) and **Consumer Secret**
3. Your login URL is typically `https://login.salesforce.com` (or your My Domain URL)

### 3. Configure environment variables

Copy `.env.example` to `.env` and fill in all values:

```
NS_ACCOUNT_ID=       # e.g. 1234567 or 1234567_SB1
NS_CONSUMER_KEY=
NS_CONSUMER_SECRET=
NS_TOKEN_ID=
NS_TOKEN_SECRET=

SF_CLIENT_ID=        # Salesforce Connected App Consumer Key
SF_CLIENT_SECRET=    # Salesforce Connected App Consumer Secret
SF_LOGIN_URL=        # e.g. https://login.salesforce.com

DATA_DIR=./data      # where review history JSON is stored
```

### 4. Run locally

```bash
cd server && npm install
node index.js
# Open http://localhost:3001
```

---

## Deploy to Railway

1. Push this repo to GitHub and connect it to a Railway project
2. Set all environment variables (`NS_*` and `SF_*`) in Railway's variable settings
3. Add a **persistent volume** mounted at `/app/data` — this is where review and scan history is stored as JSON files
4. Railway auto-deploys on every push; the server serves the client from `client/index.html` on one port

---

## How it works

On startup (and on demand via the **Run Scan** button), the server runs all 6 rules as SuiteQL queries against your NetSuite account. Results are cached in memory and merged with the review history on every page load.

- **Open** — new flag, not yet actioned
- **Reviewed** — team has looked at it and confirmed it's correct or being handled
- **Dismissed** — intentionally ignored (note required); persists across scans unless the underlying data changes (Rule 5 auto-reopens on new invoices)

Review state is stored in `data/reviews.json`. Scan history is in `data/scans.json`.

---

## Editing flags in-app

Each flag card has an **Edit in NetSuite** panel:

| Rule | Editable fields | Saves to |
|------|-----------------|----------|
| 1 | Online Invoice Service toggle | NetSuite |
| 2 | Print Transactions, Invoices to Email, Online Invoice Service, Invoice Email #1/#2, Statement Email #1/#2, email | NetSuite |
| 3 | Invoices to Email, Email, Invoice Email #1, Invoice Email #2 | NetSuite |
| 4 | Email, Invoice Email #1, Invoice Email #2 | NetSuite |
| 5 | PO Required toggle (customer); PO# per invoice | NetSuite |
| 6 | Attention, Addressee, Street, City, State, Zip | Salesforce (syncs to NetSuite via Celigo) |

---

## Architecture

```
billing-assessment/
├── server/
│   ├── index.js        — Express API, scan cache, flag endpoints
│   ├── netsuite.js     — TBA OAuth + SuiteQL/REST client
│   ├── salesforce.js   — OAuth client credentials + Account PATCH for addresses
│   ├── rules.js        — All 6 billing rules (SuiteQL queries + JS logic)
│   └── db.js           — JSON-file store for review history and scan log
├── client/
│   └── index.html      — Single-page dashboard (vanilla JS, no build step)
├── Dockerfile
└── .env.example
```

---

## SuiteQL field reference

| Field | SuiteQL column |
|-------|----------------|
| Online Invoice Service | `custentity310` |
| Invoices to Email | `custentity264` |
| Invoice Email #1 | `custentity562` |
| Invoice Email #2 | `custentity563` |
| PO Required | `custentity_po_required` |
| Address table | `customeraddressbook` + `customeraddressbookentityaddress` |

> **Note:** SuiteQL runs on Oracle. Empty string (`''`) is treated as NULL, so always use `IS NOT NULL` rather than `!= ''` in WHERE clauses.

To verify field names for your account: **NetSuite > Setup > Customization > Entity Fields**, or use the Records Browser at `https://<account>.app.netsuite.com/app/recordscatalog/rcbrowser.nl`.

---

## Salesforce field reference

Address saves for Rule 6 use the following Salesforce Account fields:

| Our field | Salesforce field |
|-----------|-----------------|
| Attention | `Billing_Attention__c` / `Shipping_Attention__c` |
| Addressee | `Billing_Addressee__c` / `Shipping_Addressee__c` |
| Street | `BillingStreet` / `ShippingStreet` |
| City | `BillingCity` / `ShippingCity` |
| State | `BillingState` / `ShippingState` |
| Zip | `BillingPostalCode` / `ShippingPostalCode` |

The NetSuite Account is looked up in Salesforce via the **NetSuite Id (IO)** field (`celigo_sfnsio__NetSuite_Id__c`), populated by the Celigo integration.
