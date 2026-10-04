# /sdd-dashboard Command (Claude Code)

Generates and updates the standalone Living Visual Dashboard (`docs/index.html`) with real-time First-Pass Quality metrics, multi-layer verification matrix, timeline, and interactive contract explorer.

## Generated Visualizations
1. **Hero KPIs**: First-Pass Quality Rate (FPQR), Layer pass rate, Solve rate, and Total active contracts.
2. **AC/DC Layer Matrix**: Visual distribution of tests across Functional, Static Analysis, Security, and Architecture.
3. **Temporal Lifeline**: Historical evolution (v0.1-v0.3), Active present (v0.4), and Interactive roadmap (v0.5).
4. **Contract Explorer**: Live cards with progress bars and Completion Map states.

## Execution
Runs `node mcp/dashboard-gen.js` from project root to regenerate `docs/index.html`.
