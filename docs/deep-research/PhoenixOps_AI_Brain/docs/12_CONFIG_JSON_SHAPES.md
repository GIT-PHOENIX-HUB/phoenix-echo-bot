# Config JSON Shapes (What the scripts expect)

Based on your current dataset:

## 1) residential.json / commercial.json / builders.json
An array of customer objects like:

```json
{
  "serviceTitanId": "41010",
  "name": "Diane & Mike Mabbitt",
  "folderName": "Diane & Mike Mabbitt_41010",
  "type": "residential",
  "contact": {
    "firstName": "Diane",
    "lastName": "Mabbitt",
    "email": "diane_mabbitt@outlook.com",
    "phone": "(303) 726-4681"
  },
  "address": {
    "street": "11525 E Parker Rd",
    "city": "Parker",
    "state": "Colorado",
    "zip": "80138-7819"
  },
  "stats": {
    "totalJobs": 4,
    "totalSpend": 27702.68
  },
  "tags": ["high_value"],
  "aiNotes": ""
}
```

Notes:
- `stats.totalSpend` is treated as **SENSITIVE** by default.
- `aiNotes` is a good seed field for AI summaries.

## 2) customer_lookup_index.json (PII-heavy)
Shape:
- `stats.total_customers`
- `by_email` map: `email -> {folder,name,st_id,type}`
- `by_phone` map: `digits -> {folder,name,st_id,type}`

This file stays local; we generate a **hashed** version for SharePoint if you provide a salt.

## 3) email_routing_rules.json
Used for:
- category detection (receipt/invoice, vendor, scheduling, etc.)
- destination folder rules
- naming conventions
