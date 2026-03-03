---
title: "Phoenix Master Vision - Phoenix Builder Space"
version: "v1.0"
date: "2025-11-18"
author: "Shane Warehime"
primary_sources:
  - "Phoenix Builder Space Guide - Integrating ChatGPT (Codex) with Azure MCP"
  - "Technical Vision and Roadmap: AI-Powered ServiceTitan Backend Integration"
  - "Phoenix IDs and OIDC Config - Snapshot 2025-11-10"
  - "Credentials_Registry.md (pointers only)"
  - "Phoenix_Ai_Command_Runbook_v0.2.txt"
  - "Phoenix Memory System - Index and Starter Templates"
---

## Executive Summary
Phoenix Builder Space is a single conversational operating surface for Phoenix Electric. The front end is ChatGPT (Apps SDK), while Azure enforces orchestration, policy, secrets, and audit. The canonical architecture is a single TL MCP server that advertises tools to ChatGPT, forwards calls to Azure Functions and Logic Apps, and enforces authz/authn for read and write operations.

This preserves governance because AI does not hold raw credentials. It also supports a phased rollout:
1. Credentials and identity setup
2. Read-only backend APIs
3. ChatGPT connector and widgets
4. Webhooks and event flow
5. OAuth-gated write operations with approvals

Key pillars:
- Security-first: Key Vault, GitHub OIDC, Sites.Selected, PIM, breakglass
- Single MCP control plane: centralized tool policy and audit
- Incremental rollout: controlled progression with screenshot checkpoints

## Scope / Non-Goals
### Scope (in)
- Canonical system architecture: Apps SDK + TL MCP + Azure Functions/Logic Apps + Key Vault + ServiceTitan
- Phase 0-5 implementation plan with one-click screenshot checkpoints
- Memory stitching with hash-based module freshness
- Governance controls: Courier rule, Sites.Selected, PIM, breakglass, audit, acceptance tests

### Non-goals (out)
- Full production code generation beyond reviewed stubs
- Secret value export or storage in docs

## Chosen Architecture (canonical)
### Executive diagram (ASCII)
```text
           [User Chat: ChatGPT UI / Teams]
                        |
                        v
                (OpenAI Apps SDK)
                        |
                        v
                 [TL MCP server]
                 (tool registry, auth, logs)
            /        |          \       \
  /mcp/getDaily   /mcp/postTeams  /mcp/assignNearest ...  /.well-known/oauth-protected-resource
   JobSummary        Update             Technician                 (IDP discovery)
     |                 |                   |                      |
     v                 v                   v                      v
[Azu Functions / Logic Apps] <----> [Azure Key Vault (phoenixaaivault)]
         |   \            \
         |    \            \
         v     v            v
   [ServiceTitan API]  [Microsoft Graph / SharePoint]  [App Insights / Logging]
```

### Core components
- ChatGPT Apps SDK for conversational UX and widgets
- TL MCP server as the Phoenix MCP front door
- Azure Functions + Logic Apps for tool execution and orchestration
- Key Vault (`phoenixaaivault`) for secrets
- GitHub OIDC CI for secretless deployment auth
- ServiceTitan as field-service system of record
- SharePoint with Sites.Selected for scoped document operations

## Rationale
- One MCP front door centralizes policy, logging, and auth.
- Azure Functions/Logic Apps provide reliable retry, observability, and versioned deployment.
- Write tools remain behind OAuth 2.1 and human approval.

## Phased Implementation (0-5)
Each phase uses single-action screenshot checkpoints and expected evidence lines.

### Phase 0 - Prereqs (identity, secrets, repos)
0.1 Confirm Key Vault IAM role assignment for GitHub OIDC app.
0.2 Verify GitHub Actions variables are present.
0.3 Verify ServiceTitan secret names exist in Key Vault.

### Phase 1 - Backend read-only APIs
1.1 Create Function App and enable system-assigned identity.
1.2 Grant Key Vault Secrets User to function identity.
1.3 Deploy read-only endpoints.
1.4 Validate ServiceTitan read token flow.
1.5 Validate Graph app-only read for scoped mailbox.

### Phase 2 - Webhooks and event flow
2.1 Register ServiceTitan webhook in sandbox.
2.2 Transform and post event summaries to Teams.

### Phase 3 - MCP server and ChatGPT connector
3.1 Stand up TL MCP server with tool listing.
3.2 Add minimal widget and register connector in Apps SDK dev mode.
3.3 Connect in ChatGPT and verify test call success.

### Phase 4 - OAuth-gated write tools and approvals
4.1 Configure IDP for MCP OAuth.
4.2 Publish protected resource metadata.
4.3 Mark write tools as protected scopes.
4.4 Use two-step approval widget and verify log evidence.

