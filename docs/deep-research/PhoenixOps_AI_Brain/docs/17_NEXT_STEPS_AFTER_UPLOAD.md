# After Upload: What You Do Next (MCP Bring-up)

Once `_AI_MEMORY/` is populated:

## 1) Validate SharePoint tree
- Confirm `_AI_MEMORY/Customers/` has one folder per customer_id
- Confirm `_AI_MEMORY/Internal/manifests/` has today’s run manifest
- Spot check 5 random customers

## 2) Connect MCP tools to the AI brain
- SharePoint tool: read-only for `_AI_MEMORY` by default
- Cosmos tool: optional (masked data only if you enforce PII-local)

## 3) Build embeddings/indexes
- Option A: keep indexes local and load into MCP store directly
- Option B: upload `rag/*.jsonl` to `_AI_MEMORY/Indexes/` and load from there

## 4) Turn on guardrails
- Approval workflow gating for “write actions”
- Security monitoring for permission drift in protected zones

## 5) Iterate without breaking anything
- Re-run pipeline on a new export snapshot
- Compare run manifests
- Only upload deltas (hash-based)
- Never delete historical runs

That’s how you scale to 1700+ customers without chaos.
