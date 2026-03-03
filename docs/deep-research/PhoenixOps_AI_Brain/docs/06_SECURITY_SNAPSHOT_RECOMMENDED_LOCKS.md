# Security Snapshot (Recommended Lock Zones)

You asked for four areas that should be protected. Here they are, with concrete “what to lock” recommendations.

## 1) Architecture / Runbooks
**Why:** This is the operating system of Phoenix. If altered, everything breaks or can be abused.

**Lock targets:**
- `_AI_SYSTEM/Runbooks/`
- `_AI_SYSTEM/Architecture/`
- `_AI_MEMORY/Ops/Runbooks/`
- Any folder containing `.ps1`, `.sh`, `.plist`, deployment scripts, or orchestrator code

**Who should have write:**
- Shane + IT only (Owners)
- Everyone else read-only

---

## 2) Integrations / Keys / Config
**Why:** Secrets, routing rules, tokens, vendor endpoints.

**Lock targets:**
- `_AI_SYSTEM/config/`
- `_AI_MEMORY/Internal/routing/`
- Any folder containing:
  - Key Vault secret name lists
  - API endpoints
  - connection strings
  - webhook URLs
  - routing rules

**Rule:**
- No plaintext secrets in SharePoint.
- Config files in SharePoint must not contain raw PII (prefer hashed mappings).

---

## 3) Deployment / CI-CD
**Why:** This is how changes ship.

**Lock targets:**
- `DEPLOYMENT/`
- `CI_CD/` (or your Git repo references)
- `Part 14 Deployment Checklist` artifacts
- Any “automation account import” scripts

**Rule:**
- Only Owners can change deployment instructions and scripts.

---

## 4) Security / Approvals
**Why:** This is the guardrail layer.

**Lock targets:**
- `_AI_MEMORY/Ops/Approvals/`
- `SECURITY/`
- Any monitoring runbooks, alert configs

**Rule:**
- Append-only logs; no one edits old approvals.

---

## Minimum permission model (simple and old-school)
- Owners: full control everywhere
- Editors: edit business docs, cannot touch AI system/config/runbooks
- Contributors: can add job photos/docs, cannot delete
- AI Service: write only to `_AI_MEMORY/` + limited operational drop zones
