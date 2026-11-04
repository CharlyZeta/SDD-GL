# Changelog

## [0.1.0] — 2025-07-01

### Initial release

- Gate protocol: refinamiento iterativo de spec con revisión humana obligatoria
- Loop protocol: ejecución autónoma con criterios inferidos del Contract
- Completion Map: persistencia de progreso por ítem en disco
- Crash recovery: reanudación desde el último punto guardado (⏳ al arrancar)
- Detección de contradicciones en Gate antes de permitir aprobación
- Ambiguity Log: escalado a Gate con descripción precisa del bloqueo
- Múltiples ciclos Gate/Loop por Contract con progreso acumulado
- Cuatro agentes bundled: requirements, coder, tester, reviewer
- Tres comandos: /sdd-feature, /sdd-fix, /sdd-status
- Stack-agnostic: stack.md opcional para convenciones de proyecto

## [0.2.0] — 2025-07-01

### Added — Multi-platform support

- Antigravity CLI support via `.agents/skills/` structure
- Antigravity IDE support (same skills directory)
- `AGENTS.md` — orchestrator for Antigravity (equivalent of CLAUDE.md)
- Nine Antigravity skills: sdd-gate, sdd-loop, sdd-feature, sdd-fix,
  sdd-status, sdd-requirements-agent, sdd-reviewer-agent, sdd-coder-agent,
  sdd-tester-agent
- Intent-matching triggers in all skill frontmatter (Antigravity auto-activates
  skills when user intent matches description/triggers)
- Updated plugin.json with multi-platform `platforms` section
- README installation section for Antigravity CLI and IDE
- Platform comparison table (Claude Code vs Antigravity)

### Unchanged

- protocol/ — 100% portable across all platforms
- contracts/ — same format on all platforms
- Gate/Loop logic — identical regardless of platform
- Completion Map format — identical

## [0.2.1] — 2026-08-10

### Fixed — Architectural and Protocol Enhancements

- **Split Gate Checklist**: Differentiated validation criteria in Gate mode between Features (`FEAT`) and Bugfixes (`FIX`). Bugfixes now require only Reproduction Steps and one Acceptance Criterion (`AC-001`), preventing them from getting stuck in Gate.
- **Immediate Escalation on Blockers**: Updated Loop execution logic to intercept `BLOCKED` (from coder-agent) and `NOT_WRITABLE` (from tester-agent) states, immediately triggering a return to Gate mode via the Ambiguity Log to prevent useless retry cycles.
- **Reviewer Retry Limit**: Introduced a limit of 1 reviewer-guided retry cycle in Loop mode to prevent infinite feedback loops.
- **Aligned Entity Invariants**: Removed the entity test row from criteria inference tables to keep the framework lightweight and avoid logical discrepancies.
- **QA Validated**: Architectural fixes reviewed and validated by the `sdd-tester-agent`.

## [0.3.0] — 2026-08-25

### Added — Adaptive Governance, Glass Box Telemetry, Presets & MCP Standard

- **Adaptive Gate Governance (`GATE-EXPRESS` vs. `GATE-STRICT`)**: Eliminates spec review fatigue by enabling 1-step approvals for bugfixes and small tasks, while reserving rigorous section-by-section reviews for complex domain features.
- **Glass Box Loop (Audit & Telemetry)**: The Loop now generates an auditable execution trace in `.sdd/runs/[ID]-[timestamp].md` detailing context files inspected, diffs generated, test runner outputs, retry counts, and decision rationales.
- **Official Stack Presets**: Added zero-config presets in `presets/` for Java Spring Boot 3.x (Hexagonal/DDD), Python FastAPI (Pydantic v2/Async), and TypeScript Node.js/Bun.
- **Model Context Protocol (MCP) Server Specification**: Added `mcp/sdd-gl-mcp-spec.md` with standard JSON-RPC tool schemas (`sdd_create_contract`, `sdd_validate_gate`, `sdd_step_loop`, `sdd_log_ambiguity`, `sdd_get_status`), making SDD-GL 100% agnostic to any IDE or LLM runtime.

## [0.4.0] — 2026-10-02

