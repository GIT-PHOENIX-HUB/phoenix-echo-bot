# Core Tables Schema (Inventory + Content)

These are the tables that make the export **analysis-ready**.

---

## `sites`
- `site_id`
- `url`
- `title`
- `created`
- `modified`

---

## `libraries_lists`
- `site_id`
- `list_id`
- `title`
- `type` (library | list | page)
- `item_count`
- `has_unique_perms`
- `retention_label`

---

## `fields`
- `list_id`
- `field_name`
- `type`
- `required`
- `choices` (json)

---

## `perms`
- `object_type` (site | list | folder | item)
- `object_id`
- `principal`
- `role`
- `inherited` (bool)
- `source` (export | graph | spec | unknown)

---

## `documents`
- `doc_id`
- `site_id`
- `library_id`
- `path`
- `title`
- `created`
- `modified`
- `author`
- `version`
- `hash`
- `mime`
- `pii_flag`
- `content` (full extracted text)

---

## `pages`
- `page_id`
- `site_id`
- `path`
- `title`
- `created`
- `modified`
- `author`
- `content` (flattened)
- `links_out` (json array)

---

## `nav_links`
- `from_path`
- `to_path`
- `anchor_text`
- `link_type` (internal | external)

---

## `file_hashes`
- `path`
- `sha256`
- `size_bytes`
- `modified`

---

## `relationships`
- `from_type` (document | page | email | job)
- `from_id`
- `to_type` (customer | job | service | vendor)
- `to_id`
- `relationship_type`
- `confidence`
- `evidence`
