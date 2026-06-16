/**
 * Miner hardening — stale-location / flood protection.
 *
 * Regression coverage for the mainnet "BLAKE3 token won't mine" incident
 * (2026-06-15): the miner's `blockchain.ref.get` resolver is CONFIRMED-only, so
 * when mints don't confirm it keeps returning the GENESIS location. The miner
 * then re-pinned to height 0, re-mined at trivial difficulty, and flooded the
 * mempool with mutually-conflicting genesis-spends — an unbounded loop of
 * "Missing inputs" / "txn-mempool-conflict" rejections.
 *
 * These tests pin the three pure decision helpers that bound that behaviour:
 *   - pendingMintCount     -> cap the unconfirmed optimistic chain
 *   - staleRejectionAction -> escalate soft -> recover -> STOP (don't loop)
 *   - isStaleRegression    -> never re-pin the tip below an already-mined height
 */

import { describe, it, expect } from "vitest";
import {
  pendingMintCount,
  staleRejectionAction,
  isStaleRegression,
  resolvedHeightFromConfirmedTip,
  MAX_PENDING_MINTS,
  STALE_REJECT_RECOVER,
  STALE_REJECT_STOP,
} from "../blockchain";

describe("miner hardening — constants", () => {
  it("keeps the pending-chain cap below the node's default 25-deep mempool limit", () => {
    expect(MAX_PENDING_MINTS).toBeLessThan(25);
    expect(MAX_PENDING_MINTS).toBeGreaterThan(0);
  });
  it("escalates recover before stop", () => {
    expect(STALE_REJECT_RECOVER).toBeLessThan(STALE_REJECT_STOP);
  });
});

describe("pendingMintCount", () => {
  it("treats an unresolved (-1) confirmed height as 0", () => {
    // 5 mints broadcast, indexer has resolved none -> 5 pending
    expect(pendingMintCount(5n, -1n)).toBe(5n);
  });

  it("subtracts the last resolved (confirmed) height", () => {
    expect(pendingMintCount(36n, 30n)).toBe(6n);
  });

  it("is 0 when nothing has been broadcast", () => {
    expect(pendingMintCount(-1n, -1n)).toBe(0n);
  });

  it("clamps to 0 if the resolved height somehow exceeds the broadcast height", () => {
    // e.g. another miner mined ahead of us
    expect(pendingMintCount(10n, 14n)).toBe(0n);
  });

  it("reproduces the incident: 36 broadcast, 0 confirmed -> 36 pending (>> cap)", () => {
    const pending = pendingMintCount(36n, 0n);
    expect(pending).toBe(36n);
    expect(pending >= BigInt(MAX_PENDING_MINTS)).toBe(true); // would pause mining
  });

  it("does NOT trip the cap during healthy mining (small lead over confirmations)", () => {
    const pending = pendingMintCount(103n, 100n); // 3 ahead of confirmed
    expect(pending).toBe(3n);
    expect(pending >= BigInt(MAX_PENDING_MINTS)).toBe(false);
  });
});

describe("staleRejectionAction", () => {
  it("missing-inputs always re-resolves the tip immediately (never a soft wait)", () => {
    expect(staleRejectionAction(1, true)).toBe("recover");
    expect(staleRejectionAction(2, true)).toBe("recover");
  });

  it("mempool-conflict softly waits for a subscription before re-resolving", () => {
    expect(staleRejectionAction(1, false)).toBe("soft");
    expect(staleRejectionAction(2, false)).toBe("soft");
  });

  it("escalates a persistent conflict to a tip re-resolve at RECOVER", () => {
    expect(staleRejectionAction(STALE_REJECT_RECOVER, false)).toBe("recover");
    expect(staleRejectionAction(STALE_REJECT_RECOVER + 1, false)).toBe("recover");
  });

  it("STOPS — does not loop — once rejections reach the hard cap", () => {
    expect(staleRejectionAction(STALE_REJECT_STOP, true)).toBe("stop");
    expect(staleRejectionAction(STALE_REJECT_STOP, false)).toBe("stop");
    expect(staleRejectionAction(STALE_REJECT_STOP + 3, false)).toBe("stop");
  });

  it("incident sequence: a genesis-conflict loop terminates instead of flooding", () => {
    // Simulate the post-reload loop: every attempt conflicts on genesis:0.
    const actions: string[] = [];
    for (let count = 1; count <= STALE_REJECT_STOP + 2; count++) {
      const a = staleRejectionAction(count, false);
      actions.push(a);
      if (a === "stop") break;
    }
    // It must reach a terminal "stop" and never run past the cap.
    expect(actions[actions.length - 1]).toBe("stop");
    expect(actions.length).toBe(STALE_REJECT_STOP);
    expect(actions.filter((a) => a === "stop").length).toBe(1);
  });
});

describe("isStaleRegression", () => {
  it("is never a regression before anything has been broadcast (-1 sentinel)", () => {
    expect(isStaleRegression(0n, -1n)).toBe(false);
    expect(isStaleRegression(36n, -1n)).toBe(false);
  });

  it("flags the incident: ref.get returns genesis (0) after we mined to 36", () => {
    expect(isStaleRegression(0n, 36n)).toBe(true);
  });

  it("allows a legitimate forward advance (another miner mined the real tip)", () => {
    expect(isStaleRegression(37n, 36n)).toBe(false); // ahead -> accept
    expect(isStaleRegression(36n, 36n)).toBe(false); // same -> accept
  });

  it("flags any resolved height strictly below the broadcast height", () => {
    expect(isStaleRegression(35n, 36n)).toBe(true);
    expect(isStaleRegression(1n, 36n)).toBe(true);
  });
});

describe("resolvedHeightFromConfirmedTip", () => {
  const broadcast = new Map<string, bigint>([
    ["txA", 10n],
    ["txB", 11n],
    ["txC", 12n],
  ]);

  it("advances confirmed height when the tip is one of our broadcasts", () => {
    expect(resolvedHeightFromConfirmedTip("txC", broadcast, 5n)).toBe(12n);
  });

  it("never regresses below the current confirmed height", () => {
    expect(resolvedHeightFromConfirmedTip("txA", broadcast, 11n)).toBe(11n);
  });

  it("leaves confirmed height unchanged for an unknown tip (another miner's tx)", () => {
    expect(resolvedHeightFromConfirmedTip("txZ", broadcast, 7n)).toBe(7n);
  });

  it("is a no-op when there is no tip", () => {
    expect(resolvedHeightFromConfirmedTip(undefined, broadcast, 7n)).toBe(7n);
  });

  it("solo-mining steady state: confirmations keep pending below the cap", () => {
    // Broadcast up to height 40; confirmations trail at txid for height 36.
    const map = new Map<string, bigint>();
    for (let h = 21; h <= 40; h++) map.set(`tx${h}`, BigInt(h));
    const lastResolved = resolvedHeightFromConfirmedTip("tx36", map, 0n);
    expect(lastResolved).toBe(36n);
    // pending = 40 - 36 = 4, well under the cap -> healthy mining keeps going.
    expect(pendingMintCount(40n, lastResolved)).toBe(4n);
    expect(pendingMintCount(40n, lastResolved) >= BigInt(MAX_PENDING_MINTS)).toBe(
      false,
    );
  });
});
