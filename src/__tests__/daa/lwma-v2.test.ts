/**
 * LWMA-v2 miner-side tests: the damped fractional retarget math
 * (computeLinearV2Target) and the old-vs-new lwma version detection that keeps
 * already-deployed (legacy single-sample) lwma tokens mining on the old formula.
 */
import { describe, it, expect } from "vitest";
import {
  computeLinearV2Target,
  computeLinearTarget,
  computeAsertV2Target,
} from "../../blockchain";
import { extractDaaParamsFromCodeScript } from "../../glyph";
import { pushMinimal } from "../../utils";

const MAX_TARGET = 0x7fffffffffffffffn;
const MAX_TARGET_DIV4 = MAX_TARGET >> 2n;

// Mirror Photonic-Wallet buildLinearDaaBytecode (legacy single-sample) prefix.
function buildLegacyLwmaFixture(): string {
  return (
    "c5" + "5279" + "94" + "5379" + "54" + "95" + "a3" + "00" + "a4" + "7c" +
    "08ffffffffffffff1f" + "a3" + "5379" + "96" + "95" +
    "08ffffffffffffff7f" + "a3" + "76519f" + "63" + "7551" + "68"
  );
}

// Mirror Photonic-Wallet buildLinearDaaBytecode (v2 damped): RADIX*MUL then
// OP_3 PICK targetTime + OP_DIV (the targetTime divisor distinguishes it).
function buildV2LwmaFixture(): string {
  return (
    "c5" + "5279" + "94" + "5379" + "94" +
    "03000001" + "95" + "5379" + "96" +
    pushMinimal(16384) + "a3" + pushMinimal(-16384) + "a4" +
    "7c" + "08ffffffffffffff1f" + "a3" +
    "76" + "03000001" + "96" + "7b" + "95" + "93" +
    "08ffffffffffffff1f" + "a3" + "76519f" + "63" + "7551" + "68"
  );
}

describe("LWMA version detection (in-place upgrade safety)", () => {
  it("tags legacy single-sample bytecode as lwmaVersion 1", () => {
    const p = extractDaaParamsFromCodeScript(buildLegacyLwmaFixture(), "lwma");
    expect(p?.lwmaVersion).toBe(1);
  });

  it("tags v2 damped bytecode as lwmaVersion 2", () => {
    const p = extractDaaParamsFromCodeScript(buildV2LwmaFixture(), "lwma");
    expect(p?.lwmaVersion).toBe(2);
  });
});

describe("computeLinearV2Target — damped fractional (gain = 1/targetTime)", () => {
  const targetTime = 10n;

  it("equals computeAsertV2Target with halfLife = targetTime", () => {
    for (const t of [MAX_TARGET_DIV4 / 1000n, 1000n, MAX_TARGET_DIV4]) {
      for (const gap of [0n, 5n, 11n, 100n, -50n]) {
        expect(computeLinearV2Target(t, 0n, gap, targetTime)).toBe(
          computeAsertV2Target(t, 0n, gap, targetTime, targetTime)
        );
      }
    }
  });

  it("on-target is stable; 1s off moves both ways (no dead zone)", () => {
    const t0 = MAX_TARGET_DIV4 / 1000n;
    expect(computeLinearV2Target(t0, 0n, targetTime, targetTime)).toBe(t0);
    expect(computeLinearV2Target(t0, 0n, 11n, targetTime)).toBeGreaterThan(t0);
    expect(computeLinearV2Target(t0, 0n, 9n, targetTime)).toBeLessThan(t0);
  });

  it("damps to ±25%/block where legacy would jump up to 4× / down to target=1", () => {
    const t0 = MAX_TARGET_DIV4 / 1000n;
    // 2×-target block: v2 ≤ +25%; legacy ~doubles the target (divide-first truncation).
    expect(computeLinearV2Target(t0, 0n, 2n * targetTime, targetTime)).toBeLessThanOrEqual((t0 * 5n) / 4n + 2n);
    expect(computeLinearTarget(t0, 0n, 2n * targetTime, targetTime)).toBeGreaterThan((t0 * 19n) / 10n);
    // 0-delta block: v2 ≈ -25%; legacy slams target to 1.
    expect(computeLinearV2Target(t0, 0n, 0n, targetTime)).toBeGreaterThanOrEqual((t0 * 3n) / 4n - 2n);
    expect(computeLinearTarget(t0, 0n, 0n, targetTime)).toBe(1n);
  });

  it("stays in [1, MAX/4] across the input domain", () => {
    for (const target of [1n, 1000n, 65536n, MAX_TARGET_DIV4, MAX_TARGET])
      for (const gap of [-100000n, -60n, 0n, 10n, 100000n])
        for (const tt of [1n, 10n, 600n]) {
          const out = computeLinearV2Target(target, 0n, gap, tt);
          expect(out).toBeGreaterThanOrEqual(1n);
          expect(out).toBeLessThanOrEqual(MAX_TARGET_DIV4);
        }
  });
});
