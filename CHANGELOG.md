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



