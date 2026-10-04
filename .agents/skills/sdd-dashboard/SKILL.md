---
name: sdd-dashboard
description: >
  Generates and updates the standalone Living Visual Dashboard (docs/index.html) with real-time
  First-Pass Quality metrics, multi-layer verification matrix, timeline, and interactive contract explorer.
triggers:
  - "generate dashboard"
  - "view visual dashboard"
  - "sdd dashboard"
  - "show living telemetry"
---

# SDD-GL Living Visual Dashboard Command

This skill executes `mcp/dashboard-gen.js` to compile real-time telemetry from `contracts/*.md`, `.sdd/metrics.json`, and `.sdd/runs/` into the publishable `docs/index.html` file (ready for local viewing or GitHub Pages).

## Generated Visualizations
1. **Hero KPIs**: First-Pass Quality Rate (FPQR), Layer pass rate, Solve rate, and Total active contracts.
2. **AC/DC Layer Matrix**: Visual distribution of tests across Functional, Static Analysis, Security, and Architecture.
3. **Temporal Lifeline**: Historical evolution (v0.1-v0.3), Active present (v0.4), and Interactive roadmap (v0.5).
4. **Contract Explorer**: Live cards with progress bars and Completion Map states.

## Execution
Run `node mcp/dashboard-gen.js` from the repository root to regenerate `docs/index.html`.
