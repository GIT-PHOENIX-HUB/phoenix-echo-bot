# Build Doc — phoenix-echo-bot
**Owner:** GIT-PHOENIX-HUB | **Last Updated:** 2026-04-06

## Objectives

1. ~~Merge and stabilize all open channel branches into main.~~ **DONE** — All 6 channel branches merged via PRs #6-#11. Channel adapters live in `src/channels/`.
2. 2. ~~Apply the `feature/phoenix-apps-hardening-20260322-r2` hardening branch changes into main.~~ **DONE** — Merged via PR #3.
   3. 3. Add CLAUDE.md / AGENTS.md governance doc to the repo root (flagged MEDIUM in audit). **PENDING**
      4. 4. Establish a working test suite. **PARTIAL** — 4 test files now in `tests/` from parallel build extraction. Framework selection NEEDS SHANE INPUT.
         5. 5. Configure a linter (ESLint). **PENDING** — NEEDS SHANE INPUT on ruleset.
            6. 6. Resolve the `docs/deep-research/` archival question. **PENDING** — NEEDS SHANE INPUT.
               7. 7. Move `CODEX_TRANSFER_HANDOFF_2026-02-21.md` from repo root to `docs/`. **PENDING** — Still in root.
                 
                  8. ## Current State (as of 2026-04-06)
                 
                  9. **Branches:** 2 (main + claude/phoenix-parallel-build-8tcBF)
                  10. **Commits:** 17
                  11. **PRs:** 13 total (11 closed/merged, PR #12 closed, PR #13 merged)
                 
                  12. ### Source (`src/`)
                  13. - 4 directories: adapters/ (2), channels/ (6), contracts/, plugins/ (5)
                      - - 16 JS files including echo-identity.js, echo-persistence.js, gateway-client.js
                        - - Plugin system: electrical-guru, phoenix-knowledge, rexel, servicefusion, plugin-manager
                         
                          - ### Tests (`tests/`)
                          - - 4 test files: echo-persistence, gateway-client, message-router, plugin-manager
                            - - No test runner configured yet
                             
                              - ### Channels (`src/channels/`)
                              - - telegram.js, teams.js — fully built
                                - - whatsapp.js — built, currently disabled
                                  - - outlook.js, mini-app.js, command-app.js — scaffolds
                                   
                                    - ## Success Criteria
                                   
                                    - - [x] All channels/* remote branches merged or archived
                                      - [ ] - [x] feature/phoenix-apps-hardening merged (PR #3)
                                      - [ ] - [x] Parallel build unique files extracted to main (PR #13)
                                      - [ ] - [ ] CLAUDE.md / AGENTS.md added to repo root
                                      - [ ] - [ ] Linter (ESLint) configured and passing in CI
                                      - [ ] - [ ] Smoke test suite runs in CI
                                      - [ ] - [ ] CODEX_TRANSFER_HANDOFF moved from root to docs/
                                      - [ ] - [ ] docs/deep-research/ status decided
                                      - [ ] - [x] All secrets remain env: refs — no raw credentials committed
                                     
                                      - [ ] ## Change Process
                                     
                                      - [ ] All changes follow the Phoenix Electric governance model:
                                     
                                      - [ ] 1. **Branch:** Create feature branch from main
                                      - [ ] 2. **Develop:** Make changes with clear, atomic commits
                                      - [ ] 3. **PR:** Open pull request with description
                                      - [ ] 4. **Review:** Required approval from @GIT-PHOENIX-HUB/humans-maintainers
                                      - [ ] 5. **CI:** All status checks must pass (when configured)
                                      - [ ] 6. **Merge:** Squash merge to main
                                     
                                      - [ ] No force push. No direct commits to main. No deletion without guardian-override-delete label.
                                     
                                      - [ ] ## NEEDS SHANE INPUT
                                     
                                      - [ ] - **Test framework:** Jest or Node.js built-in node:test?
                                      - [ ] - **ESLint ruleset:** Standard, Airbnb, or custom?
                                      - [ ] - **deep-research/ disposition:** Keep, freeze, move, or remove?
                                      - [ ] - **Voice channel timeline:** Active or deferred?
                                      - [ ] - **Multi-agent routing timeline:** Active or deferred?
                                      - [ ] - **VPS deployment status:** Running on VPS, or only Mac Studio?
                                      - [ ] - **Overnight intel cron jobs:** Fully configured or still scaffolded?
