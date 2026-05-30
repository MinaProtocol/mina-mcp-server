---
name: mesa-upgrade
description: Operator runbook for the Mina Mesa hardfork upgrade rehearsal on the mesa-mut network, driven by the mina-mcp-server `get_upgrade_status` tool. Use when working against `--network mesa-mut`, when a user asks "what phase is the Mesa upgrade in", "can I still transact on mesa-mut", "when does the hardfork happen", or when you need to decide whether a send/transaction will be accepted before the fork. Explains how to read get_upgrade_status, what each phase means, and what to do (and not do) in each.
---

# Mesa upgrade (mesa-mut) runbook

The **mesa-mut** network is a fork of mainnet state used to rehearse the **Mesa
hardfork upgrade**. It is a **preflight** network — it will be reset or retired
without notice; treat all data as ephemeral. This runbook sits on top of the
mina-mcp-server `get_upgrade_status` tool: that tool is the source of truth for
*where in the upgrade we are right now*; this file is what to **do** about it.

Authoritative schedule: <https://mesa-upgrade-tracker.minaprotocol.com/status.json>.

## Always start by calling the tool

Run `get_upgrade_status` (live mode, `--network mesa-mut`) before reasoning about
the upgrade or submitting any transaction. Do not infer the phase from wall-clock
time or stale docs — the tool joins the tracker with the **live daemon slot**, so
its `livePhase` / `transactionsOpen` reflect the actual chain, not the schedule.

Key fields:

- `transactionsOpen` — **the gate for any send.** `true` → sends are accepted;
  `false` → sends are dropped, do not submit.
- `currentSlot` — live global slot (this chain's genesis).
- `stopTransactionSlot` / `stopNetworkSlot` — thresholds from the tracker.
- `slotsUntilStopTransaction` / `slotsUntilStopNetwork` — remaining headroom.
- `livePhase` — the derived phase (below).
- `mesaGenesisTimestamp` — when the post-fork chain starts.
- `hints[]` — human-readable, already phrased for the current phase.

## Phases and what to do

| `livePhase` | Meaning | Do | Don't |
|---|---|---|---|
| `pre-upgrade (transactions open)` | `currentSlot < stopTransactionSlot` | Normal operation. If submitting a send, confirm `slotsUntilStopTransaction` leaves comfortable margin (each slot ≈ 3 min). | Don't start a multi-step flow you can't finish before `stopTransactionSlot`. |
| `transactions stopped (awaiting network halt)` | `stopTransactionSlot ≤ currentSlot < stopNetworkSlot` | Read-only queries only. Tell the user transactions are frozen until the fork. | **Don't submit sends** — they are dropped. Don't retry "stuck" transactions. |
| `network halted (awaiting Mesa genesis)` | `currentSlot ≥ stopNetworkSlot` | Wait for `mesaGenesisTimestamp`. After genesis, treat mesa-mut as a **new chain**. | Don't trust pre-fork mempool/tip as current. |

## After the Mesa genesis

Once `mesaGenesisTimestamp` passes, the post-fork chain is a fresh genesis:

- Re-fetch `get_genesis_constants` — constants may differ from the pre-fork chain.
- Prior block heights / state hashes are **historical**; don't assume continuity.
- Re-run `get_sync_status` / `describe_state` before acting on chain state.

## Failure modes

- **Tracker unreachable** — `get_upgrade_status` still returns the live slot and a
  hint saying so; you lose the threshold context. Don't guess the phase; surface
  that the schedule couldn't be fetched and point the user at the tracker URL.
- **Slot read fails** — the tool returns the tracker schedule only. You can report
  the planned thresholds but not whether transactions are open *right now*; treat
  `transactionsOpen: null` as "unknown — do not submit".

## Don't hardcode

mesa-mut endpoints, slot thresholds, and the genesis timestamp all live in the
tracker and the daemon — never hardcode them into automation. Call the tool each
time; the network is preflight and the schedule can move.
