# Pricebook Build — Session Handoff (2026-01-31)

## What exists in this workspace
- `DR1_FULL_SOURCE/` — Deep Research Package #1 (inputs + rules + transcripts + vendor data)
- `DR2_FULL_SOURCE/` — Deep Research Package #2 (same payload; brief includes extra “Source File Clarification”)
- `DR2_FULL_SOURCE 2/` — exact duplicate of `DR2_FULL_SOURCE/` (no differences via `diff -rq`)
- `DR1_PRICEBOOK_PACKAGE.zip`, `DR2_PRICEBOOK_PACKAGE.zip` — zipped copies of DR1/DR2 bundles
- `Phoenix_Electric_Pricebook_7Tier_20260130.xlsx` — current build output workbook
- `build_pricebook.py` — empty (0B), no automated build script currently

## Source bundle status (DR1/DR2)
Both DR1 and DR2 contain:
- PB1–PB4 transcripts
- `Pricebook_Logic_Proof_v2.xlsx` (validated pricing math reference)
- `PRICEBOOK_SESSION_LOG_2026-01-28.md` (validation + green light)
- `PRICING_RULES.md`, `MATERIAL_LOGIC_RULES.md`, `CODE_TAXONOMY.md`
- `SERVICETITAN_SCOPE_MASTER.md` (170 codes)
- `REXEL_MASTER_PRICES.md` (1,549 SKUs), `REXEL_PRICEBOOK_MATCH_V3.md`
- eight *_COMPLETED.md BOM section docs

## Current build output status (Phoenix_Electric_Pricebook_7Tier_20260130.xlsx)
- Sheet set is correct: `ASSUMPTIONS`, `NC`, `RM`, `COM`, `COMRM`, `SVC`, `SP`, `GEN`, `MATERIALS`, `CHANGE_LOG`
- Tier sheets appear cloned from NC (same row counts)
- NC sheet contains **146** tier-coded rows (so it’s not yet at the stated **170** baseline)
- NC group counts (by code prefix segment):
  - `LT`: 44
  - `CKT`: 28
  - `SVC`: 18
  - `SW`: 17
  - `DEV`: 14
  - `TL`: 12
  - `SP`: 11
  - `ADM`: 2

## Noted consistency risk
- Source docs use base codes like `DEV_SW_1P`, `LT_CL3`, etc. (no tier prefix).
- The current workbook uses tier-prefixed codes but some families are in a different naming scheme (e.g. `NC_SW_SP` instead of `NC_DEV_SW_1P`).
- Decide a canonical scheme or create a mapping layer before finalizing ServiceTitan import.

## Recommendation
- Use `DR2_FULL_SOURCE/` as the canonical source bundle going forward.
- Keep building from `Phoenix_Electric_Pricebook_7Tier_20260130.xlsx` (it already has the correct sheet structure and tier propagation).
- Next concrete step: compute a “missing baseline” checklist by comparing the 146 NC codes in the workbook against the 170-code list in `DR2_FULL_SOURCE/SERVICETITAN_SCOPE_MASTER.md` (and detect renamed vs missing).