### Added — Layered Verification (AC/DC Layer), Auto-Repair, Metrics & Executable MCP Server

- **Layered Verification Protocol (AC/DC Layer)**: Extended the Completion Map to support multi-layer verification: `functional` (unit/integration/assertions), `static` (strict types & linter), `security` (vulnerabilities & secrets), and `arch` (architectural boundaries against `CONSTITUTION.md`).
- **Rapid Auto-Repair (`solve-agent` / `sdd-solve-agent`)**: Added specialized repair subagent that fixes localized syntax, lint, typing, and test assertion findings in $\le 3$ attempts without modifying public interfaces or business rules.
- **Verification Agent (`verifier-agent` / `sdd-verifier-agent`)**: Subagent dedicated to running and verifying static, security, and architectural guardrail layers.
- **Quality & Delivery Metrics (`/sdd-metrics`)**: Real-time computation and display of First-Pass Quality Rate (FPQR), average retries, and layer pass rates backed by `.sdd/metrics.json`.
- **Traceability Audit (`/sdd-audit`)**: Non-blocking inspection reporting orphan specifications (specs without tests) and untracked domain code (code without specs).
- **Executable MCP Server (`@sdd-gl/mcp-server`)**: Standard Node.js JSON-RPC stdio server in `mcp/server.js` implementing tools for contracts, gate validation, loop execution, metrics, and audits.
- **Project Constitution (`CONSTITUTION.md`)**: Optional high-level architectural rules and security guardrails respected by all agents in the Loop.

## [0.5.0] — 2026-10-20

### Added — Interop Mode, Inferred Assumptions, deterministic ledger, honest metrics & CI

- **Behavioral Skills Interop (`protocol/interop.md`)**: Additive protocol that resolves conflicts between the Gate/Loop state machine and global behavioral skills. Declares protocol precedence, routes every "ask" through the Ambiguity Log instead of inline questions, anchors each modified line to the approved Contract, forbids trimming the framework ceremonial, and subordinates a skill's "what I skipped" closing to the official `COMPLETION REPORT`. Without active behavioral skills it is a no-op. Wired into the startup sequence and per-agent context of `CLAUDE.md` and `AGENTS.md`.
- **Inferred Assumptions (`## Inferred Assumptions`)**: Optional, non-normative contract section (`AS-XX`) where the requirements agent records every inference it made, with the impact if it is wrong. Open items block approval; confirmed or refuted items stay as an audit trail. Assumptions never generate Completion Map criteria.
- **Deterministic Loop ledger (`sdd_step_loop`)**: The tool now builds and persists the Completion Map from the inference table when missing, claims an item (persists `⏳` and returns its context) and records the agent-reported outcome (`result` + `evidence`). State is persisted before and after every item; the server no longer fabricates `PASS`.
- **Quality metrics ledger (`.sdd/metrics.json`)**: Single source of truth for FPQR, average retries, per-layer success rates and ambiguity escalation rate. Written atomically after each Loop step; `sdd_get_metrics` returns real values (explicit zeroed defaults only when the file is absent) and the dashboard consumes the ledger.
- **Gate validator & traceability audit**: `sdd_validate_gate` enforces the structural checklist per contract type and detects BR↔AC contradictions; `sdd_audit_traceability` computes real coverage and lists genuine orphan specs instead of fixed numbers.
- **GitHub Actions CI (`.github/workflows/test.yml`)**: Runs the full suite on push and PR, verifies the MCP server exposes exactly 8 tools and answers over stdio JSON-RPC, and fails if the tracked tree is dirty. Reproducible on a clean clone without the private `contracts/` or `.sdd/` state.
- **Local MCP usage telemetry (`.sdd/usage.json`)**: Every tool invocation is counted locally (tool name, success/error, sessions, declared `clientInfo`), with atomic writes and no network calls. The dashboard renders this as "Uso local del MCP" and says "sin datos" when the ledger is empty. The generated HTML carries the data inline, so any user can publish it as their own methodology usage metric. There is no global aggregation by design, and every previously fabricated figure (requests, platform split, solve rate, historical quality curve) was removed.




