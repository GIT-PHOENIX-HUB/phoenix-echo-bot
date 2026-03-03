# Contradictions & Conflicts Log (Keep Both)

No-delete rule means we log conflicts and keep both versions.

## 1) Customer count
- Version A: “Auto-create **1700 customers**” (marketing/vision language in folder-creation part)
- Version B: Data files show **618 customers** total (576 residential, 24 commercial, 18 builders) and “1,704 job records”.

**What we do:** treat 618 as the *current known dataset size*, and treat 1700 as the *target/legacy expected count*. The pipeline supports incremental expansion without breaking IDs.

## 2) SharePoint site naming
- Version A: references `/sites/Phoenix`
- Version B: you specified target is PhoenixOps (`/sites/PhoenixOps`)

**What we do:** we parameterize SitePath. Nothing is hard-coded.

## 3) Tenant hostname references
- Version A: `phoenixelectriclife.sharepoint.com`
- Version B: `netorgft8573518.sharepoint.com`

**What we do:** we resolve SiteId by URL at runtime; we don’t assume hostname.

## 4) Lookup index storage vs PII rule
- Version A: upload `customer_lookup_index.json` into `_AI_MEMORY/Internal/` (enables cloud auto-filing)
- Version B: your rule says “PII stays local; mask for any cloud transmission”

**What we do:** default to **hashed lookup index** in SharePoint and keep raw index local.

## 5) “Microsoft data processed locally only” vs Graph-run runbooks
Some runbooks fetch mailbox content via Graph and store summaries in SharePoint.

**What we do:** we interpret your rule as “no third-party processing.” Graph/SharePoint are inside Microsoft 365, but we still only upload sanitized results into `_AI_MEMORY/`.

(If you want stricter: keep all email-derived content local and upload only non-email operational docs.)
