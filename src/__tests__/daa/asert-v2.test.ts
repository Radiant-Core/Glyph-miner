/**
 * ASERT-v2 miner-side tests.
 *
 * Covers (1) the fractional retarget math computeAsertV2Target (must mirror
 * Photonic-Wallet packages/lib/src/dmintDaaV2.ts and the on-chain bytecode), and
 * (2) the old-vs-new ASERT version detection in extractDaaParamsFromCodeScript —
 * the safety mechanism that keeps already-deployed (legacy) tokens mining under
 * the legacy formula after the in-place v2 upgrade.
 */
import { describe, it, expect } from "vitest";
import { computeAsertV2Target, computeAsertTarget } from "../../blockchain";
import { extractDaaParamsFromCodeScript } from "../../glyph";
import { pushMinimal } from "../../utils";

const MAX_TARGET = 0x7fffffffffffffffn;
const MAX_TARGET_DIV4 = MAX_TARGET >> 2n;

// Mirror Photonic-Wallet buildAsertDaaBytecode (legacy v1) prefix the parser keys on.
function buildLegacyAsertFixture(halfLife: number): string {
  return (
    "c5" + "5279" + "94" + "5379" + "94" + pushMinimal(halfLife) + "96" +
    "7654a0" + "63" + "7554" + "68" + "76519f" + "63" + "7551" + "68"
  );
}

// Mirror Photonic-Wallet buildAsertDaaBytecode (v2): the discriminating bit is
// the RADIX push (03000001) + OP_MUL (95) BEFORE the halfLife push + OP_DIV.
function buildV2AsertFixture(halfLife: number): string {
  return (
    "c5" + "5279" + "94" + "5379" + "94" +
    "03000001" + "95" + // push RADIX (65536), OP_MUL
    pushMinimal(halfLife) + "96" + // halfLife, OP_DIV
    pushMinimal(16384) + "a3" + pushMinimal(-16384) + "a4" + // driftFp clamp
    "7c" + "08ffffffffffffff1f" + "a3" + // SWAP, MIN with DIV4
    "76" + "03000001" + "96" + "7b" + "95" + "93" + // DUP, RADIX, DIV, ROT, MUL, ADD
    "08ffffffffffffff1f" + "a3" + "76519f" + "63" + "7551" + "68" // clamps
  );
}

describe("ASERT version detection (in-place upgrade safety)", () => {
  it("tags pre-upgrade (legacy) bytecode as asertVersion 1", () => {
    const p = extractDaaParamsFromCodeScript(buildLegacyAsertFixture(40), "asert");
    expect(p).toBeDefined();
    expect(p!.asertVersion).toBe(1);
    expect(p!.halfLife).toBe(40);
  });

  it("tags v2 bytecode as asertVersion 2 and reads halfLife past the RADIX*MUL", () => {
    const p = extractDaaParamsFromCodeScript(buildV2AsertFixture(40), "asert");
    expect(p).toBeDefined();
    expect(p!.asertVersion).toBe(2);
    expect(p!.halfLife).toBe(40);
  });

  it("does not false-positive a legacy halfLife of 65536 as v2", () => {
    // halfLife=65536 pushes "03000001" — same bytes as the RADIX push — but the
    // legacy bytecode has OP_DIV (96), not OP_MUL (95), after it.
    const p = extractDaaParamsFromCodeScript(buildLegacyAsertFixture(65536), "asert");
    expect(p).toBeDefined();
    expect(p!.asertVersion).toBe(1);
    expect(p!.halfLife).toBe(65536);
  });

  it("detects v2 across a range of halfLives", () => {
    for (const hl of [1, 10, 40, 240, 1000, 65535]) {
      const p = extractDaaParamsFromCodeScript(buildV2AsertFixture(hl), "asert");
      expect(p!.asertVersion, `hl=${hl}`).toBe(2);
      expect(p!.halfLife, `hl=${hl}`).toBe(hl);
    }
  });
});

describe("computeAsertV2Target — mirrors the on-chain bytecode/reference", () => {
  const targetTime = 10n;
  const halfLife = 40n;

  it("has no dead zone: a 1s deviation moves the target both ways", () => {
    const t0 = MAX_TARGET_DIV4 / 1000n;
    expect(computeAsertV2Target(t0, 0n, 11n, targetTime, halfLife)).toBeGreaterThan(t0);
    expect(computeAsertV2Target(t0, 0n, 9n, targetTime, halfLife)).toBeLessThan(t0);
  });

  it("on-target block leaves target unchanged", () => {
    const t0 = MAX_TARGET_DIV4 / 777n;
    expect(computeAsertV2Target(t0, 0n, targetTime, targetTime, halfLife)).toBe(t0);
  });

  it("is symmetric even when halfLife >= targetTime (legacy could not harden)", () => {
    const t0 = MAX_TARGET_DIV4 / 500n;
    let t = t0;
    for (let i = 0; i < 5; i++) t = computeAsertV2Target(t, 0n, 5n, targetTime, 100n);
    expect(t).toBeLessThan(t0); // difficulty rose — impossible under legacy
  });

  it("damps single-block moves to ~±25%", () => {
    const t0 = MAX_TARGET_DIV4 / 1000n;
    const up = computeAsertV2Target(t0, 0n, 100000n, targetTime, halfLife);
    expect(up).toBeLessThanOrEqual((t0 * 5n) / 4n + 2n);
    const down = computeAsertV2Target(t0, 0n, 0n, targetTime, halfLife);
    expect(down).toBeGreaterThanOrEqual((t0 * 3n) / 4n - 2n);
  });

  it("stays in [1, MAX_TARGET/4] and never throws across the domain", () => {
    const targets = [1n, 1000n, 65536n, MAX_TARGET_DIV4, MAX_TARGET];
    const gaps = [-100000n, -60n, 0n, 10n, 100000n];
    const hls = [1n, 40n, 1000n, 65536n];
    const tts = [1n, 10n, 600n];
    for (const target of targets)
      for (const gap of gaps)
        for (const hl of hls)
          for (const tt of tts) {
            const out = computeAsertV2Target(target, 0n, gap, tt, hl);
            expect(out).toBeGreaterThanOrEqual(1n);
            expect(out).toBeLessThanOrEqual(MAX_TARGET_DIV4);
          }
  });

  it("differs from the legacy formula (proves the upgrade changed behavior)", () => {
    const t0 = MAX_TARGET_DIV4 / 1000n;
    // 11s block, 10s target, halfLife 40: legacy drift=(1)/40=0 → unchanged (dead
    // zone); v2 moves it. This is the core bug the upgrade fixes.
    expect(computeAsertTarget(t0, 0n, 11n, targetTime, halfLife)).toBe(t0);
    expect(computeAsertV2Target(t0, 0n, 11n, targetTime, halfLife)).not.toBe(t0);
  });
});