## [0.5.1] — 2026-11-02

### Added — neutral format, CLI, atomicity and per-project usage

- **Neutral contract format**: section aliases (English and Spanish, including `## Pasos` and `## Reproduction Steps`), numbered steps written as lists or headings, contract type resolved from front-matter or ID instead of a hardcoded prefix, and contracts located by ID so campaign-style file names work. A valid FIX is no longer rejected for being written in Spanish.
- **Read-only tools never write**: `ensureDirs` was split so only write paths create `contracts/` or `.sdd/`; telemetry does not create the ledger in an uninitialized project either.
- **CLI (`sdd`)**: `status`, `new`, `validate`, `next` and `report`, with `--json`, `--root` and stable exit codes (0 clean / 1 findings / 2 usage). Read-only commands have no side effects.
- **Atomicity at the Gate**: a required `## User Story` with a single goal (`STORY_MISSING`, `STORY_MULTI_GOAL`) and a calibrated size budget (`BUDGET_EXCEEDED`: 7 BR / 8 AC / 5 AF / 9 steps), with explicit `STORY-OK` / `BUDGET-OK` waivers. Checks apply only to DRAFT contracts, so resolved work is never invalidated retroactively.
- **Per-project usage in the dashboard**: project identity (name, branch, remote) in the header, session/ invocation /calls-per-session cards, last activity and a 14-day activity chart, all from the local ledger.
- **Structured run events**: `.sdd/runs/<ID>/events.ndjson` (append-only, one JSON object per line) next to the human-readable logs; `sdd report` reads it to build the execution report.
- **Tests**: neutral-format (7), atomicity (8), CLI (13), plus session-log and run-event assertions in the existing suites.

## [0.5.2] — 2026-11-02

### Added — CLI usage in the dashboard, work-type split, pending work, init and doctor

- **CLI counts as usage**: `sdd` invocations are recorded in `.sdd/usage.json` with `sources` (mcp/cli), `by_type` (feature/fix/unknown) and a per-command breakdown. Each call is attributed to the contract type it serves, so the dashboard answers "how much of my usage went to fixes vs features".
- **Dashboard — origin and type**: two new panels with MCP vs CLI share and FEAT/FIX/unattributed share, plus a footnote when older calls have no recorded origin.
- **Dashboard — pending work**: a section listing every contract that is not RESOLVED, with its open and in-progress items, progress bar and the exact command to run next.
- **`sdd init`**: creates `.sdd/config.json`, `contracts/` and `CONSTITUTION.md`, is idempotent, and `--private` adds the ignore rules (`contracts/*`, `.sdd/`) without duplicating lines.
- **`sdd doctor`**: read-only diagnosis (Node version, contracts, config, unreadable headers, interrupted items, MCP tools, agent frontmatter) with OK / WARN / FAIL and exit code 1 on failures.
- **Configurable layers**: `.sdd/config.json` can declare `layers`, and the metrics ledger, Completion Map builder and dashboard adapt to them; the four standard layers remain the default.
- **Tests**: CLI now covers init, doctor and usage attribution (18), dashboard covers pending and origin panels (21).
- **`sdd approve <ID> --yes`**: HO-Gate from the terminal. Refuses without explicit confirmation, validates the contract first and writes `Status: APPROVED`, `Mode: LOOP`, plus `Approved-By`, `Approved-At` and a SHA-256 fingerprint of the spec body (approval lines excluded, so re-approving identical content yields the same hash).
- **`sdd sync`**: checks that every agent skill in `.agents/skills/` has its `.claude/agents/` counterpart and vice versa, reporting drift with exit code 1. It verifies parity instead of generating files, because the two adapters are intentionally written in different languages.
- **`sdd loop <ID>`**: drives the Loop from the terminal over the same ledger: with no flag it claims the next item (persists the in-progress marker and hands the criterion, agent and test id to the agent); `--pass --evidence "..."` / `--fail --evidence "..."` record the outcome; `--blocked "reason"` logs the ambiguity and returns the contract to DRAFT/GATE.
- **`sdd graph`**: reads `depends_on` (front-matter or a `## Depends On` section), prints the topological order, the contracts ready to advance, cycles and dependencies that do not exist. `sdd next` now refuses to suggest a contract whose dependency is still pending.
- **Agent frontmatter**: `solve-agent.md` and `verifier-agent.md` now declare `name`/`description`/`tools`/`model`, so `sdd doctor` reports a clean agent check.

