# Billing Assessment App

Proactive daily billing flag review for NetSuite — surfaces accounts with billing setup issues so your team can investigate and resolve them.

## What it flags

| Rule | Description |
|------|-------------|
| 1 | Sub-account is missing **Online Invoice Service** (custentity310) when sibling sub-accounts have it enabled |
| 2 | Customer has **none** of: Print Transactions, Invoices to Email, or Online Invoice Service enabled |
| 3 | **Invoices to Email** is checked but the customer's **Email field is blank** |
| 4 | Customer's email domain **doesn't match the majority domain** used by sibling sub-accounts under the same parent |
| 5 | Customer has **PO Required** set but one or more open invoices are **missing a PO#** |
| 6 | Customer's default shipping or billing address is **missing** Addressee, Address 1, City, State, or Zip |

---

## Setup

### 1. NetSuite — create an Integration and Access Token

1. Go to **Setup > Integration > Manage Integrations > New**
   - Enable **Token-Based Authentication**
   - Note the **Consumer Key** and **Consumer Secret** (only shown once)

2. Go to **Setup > Users/Roles > Access Tokens > New**
   - Select the Integration you just created
   - Select the user who will run the app
   - Note the **Token ID** and **Token Secret** (only shown once)

3. The user running the app needs a role with at least:
   - **Lists > Customers** — View permission
   - **Transactions > Find Transaction** — View permission
   - **SuiteQL** access (under Setup > Company > Enable Features > SuiteCloud > SuiteQL)

### 2. Configure environment variables

```bash
cp .env.example .env
# Edit .env and fill in your NS_ credentials
```

### 3. Run locally

```bash
# Install server dependencies
cd server && npm install

# Install and build client
cd ../client && npm install && npm run build

# Run the server (serves the built client too)
cd .. && node server/index.js
# Open http://localhost:3001
```

### 4. Run in development mode (hot reload)

```bash
# Terminal 1 — server with auto-reload
cd server && npm run dev

# Terminal 2 — Vite dev server
cd client && npm run dev
# Open http://localhost:5173
```

---

## Deploy to Railway / Render

Both support Docker deployments with environment variables set via their dashboard.

1. Push this repo to GitHub
2. Connect the repo to Railway or Render
3. Set all `NS_*` environment variables in the platform's settings
4. Add a **persistent disk** mounted at `/app/data` (stores the SQLite review history)
5. Deploy — the server auto-builds the client and serves everything on one port

---

## SuiteQL field name notes

NetSuite SuiteQL field names can vary slightly between accounts depending on your version and customizations. If a rule returns errors, verify these field names against your schema:

| Field | SuiteQL column |
|-------|----------------|
| Online Invoice Service | `custentity310` |
| Invoices to Email | `custentity264` |
| PO Required | `custentity_po_required` |
| Address table | `customeraddressbook` + `customeraddressbookentityaddress` |

To check field names: **NetSuite > Setup > Customization > CRM Fields** or use the **Records Browser** at `https://<account>.app.netsuite.com/app/recordscatalog/rcbrowser.nl`.

---

## Architecture

```
billing-assessment/
├── server/
│   ├── index.js      — Express API, scan scheduling, caching
│   ├── netsuite.js   — TBA OAuth signing + SuiteQL/REST client
│   ├── rules.js      — All 6 billing rules as SuiteQL queries
│   └── db.js         — SQLite: review/dismiss history
├── client/
│   └── src/
│       ├── App.jsx          — Main dashboard
│       ├── components/
│       │   ├── SummaryBar.jsx   — Header stats + scan button
│       │   └── FlagRow.jsx      — Expandable flag card with review form
│       └── api.js           — Fetch helpers
├── Dockerfile
└── .env.example
```
