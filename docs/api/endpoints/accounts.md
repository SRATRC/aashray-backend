# Accounts

Admin endpoints for financial transaction management and Razorpay settlement reconciliation.

**Base path:** `/api/v1/admin/accounts`
**Auth:** `auth` + `authorizeRoles(ROLE_SUPER_ADMIN, ROLE_ACCOUNTS_ADMIN, ROLE_PRA_ACCOUNTS_ADMIN)`

## Transaction Queries

| Method | Path | Description |
|--------|------|-------------|
| GET | `/fetchcompleted` | All completed transactions |
| GET | `/fetchpending` | All pending transactions |
| GET | `/fetchcredits` | All credit transactions |
| GET | `/fetchdebits` | All debit transactions |
| GET | `/credits` | Credit balances |
| GET | `/fetchcreditstransactions` | Credit transaction history |
| GET | `/fetchTransactions/:settlementId` | Transactions for a Razorpay settlement |
| GET | `/fetchTransactions/payment/:razorpay_order_id` | Transactions by Razorpay order ID |

## Settlement Management

### POST /setrep

Upload Razorpay settlement report via Excel file.

**Content-Type:** `multipart/form-data`

Parses the uploaded Excel file and inserts settlement records into the `razorpay_settlement` table.

### POST /updateset

Upload settlement reconciliation data via Excel file.

**Content-Type:** `multipart/form-data`

Parses the Excel file and inserts individual payment breakdowns into `razorpay_settlement_recon`, linking them to parent settlements.

### GET /fetchset

Fetch all settlement records.