### Phase 5 - Hardening and policy
5.1 Enforce Courier rule: no app-only external Mail.Send.
5.2 PIM and breakglass governance checks.
5.3 Monitoring and acceptance tests in App Insights + SharePoint logs.

## Memory Stitching
### Principles
- Mirror top-level headings from `Phoenix_Memory_Index.md`.
- Record every source module in `memory_manifest.yaml` with path, modified time, sha256, and role.
- Compare live sha256 against manifest to load only changed modules.

### Example memory manifest schema
```yaml
memory_manifest:
  - filename: "02_Vision_Strategy/Technical Vision and Roadmap.md"
    last_modified: "2025-11-18T18:36:31Z"
    sha256: "1de5e21fac3bf17f16e7f73536b84d8af43c05a98ed9dc1e34fbffa896b6e6ca"
    role: "governing"
```

### Loader behavior
On chat start:
1. Read `Phoenix_Master_Vision.md`, `credentials_summary.json`, and `memory_manifest.yaml`.
2. Recompute local hashes.
3. Reload only changed or missing modules.
4. Append run log and update manifest in CI.

## Governance and Security Rules
- PIM for privileged role activation.
- Breakglass account protected offline and excluded from routine automation.
- `appRoleAssignmentRequired=true` for Phoenix command enterprise app.
- No secret values in repo docs.
- Courier rule enforced for external outbound email.
- Sites.Selected permission model preferred over broad SharePoint scopes.
- All automation writes proofs to `99_Logs`.

## Runbooks and Playbooks
- `Phoenix_Ai_Command_Runbook_v0.2`
- Courier runbook and integration plan
- Open-items JSON for unresolved setup tasks
- Global update log pattern

## Appendix A - Evidence (selected)
Evidence assets are staged in `docs/phoenix-master-vision/evidence/`.
Some source screenshots were referenced in upstream material but not present in this repository snapshot. Placeholder evidence images are provided with canonical filenames to unblock documentation flow.

## Appendix B - File and Evidence Map
See `Appendix_B_File_Evidence_Map.csv`.

## Appendix C - Machine Summary JSON
```json
{
  "tenant": "phoenixelectric.life",
  "tenantId": "e7d8daef-fd5b-4e0b-bf8f-32f090c7c4d5",
  "subscriptionIds": [
    "d424241f-cf80-4660-adb9-613e7e017f95",
    "d244241f-cfb0-4660-adb9-613e7a01f795"
  ],
  "keyVaults": [
    {
      "name": "phoenixaaivault",
      "scope": "/subscriptions/d244241f-cfb0-4660-adb9-613e7a01f795/resourceGroups/.../providers/Microsoft.KeyVault/vaults/phoenixaaivault"
    }
  ],
  "coreApps": [
    {
      "name": "Phoenix_Ai_Command",
      "appId": "248f9e52-5385-48e0-a51e-7330edc59b69",
      "objectId": "f644ef62-47f0-42d7-b7af-289604ca36c9",
      "federatedCredSubjects": [],
      "roles": ["Operator"]
    },
    {
      "name": "GitHub-OIDC-ST_Directory_Assistant",
      "appId": "5cf388f1-4e0f-4545-88fd-547cca91f496",
      "objectId": "f633a758-f2cf-400d-b592-0c7ac05111b7",
      "federatedCredSubjects": [
        "repo:shane7777777777777/ST_Directory_Assistant:ref:refs/heads/main"
      ],
      "roles": ["Key Vault Secrets User"]
    }
  ]
}
```

## Acceptance Checklist
- [x] Memory manifest schema included
- [x] Canonical architecture documented with TL MCP + Apps SDK
- [x] Non-secret IDs and evidence steps listed
- [x] CI recipe and consolidation stub included
- [x] Evidence folder and credential artifacts included

## Issues_for_Shane
1. Missing canonical live files for exact replacement: `Phoenix_Memory_Index.md`, `Global_Update_Log.md`, `99_Logs/Global_Activity_Log.md`, full `Credentials_Registry.md`.
2. MCP OAuth IDP final decision: Entra-only vs Auth0/Stytch fallback for DCR.

## Next deliverables included in this bundle
1. `Phoenix_Master_Vision.pdf`
2. `Phoenix_Credentials_Inventory.md`
3. `Phoenix_Credentials_Inventory.csv`
4. `credentials_summary.json`
5. `memory_manifest.yaml`
6. `scripts/consolidate.py`
7. `.github/workflows/consolidation_ci.yml`
8. `evidence/` placeholders and appendix map
