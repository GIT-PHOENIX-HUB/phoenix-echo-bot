# Data Quality Rules (What gets flagged)

We do not delete bad data. We flag it.

## Dedupe
- Dedupe by SHA256.
- Keep the first path as canonical, store the rest as duplicates list.

## Date sanity
- No future dates (flag)
- Missing/invalid dates (flag)

## Amount sanity
- Negative totals (flag)
- Zero-priced line items (flag)
- Extreme totals (flag)

## Address sanity
- Anything outside expected regions (flag as “out-of-region”)

## Permissions anomalies
If permissions are available (Graph pull or export metadata):
- inheritance breaks (flag)
- external principals (flag)
- write access to protected areas (flag)

Outputs:
- `markdown/data_quality.md`
- `tables/pii_findings.csv`
