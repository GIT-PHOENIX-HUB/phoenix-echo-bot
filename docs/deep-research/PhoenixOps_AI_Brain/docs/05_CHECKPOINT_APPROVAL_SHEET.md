# Checkpoint Approval Sheet

This is the exact approval gate map. Each checkpoint produces a “review bundle” you can inspect before continuing.

| Checkpoint | Cloud Writes? | What happens | What you review | How you approve |
|---|---:|---|---|---|
| CP-000 | No | Preflight checks | inputs + deps | Enter |
| CP-001 | No | Inventory + hashes | counts, dupes | Enter |
| CP-002 | No | Text extraction | error list | Enter |
| CP-003 | No | Entities build | customer/job totals | Enter |
| CP-004 | No | PII + sensitive scan | PII totals, cost fields | Enter |
| CP-005 | No | Build upload bundle | exact `_AI_MEMORY` tree | Enter |
| CP-006 | **YES** | Upload sanitized bundle to SharePoint | final preview + risk list | Type `APPROVE_UPLOAD_CP006` |
| CP-007 | Read-only | Verify upload | counts match | Enter |
| CP-008 | Optional | Build RAG indexes | index sizes | Enter |

**Hard rule:** If you don’t approve, the pipeline stops and nothing gets pushed.
