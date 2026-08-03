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
