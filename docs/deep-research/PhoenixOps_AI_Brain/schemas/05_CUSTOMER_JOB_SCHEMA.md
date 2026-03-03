# Customer/Job Master Schema (Full Template)

This schema is designed so **one customer record can support**:
- **NC** (New Construction)
- **Service**
- **Remodel**
- **Generator**

Even if a customer never uses a category, the columns exist and are left null.

---

## A) `entities_customers` (one row per customer)

### Identity
- `customer_id` (string) — ServiceTitan customer ID if available
- `customer_type` (enum) — Residential | Commercial | Builder | Unknown
- `name_display` (string) — what humans see (Company name or “First L.”)
- `name_full` (string) — local-only if residential (PII)
- `company_name` (string)
- `source_path` (string)
- `source_hash` (string sha256)

### Contacts (PII — local; masked in upload)
- `primary_email`
- `secondary_email`
- `primary_phone`
- `secondary_phone`
- `preferred_contact_method` (enum) — Phone | Email | Text | Unknown

### Addresses (PII — local; masked in upload)
- `service_address_line1`
- `service_address_line2`
- `service_city`
- `service_state`
- `service_zip`
- `billing_address_line1`
- `billing_city`
- `billing_state`
- `billing_zip`

### Customer status
- `membership_tier` (enum) — Bronze | Silver | Gold | None
- `tags` (array<string>)
- `first_seen_date` (date)
- `last_service_date` (date)
- `notes_rollup` (string)

---

## B) NC fields (nullable)
- `nc_builder_id`
- `nc_builder_name`
- `nc_subdivision`
- `nc_plan_name`
- `nc_lot_number`
- `nc_permit_number`
- `nc_rough_in_date`
- `nc_trim_date`
- `nc_final_date`
- `nc_inspection_status`

---

## C) Service fields (nullable)
- `service_preferred_tech`
- `service_dispatch_notes`
- `service_equipment_notes`
- `service_access_instructions`
- `service_last_invoice_date`
- `service_open_estimates_count`

---

## D) Remodel fields (nullable)
- `remodel_scope`
- `remodel_start_date`
- `remodel_target_finish_date`
- `remodel_permit_required` (bool)
- `remodel_primary_trade_partners` (array<string>)

---

## E) Generator fields (nullable)
- `gen_make` (e.g., Generac)
- `gen_model`
- `gen_serial` (PII-ish asset identifier; mask in upload)
- `gen_kw_rating`
- `gen_fuel_type` (NG | LP | Diesel | Unknown)
- `gen_install_date`
- `gen_warranty_end_date`
- `gen_ats_make`
- `gen_ats_model`
- `gen_last_service_date`
- `gen_next_service_due`
- `gen_notes`

---

## F) `customer_jobs` (one row per job/project)

### Core
- `job_id` (string)
- `job_number` (string)
- `customer_id` (string)
- `job_type` (enum) — NC | Service | Remodel | Generator
- `job_status` (enum) — Planned | Scheduled | InProgress | Complete | OnHold | Canceled
- `job_title`
- `job_address_line1` (PII — masked in upload)
- `job_city`
- `job_state`
- `job_zip`
- `scheduled_start`
- `scheduled_end`
- `tech_assigned`
- `source_path`

### Financial (LOCAL ONLY — never upload)
- `revenue_total` (optional, treat as SENSITIVE)
- `cost_total` (SENSITIVE)
- `margin_pct` (SENSITIVE)

---

## G) `customer_notes` (append-only)
- `note_id`
- `customer_id`
- `job_id` (nullable)
- `note_type` (enum) — general | dispatch | warranty | estimate | invoice | complaint | followup
- `note_text`
- `created_at`
- `created_by`
- `source_path`
- `source_doc_id`
- `pii_flag` (bool)

---

## H) `warranties_serials`
- `record_id`
- `customer_id`
- `job_id`
- `equipment_type`
- `manufacturer`
- `model`
- `serial`
- `installed_at`
- `warranty_end`
- `source_path`
- `source_doc_id`

---

## Sample rows (fake)

### entities_customers (fake)
```json
{
  "customer_id": "40123",
  "customer_type": "Residential",
  "name_display": "John S.",
  "company_name": null,
  "membership_tier": "Gold",
  "service_city": "Parker",
  "service_state": "CO",
  "service_zip": "80134",
  "gen_make": "Generac",
  "gen_kw_rating": 24
}
```

### customer_jobs (fake)
```json
{
  "job_id": "st_job_88991",
  "job_number": "J-2026-001",
  "customer_id": "40123",
  "job_type": "Generator",
  "job_status": "InProgress",
  "job_title": "Generac install",
  "job_city": "Parker",
  "job_state": "CO",
  "job_zip": "80134"
}
```
