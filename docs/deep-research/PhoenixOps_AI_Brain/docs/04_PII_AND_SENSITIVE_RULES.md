# PII + Sensitive Data Rules (Hard Rules)

These rules are enforced in `phoenix_mask_upload_bundle.py`.

---

## 1) PII handling
**PII stays local.** Anything uploaded to SharePoint for the AI brain is masked.

### What we treat as PII
- Emails
- Phone numbers
- Street addresses
- SSN-like patterns
- Credit card-like patterns
- Customer personal names (for Residential) — optionally masked

### Default masking behavior (upload bundle)
- Email: `j***@domain.com`
- Phone: `(***) ***-**12`
- Address: keep only `City, State ZIP` (drop street)
- Serial numbers: keep last 4 chars only unless you decide otherwise

### Quarantine approach (never delete)
- We do not remove PII from local tables.
- We mark: `pii_flag=true` and `pii_types=[...]`
- We write `tables/pii_findings.csv`

---

## 2) Cost/margin handling (local only)
**Cost and margin NEVER go into `_AI_MEMORY/`.**

We treat these as sensitive:
- `cost`, `unit_cost`, `vendor_cost`
- `margin`, `margin_pct`
- any “profit” fields
- internal rate sheets

Upload bundle gets:
- list/retail price only (if you choose)
- or fully price-less items (if you choose)

---

## 3) Microsoft data handling
- Raw mailbox/email bodies and attachments are processed locally.
- Only sanitized summaries and/or filed documents you explicitly allow get uploaded into SharePoint.

---

## 4) No-delete posture
- No deletes, ever, unless you explicitly approve an archive action.
- If a record conflicts, both are kept and the contradiction is logged.