## [0.5.3] — 2026-11-02

### Added — `sdd split` and the placeholder guard

- **`sdd split <ID>`**: proposes the cut of a contract that is not atomic. It groups criteria by the entity they mention when the contract touches several components, and otherwise splits contiguous blocks within the size budget (7 BR / 8 AC / 5 AF). Prints the proposed IDs, keeps a `## Splits` trace in the parent and, with `--write`, creates the DRAFT stubs with the assigned criteria for a human to complete.
- **Placeholder guard**: a DRAFT that still contains template text (`[completar]`, `[context]`, `[Verifiable invariant]`, …) is reported as `PLACEHOLDER` and cannot be approved, so a fresh `sdd new` is no longer approvable until it is filled in.
- **Tests**: split by budget, split by component, atomic detection and `--write` (6), plus the placeholder guard exercised through the CLI.

## [0.5.4] — 2026-11-03

### Added — per-criterion invalidation

- **Criterion hashes**: every AF/BR/AC keeps a normalized-text hash in `.sdd/state/<ID>.json`, and the Main Flow keeps one hash covering its steps.
- **Reconciliation**: when the spec changes, only the affected items are re-opened. An edited rule goes back to `❌`, a new rule is appended as `❌`, a deleted one is removed from the map, and a change in the Main Flow resets its four layer rows. Whitespace-only edits do not invalidate anything.
- **Automatic**: `sdd_step_loop` reconciles before claiming, so the map can never drift from the approved spec. The same behaviour is exposed explicitly through `sdd reconcile <ID>` (`--json` for tooling).
- **Tests**: single criterion, whitespace, additions, removals, Main Flow, Loop integration, CLI and state file (8).

## [0.5.5] — 2026-11-04

### Added — `sdd review`

- **Coverage heatmap per contract**: for every contract it prints a bar, the covered/total criteria and the BR/AC split, sorted worst-first so the gaps surface.
- **Honest scoping**: a criterion counts as covered only when a test file that names the contract cites it in a test title. Contracts that share `BR-001` no longer absorb each other's coverage, and a contract without its own tests is flagged instead of scoring 100%.
- **`--json`** exposes the corpus, the per-contract breakdown and the orphan list; the exit code is 1 when gaps remain, so it can gate a pipeline.
- **Configurable**: `.sdd/config.json` accepts `test_dirs` (defaults to `test-sandbox`, `tests`, `test`).
- **Tests**: scoping isolation, title-only matching, full coverage, exit codes and JSON shape (6).

## [0.6.0] — 2026-11-04

### Changed — publishable package

- **Curated surface**: `files` now publishes only `mcp/`, `bin/`, `protocol/`, `presets/` and `docs/INSTALACION.md` — 16 files, 96 KB unpacked 316 KB. `contracts/`, `.sdd/`, `test-sandbox/` and the dashboard build stay out of the tarball.
- **Renamed**: the package is now the unscoped `sdd-gl` (it was `@sdd-gl/mcp-server`). The scope required an npm organization the owner did not have, and the bare name was free.
- **Metadata**: `repository`, `bugs`, `engines` (Node >= 18) and `publishConfig.access = public`.
- **Two entry points**: `sdd-gl-mcp` (the stdio server) and `sdd` (the CLI). The misleading `sdd-gl` alias that also pointed at the server is gone.
- **Client snippets**: because there are two bins, every `npx` invocation names the one it wants (`npx -y --package sdd-gl sdd-gl-mcp`); plain `npx sdd-gl` cannot pick a bin.
- **Safety**: `prepublishOnly` runs the full suite, and a test reads `npm pack --dry-run --json` to assert that private contracts and local state can never ship.
- **Remaining**: `npm publish` with the owner account.
