---
name: sdd-loop
description: >
  Use this skill when a SDD-GL Contract in contracts/ has Status: APPROVED and Mode: LOOP.
  Activates the Loop protocol: reads or resumes the Completion Map, delegates implementation
  and tests to subagents, persists progress after each item, and escalates ambiguities to Gate.
  Do NOT use when Status: DRAFT or Mode: GATE — use sdd-gate instead.
triggers:
  - "contract approved"
  - "start loop"
  - "resume loop"
  - "execute against spec"
  - "run autonomous loop"
  - "continue from checkpoint"
---

# SDD-GL Loop Protocol (Antigravity)

You are operating the Loop mode of SDD-GL.
Load and follow `protocol/loop.md` in full before taking any action.

## Entry condition
Only activate when the Contract header shows:
- `Status: APPROVED` AND `Mode: LOOP`

If Status is DRAFT or Mode is GATE → do not activate. Tell the user to use /sdd-gate.

## Execution steps

1. Read the target Contract from `contracts/[ID].md`
2. Check if Completion Map already exists (lines starting with `# ` containing `|`)
   - YES → load it as-is. Check for ⏳ items (interrupted) → resume from first ⏳
   - NO → build Completion Map from the Contract using the inference table in `protocol/contract.md`
3. For each ❌ or ⏳ item in order:
   a. Write ⏳ to the Contract line → persist to disk immediately
   b. Delegate to the appropriate subagent (see delegation table below)
   c. If PASS → write ✅ → persist
   d. If FAIL → retry up to 3 times with coder-agent fix attempts
   e. If 3 failures → invoke sdd-reviewer-agent to determine: RETRY or AMBIGUITY
   f. If AMBIGUITY → write to Ambiguity Log → write ❌ → change Mode: GATE → persist → STOP
4. When all items are ✅ → write Completion Report → change Status: RESOLVED → persist

## Delegation table

| Criterion type | Subagent           |
|----------------|--------------------|
| Main Flow      | sdd-coder-agent + sdd-tester-agent |
| AF-XX          | sdd-tester-agent   |
| BR-XXX         | sdd-tester-agent   |
| AC-XXX         | sdd-tester-agent   |

## Persistence rule — CRITICAL
Write to disk before AND after each item.
Never hold state only in memory.
If the process is interrupted, the ⏳ marker in the Contract shows exactly where to resume.

## What Loop never does
- Ask the human for approval during execution
- Reconstruct the Completion Map if one already exists in the Contract
- Modify the Contract beyond: Completion Map, Ambiguity Log, Status, Mode
- Finish with any items ❌ without escalating to Gate
- Guess at ambiguous spec — always escalate

## Resources
- protocol/loop.md — full Loop protocol with persistence rules
- protocol/contract.md — Completion Map format and inference table
