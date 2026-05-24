/**
 * V2 dMint Contract Integration Tests
 *
 * Tests the full pipeline: Photonic Wallet creates a contract script →
 * Glyph Miner parses it → builds next state → verifies round-trip consistency.
 *
 * Covers all 9 contract variants: 3 algorithms × 3 DAA modes
 *   Algorithms: sha256d, blake3, k12
 *   DAA modes:  fixed, asert, lwma
 */

import { describe, it, expect } from 'vitest';
import { Script } from '@radiant-core/radiantjs';
import { parseDmintScript, parseContractTx } from '../glyph';
import { push4bytes, pushMinimal, opcodeToNum } from '../utils';
import {
  analyzeDmintPreimageStackLayout,
  buildNextContractState,
  isV2Contract,
  extractCodeScriptHashOp,
  findNonMinimalDataPush,
  computeAsertTarget,
  computeLinearTarget,
  computeEpochTarget,
  computeScheduleTarget,
  nonceBytesForAlgorithm,
  mapHashOpToAlgorithm,
  unlockingOutputIndexOpcodeHex,
} from '../blockchain';
import type { Contract } from '../types';

// ---------------------------------------------------------------------------
// Photonic-equivalent V2 bytecode constants (must match Photonic script.ts)
// ---------------------------------------------------------------------------
const V2_BYTECODE_PART_B1 = 'bc01147f77587f040000000088817600a269';
const V2_BYTECODE_PART_B2 = '51797ca269';
const V2_BYTECODE_PART_B4 = '7575757575';
const V2_BYTECODE_PART_C =
  'a269577ae500a069567ae600a06901d053797e0cdec0e9aa76e378e4a269e69d7eaa76e47b9d547a818b76537a9c537ade789181547ae6939d635279cd01d853797e016a7e886778de519d547854807ec0eb557f777e5379ec78885379eac0e9885379cc519d75686d7551';

const POW_HASH_OPCODES: Record<string, string> = {
  sha256d: 'aa',
  blake3: 'ee',
  k12: 'ef',
};

const ALGO_IDS: Record<string, number> = { sha256d: 0, blake3: 1, k12: 2 };
const DAA_MODE_IDS: Record<string, number> = { fixed: 0, epoch: 1, asert: 2, lwma: 3, schedule: 4 };

// ---------------------------------------------------------------------------
// Replicate Photonic buildDmintPreimageBytecodePartA
// ---------------------------------------------------------------------------
function buildPartA(stateItemCount: number): string {
  // c8 = OP_OUTPOINTTXHASH (pushes txHash, consumed by first OP_CAT)
  // c0 (OP_INPUTINDEX) intentionally excluded — it was a spurious extra item
  const contractRefPick = stateItemCount - 1;
  const ioPick = stateItemCount + 3;
  const nonceRoll = stateItemCount + 4;
  return [
    '51', '75', 'c8',
    pushMinimal(contractRefPick), '79', '7e', 'a8',
    pushMinimal(ioPick), '79',
    pushMinimal(ioPick), '79',
    '7e', 'a8', '7e',
    pushMinimal(nonceRoll), '7a', '7e',
  ].join('');
}

// ---------------------------------------------------------------------------
// Replicate Photonic ASERT DAA bytecode builder
// ---------------------------------------------------------------------------
function buildAsertDaaBytecode(halfLife: number): string {
  const halfLifePush = pushMinimal(halfLife);
  return [
    'c5', '5279', '94', '5379', '94',
    halfLifePush, '96',
    '7654a0', '63', '7554', '68',
    '765481', '9f', '63', '755481', '68',
    '7600a0', '63', '98', '67',
    '76009f', '63', '8199', '67', '75', '68', '68',
    '76519f', '63', '7551', '68',
  ].join('');
}

// ---------------------------------------------------------------------------
// Replicate Photonic Linear DAA bytecode builder
// ---------------------------------------------------------------------------
function buildLinearDaaBytecode(): string {
  return [
    'c5', '5279', '94',
    '7c', '95',
    '5379', '96',
    '76519f', '63', '7551', '68',
  ].join('');
}

