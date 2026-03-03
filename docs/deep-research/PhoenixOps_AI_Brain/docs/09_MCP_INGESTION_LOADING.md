# MCP + AI Brain Loading Plan (SharePoint + Optional Cosmos)

Your architecture (per your docs) is:
1) **Fast memory** in Cosmos DB for lookups and state
2) **Permanent truth** in SharePoint (human browsable)
3) MCP tools read from both

---

## 1) Canonical truth
- SharePoint operational libraries remain the source of record.
- `_AI_MEMORY/` is the **AI-safe**, structured mirror (masked, no cost/margin).

---

## 2) What gets loaded where

### A) SharePoint `_AI_MEMORY/` (always)
- Sanitized customer profiles
- Sanitized job summaries
- Warranty/serial rollups (masked)
- Pricebook items (no cost/margin)
- Ops indexes (approvals, runbooks, change logs)
- RAG index jsonl files (optional but recommended)
- Manifests (audit + replay)

### B) Cosmos DB (optional but recommended)
Your docs describe Cosmos DB account `phoenix-ai-memory` with containers:
- `customers`
- `jobs`
- `interactions`
- `aiLearnings`
- `voiceProfiles`
All using `/partitionKey`.

Recommended partition keys:
- customers: `"customer"`
- jobs: `"job"`
- interactions: `"interaction"`
- approvals: `"approvals"` (if you keep approvals in Cosmos too)

**Important:** If you enforce “PII local only,” then Cosmos documents should use masked PII as well.

---

## 3) RAG index strategy (4 indexes)

### 1) customer_index
- chunks: customer summaries, job summaries, note summaries
- metadata: `customer_id`, `job_id`, `sensitivity`, `source_paths`

### 2) pricebook_index
- chunks: service/material/equipment descriptions (no cost)
- metadata: `code`, `category`, `labels`

### 3) ops_index
- chunks: runbooks, approvals, SOPs, monitoring
- metadata: `system_area`, `risk_level`

### 4) nav_index
- chunks: link graph (page ↔ doc ↔ customer)
- metadata: `from_path`, `to_path`

---

## 4) Cost/margin protection (enforced)
- Pricebook sync outputs that include cost stay local.
- AI brain gets “customer-facing” price data only.

---

## 5) OneDrive / linked content
We do not scrape OneDrive automatically.

We do:
- detect and index links found in docs/pages
- create `external_links.json` per customer/job
- optionally pull those linked files later under a separate approval checkpoint

---

## 6) Approvals / safety net integration
Anything that writes to SharePoint or Cosmos should create an approval record (even if it’s just a log entry).
Your CP gating is the human version of that rule.
