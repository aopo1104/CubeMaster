# CubeMaster API capabilities and integration steps

This document summarizes what is verified from live calls and what is inferred for a standard product-to-pallet workflow.

## 1) Verified capabilities

The following points are verified by real requests in this workspace:

1. Authentication uses header `TokenID: <token>`.
2. `GET /Loads` works and returns load calculation results.
3. Invalid token returns `401` with `status: unable_to_signin`.
4. Valid token returns `200` and result items including:
   - calculation status/message
   - document metadata
   - loadSummary
   - filledContainers
   - manifest cargo details
5. `Allow` header on `/Loads` indicates `GET, POST`.

## 2) API abilities relevant to "calculate palletization from products"

For a product-based palletization flow, these are the core abilities you need:

1. Token validation
   - endpoint: `GET /Loads?limit=1`
   - purpose: check auth and connectivity
2. Submit a calculation task
   - endpoint: `POST /Loads`
   - purpose: send product list, container/pallet settings, and constraints
3. Query calculation result
   - endpoint: usually `GET /Loads/{id}` (common REST style)
   - fallback: use `GET /Loads?limit=n` and match by title/batch id
4. Read packing outputs
   - from response fields such as `loadSummary`, `filledContainers`, and `manifest`

## 3) Step-by-step integration in this workspace

Before running from browser, start local proxy backend:

```bash
node local_proxy.js
```

Then open:

```text
http://127.0.0.1:8000/
```

The page will call `/api/*` endpoints on local proxy and proxy will call CubeMaster API with `TokenID`.

## Step 1: Validate token

```bash
node cube_master.js check-token --token <YOUR_TOKEN>
```

Expected: `HTTP 200`.

Browser equivalent:

1. Fill `TokenID`
2. Click `Check Token`

## Step 2: Read existing load results

```bash
node cube_master.js list-loads --token <YOUR_TOKEN> --limit 1
```

Use this output to understand result schema in your account.

## Step 3: Submit product-based calculation

Prepare JSON payload (example in `sample_load_request.json`) and call:

```bash
node cube_master.js create-load --token <YOUR_TOKEN> --payload-file sample_load_request.json
```

Expected:
- Success response that includes load id or calculation info.
- If validation fails, server will return required-field details.

## Step 4: Query one load result

```bash
node cube_master.js get-load --token <YOUR_TOKEN> --load-id <LOAD_ID>
```

If your tenant does not support this path, use list API:

```bash
node cube_master.js list-loads --token <YOUR_TOKEN> --limit 10
```

## Step 5: Render result in UI

Map API output to UI cards/tables:

1. Summary card: `containersLoaded`, `volumeUtilization`, `weightUtilization`
2. Container list: each item in `filledContainers`
3. Cargo manifest table: each item in `manifest`
4. Warnings/errors: `status`, `message`, `calculationError`

## Step 6: Save input/output JSON to MySQL

Use the prepared SQL script in this workspace:

1. Open MySQL client and run:

```sql
SOURCE db/mysql_schema.sql;
```

2. The script creates:

- database: `cubemaster`
- table: `api_io_logs`
   - `input_json` (JSON)
   - `output_json` (JSON)
   - `created_at` (DATETIME, default current timestamp)

3. Verify:

```sql
USE cubemaster;
SELECT id, created_at FROM api_io_logs ORDER BY created_at DESC LIMIT 20;
```

## Step 7: Split logs by flow type (pallet vs pallet2ctn)

Run the timestamped migration file:

```sql
SOURCE db/20260424_155956_add_split_log_tables.sql;
```

It creates:

1. `pallet_load_logs`
   - `input_json`
   - `output_json`
   - `response_status`
   - `created_at`

2. `pallet2ctn_load_logs`
   - `flow_id`
   - `step1_input_json`, `step1_output_json`
   - `step2_input_json`, `step2_output_json`
   - `step1_status`, `step2_status`
   - `created_at`, `updated_at`

The proxy now writes by query markers:

- `flowType=pallet` → `pallet_load_logs`
- `flowType=pallet2ctn&flowId=...&step=1|2` → `pallet2ctn_load_logs`

## 4) Files provided in this workspace

1. `1.py`: CLI integration helper with step commands.
2. `sample_load_request.json`: starter payload template for `POST /Loads`.
3. `frontend_mock.html`: frontend page prototype and API-integration layout.

## 5) Notes

1. OpenAPI/Swagger endpoint is not publicly exposed at common URLs.
2. Because official schema was not publicly retrievable, payload fields in sample JSON are a starter template and may require adjustment based on server validation messages.