// ---------------------------------------------------------------------------
// Replicate Photonic dMintScript — the "wallet side" contract creator
// ---------------------------------------------------------------------------
function photonicDMintScript(opts: {
  height: number;
  contractRef: string;
  tokenRef: string;
  maxHeight: number;
  reward: number;
  target: bigint;
  algorithm: string;
  daaMode: string;
  halfLife?: number;
  targetTime?: number;
  lastTime?: number;
}): string {
  const algoId = ALGO_IDS[opts.algorithm] ?? 0;
  const daaId = DAA_MODE_IDS[opts.daaMode] ?? 0;
  const targetTime = opts.targetTime ?? 60;
  const lastTime = opts.lastTime ?? 0;
  const powHashOp = POW_HASH_OPCODES[opts.algorithm] || 'aa';

  const stateScript = [
    push4bytes(opts.height),
    `d8${opts.contractRef}`,
    `d0${opts.tokenRef}`,
    pushMinimal(opts.maxHeight),
    pushMinimal(opts.reward),
    pushMinimal(algoId),
    pushMinimal(daaId),
    pushMinimal(targetTime),
    push4bytes(lastTime),
    pushMinimal(opts.target),
  ].join('');

  let daaBytecode = '';
  if (opts.daaMode === 'asert') {
    daaBytecode = buildAsertDaaBytecode(opts.halfLife ?? 3600);
  } else if (opts.daaMode === 'lwma') {
    daaBytecode = buildLinearDaaBytecode();
  }

  const partA = buildPartA(10);
  const partB = `${V2_BYTECODE_PART_B1}${V2_BYTECODE_PART_B2}${daaBytecode}${V2_BYTECODE_PART_B4}`;
  const bytecode = `${partA}${powHashOp}${partB}${V2_BYTECODE_PART_C}`;

  return `${stateScript}bd${bytecode}`;
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------
const FAKE_CONTRACT_REF = 'aa'.repeat(32) + '00000001';
const FAKE_TOKEN_REF = 'bb'.repeat(32) + '00000002';
const FAKE_TXID = 'cc'.repeat(32);
const BASE_LAST_TIME = 1700000000;

type ContractVariant = {
  algorithm: string;
  daaMode: string;
  halfLife?: number;
  targetTime?: number;
};

const VARIANTS: ContractVariant[] = [
  { algorithm: 'sha256d', daaMode: 'fixed' },
  { algorithm: 'sha256d', daaMode: 'asert', halfLife: 3600, targetTime: 60 },
  { algorithm: 'sha256d', daaMode: 'lwma', targetTime: 60 },
  { algorithm: 'blake3', daaMode: 'fixed' },
  { algorithm: 'blake3', daaMode: 'asert', halfLife: 7200, targetTime: 120 },
  { algorithm: 'blake3', daaMode: 'lwma', targetTime: 30 },
  { algorithm: 'k12', daaMode: 'fixed' },
  { algorithm: 'k12', daaMode: 'asert', halfLife: 1800, targetTime: 90 },
  { algorithm: 'k12', daaMode: 'lwma', targetTime: 45 },
];

function variantLabel(v: ContractVariant): string {
  return `${v.algorithm}/${v.daaMode}${v.halfLife ? ` hl=${v.halfLife}` : ''}${v.targetTime ? ` tt=${v.targetTime}` : ''}`;
}

/**
 * Create a mock Transaction-like object that parseContractTx can consume.
 * parseContractTx reads tx.outputs[i].script.toHex() and tx.id.
 */
function mockTransaction(fullScript: string, txid: string) {
  return {
    id: txid,
    outputs: [
      {
        script: {
          toHex: () => fullScript,
        },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('V2 Contract Integration: Photonic → Miner Pipeline', () => {
  describe('parseDmintScript extracts state from Photonic-created scripts', () => {
    for (const variant of VARIANTS) {
      it(`parses ${variantLabel(variant)}`, () => {
        const fullScript = photonicDMintScript({
          height: 0,
          contractRef: FAKE_CONTRACT_REF,
          tokenRef: FAKE_TOKEN_REF,
          maxHeight: 10000,
          reward: 100,
          target: 2500000n,
          lastTime: BASE_LAST_TIME,
          ...variant,
        });

        const stateScript = parseDmintScript(fullScript);
        expect(stateScript).not.toBe('');

        // stateScript should NOT contain 'bd' separator or bytecode
        expect(stateScript).not.toContain('bd5175c8');

        // full script = stateScript + 'bd' + codeScript
        expect(fullScript.startsWith(stateScript + 'bd')).toBe(true);

        // codeScript should start with Part A prefix
        const codeScript = fullScript.substring(stateScript.length + 2);
        expect(codeScript.startsWith('5175c8')).toBe(true);
      });
    }
  });

  // Regression: after Photonic-Wallet 4060ac1 (which restored OP_INPUTINDEX
  // before OP_OUTPOINTTXHASH in Part A) deployed contracts have the code
  // script starting with c0c8, not 5175c8. The miner's parser must accept
  // the new format or it'll report "dmint contract not found" for every
  // newly-deployed contract.
  describe('parseDmintScript accepts the post-4060ac1 c0c8 Part A prefix', () => {
    it('detects bd c0 c8 separator and extracts the state script', () => {
      // Minimal V2 script structure: state | bd | c0 c8 | <rest of Part A/B/C>
      // We reuse the test fixture but splice the prefix bytes so we exercise
      // the parser path without committing to a specific Part B/C constant.
      const fullScript = photonicDMintScript({
        height: 0,
        contractRef: FAKE_CONTRACT_REF,
        tokenRef: FAKE_TOKEN_REF,
        maxHeight: 10000,
        reward: 100,
        target: 2500000n,
        lastTime: BASE_LAST_TIME,
        ...VARIANTS[0],
      });
      // Replace the 5175c8 prefix (after separator) with c0c8 (drop two bytes)
      const oldBytes = 'bd5175c8';
      const newBytes = 'bdc0c8';
      expect(fullScript.includes(oldBytes)).toBe(true);
      const fixedScript = fullScript.replace(oldBytes, newBytes);
      expect(fixedScript.includes('bdc0c8')).toBe(true);
      expect(fixedScript.includes('bd5175c8')).toBe(false);

      const stateScript = parseDmintScript(fixedScript);
      expect(stateScript).not.toBe('');
      const codeScript = fixedScript.substring(stateScript.length + 2);
      expect(codeScript.startsWith('c0c8')).toBe(true);
    });

    it('still accepts the legacy 5175c8 prefix (un-mineable but parseable)', () => {
      const fullScript = photonicDMintScript({
        height: 0,
        contractRef: FAKE_CONTRACT_REF,
        tokenRef: FAKE_TOKEN_REF,
        maxHeight: 10000,
        reward: 100,
        target: 2500000n,
        lastTime: BASE_LAST_TIME,
        ...VARIANTS[0],
      });
      const stateScript = parseDmintScript(fullScript);
      expect(stateScript).not.toBe('');
      const codeScript = fullScript.substring(stateScript.length + 2);
      expect(codeScript.startsWith('5175c8')).toBe(true);
    });
  });

  describe('parseContractTx extracts V2 Contract fields correctly', () => {
    for (const variant of VARIANTS) {
      it(`parses ${variantLabel(variant)}`, async () => {
        const fullScript = photonicDMintScript({
          height: 5,
          contractRef: FAKE_CONTRACT_REF,
          tokenRef: FAKE_TOKEN_REF,
          maxHeight: 10000,
          reward: 100,
          target: 5000000n,
          lastTime: BASE_LAST_TIME,
          ...variant,
        });

        const tx = mockTransaction(fullScript, FAKE_TXID);
        const result = await parseContractTx(tx as any, FAKE_CONTRACT_REF);

        expect(result).toBeDefined();
        expect(result!.state).toBe('active');

        const c = result!.params as Contract;
        expect(c.height).toBe(5n);
        expect(c.contractRef).toBe(FAKE_CONTRACT_REF);
        expect(c.tokenRef).toBe(FAKE_TOKEN_REF);
        expect(c.maxHeight).toBe(10000n);
        expect(c.reward).toBe(100n);
        expect(c.target).toBe(5000000n);
        expect(c.lastTime).toBe(BigInt(BASE_LAST_TIME));

        // V2-specific fields
        expect(c.algoId).toBe(BigInt(ALGO_IDS[variant.algorithm]));
        expect(c.daaMode).toBe(variant.daaMode);
        expect(c.targetTime).toBe(BigInt(variant.targetTime ?? 60));

        // codeScript should be preserved
        expect(c.codeScript).toBeDefined();
        expect(c.codeScript!.startsWith('5175c8')).toBe(true);
      });
    }
  });

  describe('isV2Contract correctly identifies V2 contracts', () => {
    for (const variant of VARIANTS) {
      it(`detects ${variantLabel(variant)} as V2`, async () => {
        const fullScript = photonicDMintScript({
          height: 0,
          contractRef: FAKE_CONTRACT_REF,
          tokenRef: FAKE_TOKEN_REF,
          maxHeight: 1000,
          reward: 50,
          target: 1000000n,
          lastTime: BASE_LAST_TIME,
          ...variant,
        });

        const tx = mockTransaction(fullScript, FAKE_TXID);
        const result = await parseContractTx(tx as any, FAKE_CONTRACT_REF);
        const c = result!.params as Contract;

        expect(isV2Contract(c)).toBe(true);
      });
    }
  });

  describe('analyzeDmintPreimageStackLayout validates V2 stack layout', () => {
    for (const variant of VARIANTS) {
      it(`validates ${variantLabel(variant)}`, async () => {
        const fullScript = photonicDMintScript({
          height: 0,
          contractRef: FAKE_CONTRACT_REF,
          tokenRef: FAKE_TOKEN_REF,
          maxHeight: 1000,
          reward: 50,
          target: 1000000n,
          lastTime: BASE_LAST_TIME,
          ...variant,
        });

        const tx = mockTransaction(fullScript, FAKE_TXID);
        const result = await parseContractTx(tx as any, FAKE_CONTRACT_REF);
        const c = result!.params as Contract;

        const check = analyzeDmintPreimageStackLayout(c.script, c.codeScript);
        expect(check).toBeDefined();
        expect(check!.matchesExpectedLayout).toBe(true);
        expect(check!.stateItemCount).toBe(10);
        expect(check!.pick5).toBe('contractRef');
        expect(check!.pick9a).toBe('inputHash');
        expect(check!.pick9b).toBe('outputHash');
        expect(check!.roll10).toBe('nonce'); // labels are correct regardless of pick index value
      });
    }
  });

  describe('extractCodeScriptHashOp detects correct PoW opcode', () => {
    for (const variant of VARIANTS) {
      it(`detects ${variant.algorithm} opcode in ${variantLabel(variant)}`, async () => {
        const fullScript = photonicDMintScript({
          height: 0,
          contractRef: FAKE_CONTRACT_REF,
          tokenRef: FAKE_TOKEN_REF,
          maxHeight: 1000,
          reward: 50,
          target: 1000000n,
          lastTime: BASE_LAST_TIME,
          ...variant,
        });

        const tx = mockTransaction(fullScript, FAKE_TXID);
        const result = await parseContractTx(tx as any, FAKE_CONTRACT_REF);
        const c = result!.params as Contract;

        const hashOp = extractCodeScriptHashOp(c.codeScript);
        expect(hashOp).toBe(POW_HASH_OPCODES[variant.algorithm]);

        const algo = mapHashOpToAlgorithm(hashOp);
        expect(algo).toBe(variant.algorithm);
      });
    }
  });

  describe('nonceBytesForAlgorithm returns correct nonce size', () => {
    it('sha256d → 4 bytes', () => expect(nonceBytesForAlgorithm('sha256d')).toBe(4));
    it('blake3 → 8 bytes', () => expect(nonceBytesForAlgorithm('blake3')).toBe(8));
    it('k12 → 8 bytes', () => expect(nonceBytesForAlgorithm('k12')).toBe(8));
  });

  describe('findNonMinimalDataPush passes on valid V2 contracts', () => {
    for (const variant of VARIANTS) {
      it(`no non-minimal pushes in ${variantLabel(variant)}`, () => {
        const fullScript = photonicDMintScript({
          height: 0,
          contractRef: FAKE_CONTRACT_REF,
          tokenRef: FAKE_TOKEN_REF,
          maxHeight: 10000,
          reward: 100,
          target: 2500000n,
          lastTime: BASE_LAST_TIME,
          ...variant,
        });

        const nonMinimal = findNonMinimalDataPush(fullScript);
        expect(nonMinimal).toBeUndefined();
      });
    }
  });

  describe('unlockingOutputIndexOpcodeHex returns OP_0 for V2', () => {
    it('returns "00"', () => {
      expect(unlockingOutputIndexOpcodeHex('anything')).toBe('00');
    });
  });
});

// SKIPPED — these tests were written against the previous behavior of
// buildNextContractState, which updated `lastTime` to OP_TXLOCKTIME and
// re-applied the DAA to produce a fresh `target` for the next state. That
// behavior was incompatible with the deployed V2 contract bytecode, whose
// PartC enforces `expected_next_state = push4(newHeight) || old_state[5..]`
// — i.e. only the height push may change. With lastTime/target also moving,
// every V2 broadcast tripped OP_EQUALVERIFY (and before the Part C underflow
// fix in Photonic-Wallet 7f19cbb, never even reached that EQUALVERIFY —
// stack-underflowed first). See Photonic-Wallet b3t-forensics/b3t2-root-cause.md.
//
// `buildNextContractState` now mirrors the V1 path for both V1 and V2:
// preserve everything except height. Re-enable these tests once the V2
// bytecode (PartB4 + PartC expected-next-state assembly) is reworked to
// actually splice newLastTime + newTarget into the enforced next state.
describe.skip('V2 Contract Integration: buildNextContractState', () => {
  describe('fixed DAA — target unchanged', () => {
    for (const algo of ['sha256d', 'blake3', 'k12']) {
      it(`${algo}/fixed preserves target`, async () => {
        const fullScript = photonicDMintScript({
          height: 42,
          contractRef: FAKE_CONTRACT_REF,
          tokenRef: FAKE_TOKEN_REF,
          maxHeight: 10000,
          reward: 100,
          target: 5000000n,
          algorithm: algo,
          daaMode: 'fixed',
          lastTime: BASE_LAST_TIME,
        });

        const tx = mockTransaction(fullScript, FAKE_TXID);
        const result = await parseContractTx(tx as any, FAKE_CONTRACT_REF);
        const c = result!.params as Contract;

        const txLockTime = BASE_LAST_TIME + 55;
        const next = buildNextContractState(c, 43n, txLockTime);

        expect(next.target).toBe(5000000n);
        expect(next.lastTime).toBe(BigInt(txLockTime));

        // Re-parse the continuation script to verify round-trip
        const contTx = mockTransaction(next.script, 'dd'.repeat(32));
        const contResult = await parseContractTx(contTx as any, FAKE_CONTRACT_REF);
        expect(contResult).toBeDefined();

        const nc = contResult!.params as Contract;
        expect(nc.height).toBe(43n);
        expect(nc.target).toBe(5000000n);
        expect(nc.lastTime).toBe(BigInt(txLockTime));
        expect(nc.contractRef).toBe(FAKE_CONTRACT_REF);
        expect(nc.tokenRef).toBe(FAKE_TOKEN_REF);
        expect(nc.maxHeight).toBe(10000n);
        expect(nc.reward).toBe(100n);
        expect(nc.algoId).toBe(BigInt(ALGO_IDS[algo]));
        expect(nc.daaMode).toBe('fixed');

        // codeScript must be identical
        expect(nc.codeScript).toBe(c.codeScript);
      });
    }
  });

  describe('ASERT DAA — target adjusts with drift', () => {
    it('target increases when mining is slow (drift > 0)', async () => {
      const halfLife = 3600;
      const targetTime = 60;
      const target = 1000000n;

      const fullScript = photonicDMintScript({
        height: 10,
        contractRef: FAKE_CONTRACT_REF,
        tokenRef: FAKE_TOKEN_REF,
        maxHeight: 10000,
        reward: 100,
        target,
        algorithm: 'blake3',
        daaMode: 'asert',
        halfLife,
        targetTime,
        lastTime: BASE_LAST_TIME,
      });

      const tx = mockTransaction(fullScript, FAKE_TXID);
      const result = await parseContractTx(tx as any, FAKE_CONTRACT_REF);
      const c = result!.params as Contract;
      c.daaParams = { halfLife };

      // Simulate slow mining: 2 hours after lastTime (excess = 7140s, drift = 7140/3600 = 1)
      const txLockTime = BASE_LAST_TIME + 7260;
      const next = buildNextContractState(c, 11n, txLockTime);

      // drift = (7260 - 60) / 3600 = 2 → target << 2
      const expected = computeAsertTarget(target, BigInt(BASE_LAST_TIME), BigInt(txLockTime), BigInt(targetTime), BigInt(halfLife));
      expect(next.target).toBe(expected);
      expect(next.target).toBeGreaterThan(target);
    });

    it('target decreases when mining is fast (drift < 0)', async () => {
      const halfLife = 3600;
      const targetTime = 60;
      const target = 1000000n;

      const fullScript = photonicDMintScript({
        height: 10,
        contractRef: FAKE_CONTRACT_REF,
        tokenRef: FAKE_TOKEN_REF,
        maxHeight: 10000,
        reward: 100,
        target,
        algorithm: 'k12',
        daaMode: 'asert',
        halfLife,
        targetTime,
        lastTime: BASE_LAST_TIME,
      });

      const tx = mockTransaction(fullScript, FAKE_TXID);
      const result = await parseContractTx(tx as any, FAKE_CONTRACT_REF);
      const c = result!.params as Contract;
      c.daaParams = { halfLife };

      // Simulate fast mining: only 5 seconds after lastTime
      // excess = 5 - 60 = -55, drift = -55 / 3600 = 0 (truncates toward zero)
      // Need much faster: excess = -3660 - 60 = would need negative time which is impossible
      // More realistic: last time is very recent, target time is long
      // excess = (1 - 60) / 3600 = 0 (too small). Need bigger halfLife effect.
      // Let's use: timeDelta = 1, targetTime = 60 → excess = -59, drift = -59/3600 = 0
      // For negative drift we need: timeDelta < targetTime by more than halfLife
      // excess = timeDelta - targetTime, drift = excess / halfLife
      // drift = -1 when excess <= -halfLife, i.e. timeDelta <= targetTime - halfLife
      // With targetTime=60, halfLife=3600: need timeDelta <= 60-3600 = -3540 (impossible)
      // Use smaller halfLife=10: drift = (5-60)/10 = -5, clamped to -4
      const fastHalfLife = 10;
      const fullScript2 = photonicDMintScript({
        height: 10,
        contractRef: FAKE_CONTRACT_REF,
        tokenRef: FAKE_TOKEN_REF,
        maxHeight: 10000,
        reward: 100,
        target,
        algorithm: 'k12',
        daaMode: 'asert',
        halfLife: fastHalfLife,
        targetTime,
        lastTime: BASE_LAST_TIME,
      });

      const tx2 = mockTransaction(fullScript2, FAKE_TXID);
      const result2 = await parseContractTx(tx2 as any, FAKE_CONTRACT_REF);
      const c2 = result2!.params as Contract;
      c2.daaParams = { halfLife: fastHalfLife };

      const txLockTime2 = BASE_LAST_TIME + 5; // 5 seconds, way under target
      const next2 = buildNextContractState(c2, 11n, txLockTime2);

      const expected2 = computeAsertTarget(target, BigInt(BASE_LAST_TIME), BigInt(txLockTime2), BigInt(targetTime), BigInt(fastHalfLife));
      expect(next2.target).toBe(expected2);
      expect(next2.target).toBeLessThan(target);
    });

    it('target unchanged when timeDelta == targetTime (drift == 0)', async () => {
      const halfLife = 3600;
      const targetTime = 60;
      const target = 1000000n;

      const fullScript = photonicDMintScript({
        height: 10,
        contractRef: FAKE_CONTRACT_REF,
        tokenRef: FAKE_TOKEN_REF,
        maxHeight: 10000,
        reward: 100,
        target,
        algorithm: 'sha256d',
        daaMode: 'asert',
        halfLife,
        targetTime,
        lastTime: BASE_LAST_TIME,
      });

      const tx = mockTransaction(fullScript, FAKE_TXID);
      const result = await parseContractTx(tx as any, FAKE_CONTRACT_REF);
      const c = result!.params as Contract;
      c.daaParams = { halfLife };

      // timeDelta = exactly targetTime → excess = 0 → drift = 0
      const txLockTime = BASE_LAST_TIME + targetTime;
      const next = buildNextContractState(c, 11n, txLockTime);

      expect(next.target).toBe(target);
    });

    it('drift is clamped to ±4', () => {
      const target = 1000000n;
      // Extreme slow: drift would be +100 but clamped to +4
      const result = computeAsertTarget(target, 0n, 1000000n, 60n, 10n);
      // drift = (1000000 - 60) / 10 = 99994, clamped to 4
      expect(result).toBe(target << 4n);

      // Extreme fast: drift would be -100 but clamped to -4
      const result2 = computeAsertTarget(target, 999940n, 0n, 60n, 10n);
      // timeDelta = 0 - 999940 = -999940, excess = -999940 - 60 = -1000000
      // drift = -1000000 / 10 = -100000, clamped to -4
      expect(result2).toBe(target >> 4n);
    });

    it('target clamped to minimum 1', () => {
      const result = computeAsertTarget(1n, 999940n, 0n, 60n, 10n);
      // 1n >> 4n = 0, clamped to 1
      expect(result).toBe(1n);
    });
  });

  describe('LWMA (Linear) DAA — target scales proportionally', () => {
    it('target doubles when timeDelta is 2× targetTime', async () => {
      const targetTime = 60;
      const target = 1000000n;

      const fullScript = photonicDMintScript({
        height: 10,
        contractRef: FAKE_CONTRACT_REF,
        tokenRef: FAKE_TOKEN_REF,
        maxHeight: 10000,
        reward: 100,
        target,
        algorithm: 'blake3',
        daaMode: 'lwma',
        targetTime,
        lastTime: BASE_LAST_TIME,
      });

      const tx = mockTransaction(fullScript, FAKE_TXID);
      const result = await parseContractTx(tx as any, FAKE_CONTRACT_REF);
      const c = result!.params as Contract;

      const txLockTime = BASE_LAST_TIME + 120; // 2× targetTime
      const next = buildNextContractState(c, 11n, txLockTime);

      expect(next.target).toBe(2000000n); // target * 120 / 60
    });

    it('target halves when timeDelta is 0.5× targetTime', async () => {
      const targetTime = 60;
      const target = 1000000n;

      const fullScript = photonicDMintScript({
        height: 10,
        contractRef: FAKE_CONTRACT_REF,
        tokenRef: FAKE_TOKEN_REF,
        maxHeight: 10000,
        reward: 100,
        target,
        algorithm: 'k12',
        daaMode: 'lwma',
        targetTime,
        lastTime: BASE_LAST_TIME,
      });

      const tx = mockTransaction(fullScript, FAKE_TXID);
      const result = await parseContractTx(tx as any, FAKE_CONTRACT_REF);
      const c = result!.params as Contract;

      const txLockTime = BASE_LAST_TIME + 30; // 0.5× targetTime
      const next = buildNextContractState(c, 11n, txLockTime);

      expect(next.target).toBe(500000n); // target * 30 / 60
    });

    it('target clamped to minimum 1 on very fast mint', () => {
      const result = computeLinearTarget(1n, 1000n, 1000n, 60n);
      // timeDelta = 0, newTarget = 1 * 0 / 60 = 0, clamped to 1
      expect(result).toBe(1n);
    });
  });

  describe('Round-trip: build → re-parse → verify consistency', () => {
    for (const variant of VARIANTS) {
      it(`round-trips ${variantLabel(variant)}`, async () => {
        const initialHeight = 50;
        const target = 3000000n;

        const fullScript = photonicDMintScript({
          height: initialHeight,
          contractRef: FAKE_CONTRACT_REF,
          tokenRef: FAKE_TOKEN_REF,
          maxHeight: 10000,
          reward: 200,
          target,
          lastTime: BASE_LAST_TIME,
          ...variant,
        });

        // Step 1: Parse original
        const tx = mockTransaction(fullScript, FAKE_TXID);
        const result = await parseContractTx(tx as any, FAKE_CONTRACT_REF);
        const c = result!.params as Contract;
        if (variant.daaMode === 'asert') {
          c.daaParams = { halfLife: variant.halfLife ?? 3600 };
        }

        // Step 2: Build next state
        const txLockTime = BASE_LAST_TIME + (variant.targetTime ?? 60);
        const next = buildNextContractState(c, BigInt(initialHeight + 1), txLockTime);

        // Step 3: Re-parse continuation
        const contTx = mockTransaction(next.script, 'ee'.repeat(32));
        const contResult = await parseContractTx(contTx as any, FAKE_CONTRACT_REF);
        expect(contResult).toBeDefined();
        expect(contResult!.state).toBe('active');

        const nc = contResult!.params as Contract;

        // Immutable fields preserved
        expect(nc.contractRef).toBe(FAKE_CONTRACT_REF);
        expect(nc.tokenRef).toBe(FAKE_TOKEN_REF);
        expect(nc.maxHeight).toBe(10000n);
        expect(nc.reward).toBe(200n);
        expect(nc.algoId).toBe(BigInt(ALGO_IDS[variant.algorithm]));
        expect(nc.daaMode).toBe(variant.daaMode);
        expect(nc.targetTime).toBe(BigInt(variant.targetTime ?? 60));

        // Mutable fields updated
        expect(nc.height).toBe(BigInt(initialHeight + 1));
        expect(nc.lastTime).toBe(BigInt(txLockTime));
        expect(nc.target).toBe(next.target);

        // codeScript identical (bytecode is immutable)
        expect(nc.codeScript).toBe(c.codeScript);

        // Preimage stack layout still valid on continuation
        const check = analyzeDmintPreimageStackLayout(nc.script, nc.codeScript);
        expect(check).toBeDefined();
        expect(check!.matchesExpectedLayout).toBe(true);

        // No non-minimal pushes in continuation
        const contFull = nc.codeScript
          ? `${nc.script}bd${nc.codeScript}`
          : nc.script;
        expect(findNonMinimalDataPush(contFull)).toBeUndefined();
      });
    }
  });

  describe('Multi-mint chain: 5 consecutive mints', () => {
    it('blake3/asert chain maintains consistency across 5 mints', async () => {
      let currentHeight = 0;
      let currentTarget = 2000000n;
      let currentLastTime = BASE_LAST_TIME;
      const halfLife = 3600;
      const targetTime = 60;

      // Create initial contract
      let fullScript = photonicDMintScript({
        height: currentHeight,
        contractRef: FAKE_CONTRACT_REF,
        tokenRef: FAKE_TOKEN_REF,
        maxHeight: 10000,
        reward: 100,
        target: currentTarget,
        algorithm: 'blake3',
        daaMode: 'asert',
        halfLife,
        targetTime,
        lastTime: currentLastTime,
      });

      for (let mint = 0; mint < 5; mint++) {
        const tx = mockTransaction(fullScript, `${'aa'.repeat(31)}${mint.toString(16).padStart(2, '0')}`);
        const result = await parseContractTx(tx as any, FAKE_CONTRACT_REF);
        expect(result).toBeDefined();

        const c = result!.params as Contract;
        c.daaParams = { halfLife };

        expect(c.height).toBe(BigInt(currentHeight));
        expect(c.target).toBe(currentTarget);

        // Simulate variable timing: alternate fast/slow
        const timeDelta = mint % 2 === 0 ? 30 : 120; // alternating fast and slow
        const txLockTime = currentLastTime + timeDelta;

        const next = buildNextContractState(c, BigInt(currentHeight + 1), txLockTime);

        // Verify preimage layout on continuation
        const contTx = mockTransaction(next.script, 'ff'.repeat(32));
        const contResult = await parseContractTx(contTx as any, FAKE_CONTRACT_REF);
        const nc = contResult!.params as Contract;

        const check = analyzeDmintPreimageStackLayout(nc.script, nc.codeScript);
        expect(check!.matchesExpectedLayout).toBe(true);

        // Update state for next iteration
        currentHeight += 1;
        currentTarget = next.target;
        currentLastTime = txLockTime;
        fullScript = next.script;
      }

      // After 5 mints, height should be 5
      expect(currentHeight).toBe(5);
    });

    it('sha256d/fixed chain keeps target constant across 5 mints', async () => {
      let fullScript = photonicDMintScript({
        height: 0,
        contractRef: FAKE_CONTRACT_REF,
        tokenRef: FAKE_TOKEN_REF,
        maxHeight: 10000,
        reward: 50,
        target: 4000000n,
        algorithm: 'sha256d',
        daaMode: 'fixed',
        lastTime: BASE_LAST_TIME,
      });

      let currentLastTime = BASE_LAST_TIME;
      const originalTarget = 4000000n;

      for (let mint = 0; mint < 5; mint++) {
        const tx = mockTransaction(fullScript, `${'bb'.repeat(31)}${mint.toString(16).padStart(2, '0')}`);
        const result = await parseContractTx(tx as any, FAKE_CONTRACT_REF);
        const c = result!.params as Contract;

        const txLockTime = currentLastTime + 45;
        const next = buildNextContractState(c, BigInt(mint + 1), txLockTime);

        // Target must remain constant for fixed DAA
        expect(next.target).toBe(originalTarget);

        currentLastTime = txLockTime;
        fullScript = next.script;
      }
    });

    it('k12/lwma chain adjusts target linearly across 5 mints', async () => {
      let fullScript = photonicDMintScript({
        height: 0,
        contractRef: FAKE_CONTRACT_REF,
        tokenRef: FAKE_TOKEN_REF,
        maxHeight: 10000,
        reward: 75,
        target: 1000000n,
        algorithm: 'k12',
        daaMode: 'lwma',
        targetTime: 60,
        lastTime: BASE_LAST_TIME,
      });

      let currentLastTime = BASE_LAST_TIME;
      let currentTarget = 1000000n;

      for (let mint = 0; mint < 5; mint++) {
        const tx = mockTransaction(fullScript, `${'cc'.repeat(31)}${mint.toString(16).padStart(2, '0')}`);
        const result = await parseContractTx(tx as any, FAKE_CONTRACT_REF);
        const c = result!.params as Contract;

        // Each mint takes exactly targetTime → target stays ~same
        const txLockTime = currentLastTime + 60;
        const next = buildNextContractState(c, BigInt(mint + 1), txLockTime);

        // Linear: target * 60 / 60 = target (unchanged when on schedule)
        expect(next.target).toBe(currentTarget);

        currentLastTime = txLockTime;
        currentTarget = next.target;
        fullScript = next.script;
      }
    });
  });
});

describe('V2 Contract Integration: ScriptSig Structure', () => {
  describe('scriptSig components for each algorithm', () => {
    const cases = [
      { algo: 'sha256d' as const, nonceBytes: 4 },
      { algo: 'blake3' as const, nonceBytes: 8 },
      { algo: 'k12' as const, nonceBytes: 8 },
    ];

    for (const { algo, nonceBytes } of cases) {
      it(`${algo} scriptSig: ${nonceBytes}B nonce + 32B inputHash + 32B outputHash + outputIndex`, () => {
        expect(nonceBytesForAlgorithm(algo)).toBe(nonceBytes);

        // Build a scriptSig hex as claimTokens would
        const nonce = 'ab'.repeat(nonceBytes);
        const inputHash = 'cc'.repeat(32);
        const outputHash = 'dd'.repeat(32);
        const outputIndexHex = unlockingOutputIndexOpcodeHex();

        const noncePushOp = nonceBytes.toString(16).padStart(2, '0');
        const scriptSigHex = `${noncePushOp}${nonce}20${inputHash}20${outputHash}${outputIndexHex}`;

        const scriptSig = Script.fromHex(scriptSigHex);
        const asm = scriptSig.toASM();
        const parts = asm.split(' ');

        // Structure: <nonce> <inputHash> <outputHash> <outputIndex>
        expect(parts.length).toBe(4);

        // nonce should be correct length
        expect(parts[0].length / 2).toBe(nonceBytes);

        // hashes should be 32 bytes
        expect(parts[1].length / 2).toBe(32);
        expect(parts[2].length / 2).toBe(32);

        // outputIndex should be OP_0 (radiantjs ASM shows as '0')
        expect(parts[3]).toBe('0');
      });
    }
  });
});

describe('V2 Contract Integration: Edge Cases', () => {
  it('handles height=0 (genesis mint)', async () => {
    const fullScript = photonicDMintScript({
      height: 0,
      contractRef: FAKE_CONTRACT_REF,
      tokenRef: FAKE_TOKEN_REF,
      maxHeight: 100,
      reward: 10,
      target: 500000n,
      algorithm: 'blake3',
      daaMode: 'asert',
      halfLife: 3600,
      targetTime: 60,
      lastTime: BASE_LAST_TIME,
    });

    const tx = mockTransaction(fullScript, FAKE_TXID);
    const result = await parseContractTx(tx as any, FAKE_CONTRACT_REF);
    const c = result!.params as Contract;
    c.daaParams = { halfLife: 3600 };

    expect(c.height).toBe(0n);

    const next = buildNextContractState(c, 1n, BASE_LAST_TIME + 60);
    expect(next.target).toBe(500000n); // exact targetTime → no change

    const contTx = mockTransaction(next.script, 'ff'.repeat(32));
    const contResult = await parseContractTx(contTx as any, FAKE_CONTRACT_REF);
    expect((contResult!.params as Contract).height).toBe(1n);
  });

  it('handles maxHeight-1 (last mint before burn)', async () => {
    const fullScript = photonicDMintScript({
      height: 99,
      contractRef: FAKE_CONTRACT_REF,
      tokenRef: FAKE_TOKEN_REF,
      maxHeight: 100,
      reward: 10,
      target: 500000n,
      algorithm: 'sha256d',
      daaMode: 'fixed',
      lastTime: BASE_LAST_TIME,
    });

    const tx = mockTransaction(fullScript, FAKE_TXID);
    const result = await parseContractTx(tx as any, FAKE_CONTRACT_REF);
    const c = result!.params as Contract;

    expect(c.height).toBe(99n);
    expect(c.maxHeight).toBe(100n);

    // buildNextContractState still works (burn decision is in claimTokens)
    const next = buildNextContractState(c, 100n, BASE_LAST_TIME + 30);
    expect(next.target).toBe(500000n);
  });

  it('handles very large target values', async () => {
    const largeTarget = 0x7fffffffffffffffn; // max safe int64

    const fullScript = photonicDMintScript({
      height: 0,
      contractRef: FAKE_CONTRACT_REF,
      tokenRef: FAKE_TOKEN_REF,
      maxHeight: 10000,
      reward: 100,
      target: largeTarget,
      algorithm: 'k12',
      daaMode: 'fixed',
      lastTime: BASE_LAST_TIME,
    });

    const tx = mockTransaction(fullScript, FAKE_TXID);
    const result = await parseContractTx(tx as any, FAKE_CONTRACT_REF);
    expect((result!.params as Contract).target).toBe(largeTarget);

    const check = analyzeDmintPreimageStackLayout(
      (result!.params as Contract).script,
      (result!.params as Contract).codeScript,
    );
    expect(check!.matchesExpectedLayout).toBe(true);
    expect(findNonMinimalDataPush(fullScript)).toBeUndefined();
  });

  it('handles minimum target value (1)', async () => {
    const fullScript = photonicDMintScript({
      height: 0,
      contractRef: FAKE_CONTRACT_REF,
      tokenRef: FAKE_TOKEN_REF,
      maxHeight: 10000,
      reward: 100,
      target: 1n,
      algorithm: 'blake3',
      daaMode: 'asert',
      halfLife: 10,
      targetTime: 60,
      lastTime: BASE_LAST_TIME,
    });

    const tx = mockTransaction(fullScript, FAKE_TXID);
    const result = await parseContractTx(tx as any, FAKE_CONTRACT_REF);
    const c = result!.params as Contract;
    c.daaParams = { halfLife: 10 };

    // Fast mint → drift negative → target >> N, but clamped to 1
    const next = buildNextContractState(c, 1n, BASE_LAST_TIME + 1);
    expect(next.target).toBe(1n);
  });

  it('handles large reward and maxHeight values', async () => {
    const fullScript = photonicDMintScript({
      height: 0,
      contractRef: FAKE_CONTRACT_REF,
      tokenRef: FAKE_TOKEN_REF,
      maxHeight: 2100000000, // 2.1 billion
      reward: 5000000000,    // 50 RXD
      target: 2500000n,
      algorithm: 'sha256d',
      daaMode: 'fixed',
      lastTime: BASE_LAST_TIME,
    });

    const tx = mockTransaction(fullScript, FAKE_TXID);
    const result = await parseContractTx(tx as any, FAKE_CONTRACT_REF);
    expect((result!.params as Contract).maxHeight).toBe(2100000000n);
    expect((result!.params as Contract).reward).toBe(5000000000n);
    expect(findNonMinimalDataPush(fullScript)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// EPOCH and SCHEDULE: miner-side compute functions must mirror the on-chain
// bytecode (Photonic-Wallet buildEpochDaaBytecode / buildScheduleDaaBytecode)
// exactly. If these drift the miner will predict the wrong next target and
// the broadcast will be rejected.
// ---------------------------------------------------------------------------

describe('computeEpochTarget — mirrors on-chain EPOCH bytecode', () => {
  const oldTarget = 1_000_000n;
  const targetTime = 60n;
  const lastTime = 1_700_000_000n;

  it('preserves target between epoch boundaries', () => {
    // height=5, epochLength=10 — not at boundary
    const next = computeEpochTarget(oldTarget, 5n, lastTime, lastTime + 60n, targetTime, 10n, 2n);
    expect(next).toBe(oldTarget);
  });

  it('preserves target at height=0 (skips initial boundary)', () => {
    // 0 % anything == 0 would trigger naively, but bytecode guards with height>0
    const next = computeEpochTarget(oldTarget, 0n, lastTime, lastTime + 60n, targetTime, 10n, 2n);
    expect(next).toBe(oldTarget);
  });

  it('adjusts target at epoch boundary (delta = targetTime → no change)', () => {
    // height=10, epochLength=10, delta == targetTime → factor 1
    const next = computeEpochTarget(oldTarget, 10n, lastTime, lastTime + 60n, targetTime, 10n, 2n);
    expect(next).toBe(oldTarget);
  });

  it('adjusts target at boundary (delta = 2 × targetTime → 2x easier, clamped at 4x)', () => {
    // delta=120, targetTime=60, factor=2 → newTarget = 2 * oldTarget
    const next = computeEpochTarget(oldTarget, 10n, lastTime, lastTime + 120n, targetTime, 10n, 2n);
    expect(next).toBe(oldTarget * 2n);
  });

  it('clamps delta to upper bound (delta > targetTime << N)', () => {
    // delta=600, targetTime=60, N=2 → upperBound = 60<<2 = 240
    // clampedDelta = 240, newTarget = oldTarget * 240 / 60 = oldTarget * 4
    const next = computeEpochTarget(oldTarget, 10n, lastTime, lastTime + 600n, targetTime, 10n, 2n);
    expect(next).toBe(oldTarget * 4n);
  });

  it('clamps delta to lower bound (delta < targetTime >> N)', () => {
    // delta=5, targetTime=60, N=2 → lowerBound = 60>>2 = 15
    // clampedDelta = 15, newTarget = oldTarget * 15 / 60 = oldTarget / 4
    const next = computeEpochTarget(oldTarget, 10n, lastTime, lastTime + 5n, targetTime, 10n, 2n);
    expect(next).toBe(oldTarget / 4n);
  });

  it('floors target at 1', () => {
    // Tiny old target, delta forces it below 1
    const next = computeEpochTarget(2n, 10n, lastTime, lastTime + 5n, 60n, 10n, 2n);
    // newTarget = 2 * 15 / 60 = 0 → clamped to 1
    expect(next).toBe(1n);
  });

  it('different maxAdjustmentLog2 values give different clamp bounds', () => {
    // N=1 → upperBound = 60<<1 = 120; N=4 → upperBound = 60<<4 = 960
    const slowMint = lastTime + 10_000n; // very long delta
    const aggressive = computeEpochTarget(oldTarget, 10n, lastTime, slowMint, 60n, 10n, 4n);
    const gentle = computeEpochTarget(oldTarget, 10n, lastTime, slowMint, 60n, 10n, 1n);
    expect(aggressive).toBeGreaterThan(gentle);
  });
});

describe('computeScheduleTarget — mirrors on-chain SCHEDULE bytecode', () => {
  const oldTarget = 1_000_000n;
  const schedule = [
    { height: 1000, target: 500_000n },
    { height: 2000, target: 250_000n },
    { height: 5000, target: 100_000n },
  ];

  it('preserves target below the first boundary', () => {
    expect(computeScheduleTarget(oldTarget, 500n, schedule)).toBe(oldTarget);
    expect(computeScheduleTarget(oldTarget, 999n, schedule)).toBe(oldTarget);
  });

  it('matches first boundary exactly', () => {
    expect(computeScheduleTarget(oldTarget, 1000n, schedule)).toBe(500_000n);
  });

  it('uses the largest boundary at or below height', () => {
    expect(computeScheduleTarget(oldTarget, 1500n, schedule)).toBe(500_000n);
    expect(computeScheduleTarget(oldTarget, 2000n, schedule)).toBe(250_000n);
    expect(computeScheduleTarget(oldTarget, 3000n, schedule)).toBe(250_000n);
    expect(computeScheduleTarget(oldTarget, 5000n, schedule)).toBe(100_000n);
    expect(computeScheduleTarget(oldTarget, 99_999n, schedule)).toBe(100_000n);
  });

  it('returns oldTarget for empty schedule', () => {
    expect(computeScheduleTarget(oldTarget, 5000n, [])).toBe(oldTarget);
  });

  it('accepts difficulty-form entries (auto-converts to target)', () => {
    // Wallet sometimes sends {height, difficulty} instead of {height, target}.
    // MAX_TARGET / 100 = 0x0147ae147ae147ae (≈ 9.22 × 10^16)
    const result = computeScheduleTarget(
      oldTarget,
      5000n,
      [{ height: 1000, difficulty: 100 }],
    );
    const expected = 0x7fffffffffffffffn / 100n;
    expect(result).toBe(expected);
  });

  it('handles a schedule passed in arbitrary order (sorts descending internally)', () => {
    const shuffled = [
      { height: 5000, target: 100_000n },
      { height: 1000, target: 500_000n },
      { height: 2000, target: 250_000n },
    ];
    expect(computeScheduleTarget(oldTarget, 3000n, shuffled)).toBe(250_000n);
    expect(computeScheduleTarget(oldTarget, 999n, shuffled)).toBe(oldTarget);
  });
});
