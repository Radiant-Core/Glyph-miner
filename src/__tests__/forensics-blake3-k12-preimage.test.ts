/**
 * Forensic step P1 + P2-NEW for the Glyph_v2_BLAKE3_K12_Integration_Design.md doc.
 *
 * P1: Diff the miner's powPreimage construction against what Part A of the
 *     v2 dMint bytecode would deterministically assemble. If these disagree
 *     for BLAKE3/K12, that is the §3.1 root cause of "miner finds nonce,
 *     network rejects block."
 *
 * P2-NEW: Run BLAKE3 and K12 official test vectors against @noble/hashes
 *         (miner's CPU reference) and radiantjs (self-test interpreter's
 *         reference). If they disagree, §3.6 cross-implementation drift is
 *         in play and would invalidate the assumption that @noble/hashes is
 *         ground truth.
 *
 * This file does NOT execute the Script.Interpreter — it mirrors Part A
 * symbolically in TS, which is sufficient for diffing the byte string at
 * the <powHashOp> point. A follow-up test using radiantjs's full
 * Script.Interpreter is appropriate once P1 narrows the suspect.
 */

import { describe, it, expect } from 'vitest';
import { sha256 } from '@noble/hashes/sha2';
import { blake3 } from '@noble/hashes/blake3';
import { k12 } from '@noble/hashes/sha3-addons';
import { bytesToHex, hexToBytes, concatBytes } from '@noble/hashes/utils';

// Try to import radiantjs hashers; if not exposed, P2-NEW degrades to a
// "manual run required" diagnostic.
let radiantjsHash: any = null;
try {
  // The package exports vary by build; reach into the lib path that
  // lib/script/interpreter.js uses.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  radiantjsHash = require('@radiant-core/radiantjs/lib/crypto/hash');
} catch {
  /* fall back to manual diagnostic below */
}

// ---------------------------------------------------------------------------
// Helpers replicating Glyph-miner src/pow.ts powPreimage and src/nonce.ts
// (kept self-contained so this test is a single-file forensic artifact).
// ---------------------------------------------------------------------------

function nonceBytesV2(nonceU32: number): Uint8Array {
  const buf = new Uint8Array(8);
  const view = new DataView(buf.buffer);
  view.setUint32(0, nonceU32 >>> 0, true); // low LE
  view.setUint32(4, 0, true); // high zeros (matches nonceBytesForContracts)
  return buf;
}

function powPreimage(args: {
  txid: Uint8Array; // 32B — OP_OUTPOINTTXHASH internal-byte-order (LE)
  contractRef: Uint8Array; // 36B (32B ref-txid + 4B index)
  inputScript: Uint8Array;
  outputScript: Uint8Array;
}): Uint8Array {
  const inputCsh = sha256(sha256(args.inputScript));
  const outputCsh = sha256(sha256(args.outputScript));
  return concatBytes(
    sha256(concatBytes(args.txid, args.contractRef)),
    sha256(concatBytes(inputCsh, outputCsh)),
  );
}

// ---------------------------------------------------------------------------
// Mirror of Part A's deterministic stack operations, executed in TS.
//
// Bytecode reference: photonic-wallet packages/lib/src/script.ts
//   buildDmintPreimageBytecodePartA (lines 447-471).
//
// Stack at entry (per the comment in script.ts):
//   bottom: nonce, inputHash, outputHash, outputIndex, <stateItems>, outpointTxHash :top
//
// Part A's effect (op-by-op):
//   OP_1 OP_DROP                — sentinel; consumed
//   OP_OUTPOINTTXHASH           — push outpointTxHash (already on top per comment)
//   <pick contractRef>          — copy contractRef to top
//   OP_SWAP                     — swap top two
//   OP_CAT                      — outpointTxHash || contractRef
//   OP_SHA256                   — sha256(outpointTxHash || contractRef)
//   <pick inputHash>            — copy inputHash to top
//   <pick outputHash>           — copy outputHash to top
//   OP_SWAP   (encoded as 7e)   — wait: 7e is OP_CAT. Re-read.
//   OP_CAT                      — inputHash || outputHash
//   OP_SHA256                   — sha256(inputHash || outputHash)
//   OP_CAT                      — sha256(...) || sha256(...)
//   <roll nonce>                — bring nonce to top
//   OP_CAT                      — append nonce
//
// The spender's scriptSig pushes (bottom-up): nonce, inputHash, outputHash,
// outputIndex. The state items are pushed by an earlier mechanism. The miner
// is responsible for choosing what inputHash and outputHash to push — the
// rest of the contract verifies that these committed hashes match the actual
// tx inputs/outputs via tx-introspection opcodes.
//
// The KEY ASSUMPTION verified by this test:
//   inputHash  == sha256(sha256(actual_input_script))    (i.e. == inputCsh in pow.ts)
//   outputHash == sha256(sha256(actual_output_script))   (i.e. == outputCsh in pow.ts)
// If the miner-built spend pushes anything else (e.g. raw script, single sha256),
// the preimages diverge and that is the §3.1 bug.
// ---------------------------------------------------------------------------

function onChainPartAPreimage(args: {
  outpointTxHash: Uint8Array;
  contractRef: Uint8Array;
  inputHash: Uint8Array; // = whatever the spender's scriptSig pushed at this slot
  outputHash: Uint8Array; // = whatever the spender's scriptSig pushed at this slot
  nonceBytes: Uint8Array;
}): Uint8Array {
  return concatBytes(
    sha256(concatBytes(args.outpointTxHash, args.contractRef)),
    sha256(concatBytes(args.inputHash, args.outputHash)),
    args.nonceBytes,
  );
}

// ---------------------------------------------------------------------------
// hashMeetsTarget — mirror of miner.ts:494-501
// ---------------------------------------------------------------------------
function hashMeetsTarget(hash: Uint8Array, target: bigint): boolean {
  if (hash[0] !== 0 || hash[1] !== 0 || hash[2] !== 0 || hash[3] !== 0) return false;
  const view = new DataView(hash.slice(4, 12).buffer, 0);
  return view.getBigUint64(0, false) < target;
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------
const TXID = hexToBytes('cc'.repeat(32));
const CONTRACT_REF = hexToBytes('aa'.repeat(32) + '00000001'); // 36B
const INPUT_SCRIPT = hexToBytes('76a914' + '33'.repeat(20) + '88ac'); // P2PKH
const OUTPUT_SCRIPT = hexToBytes('6a' + '03' + '6d7367' + '0b' + '48656c6c6f20776f726c64'); // OP_RETURN "msg" "Hello world"
const NONCE_U32 = 0x12345678;

// ---------------------------------------------------------------------------
// P1: Miner vs on-chain preimage diff
// ---------------------------------------------------------------------------
describe('P1: powPreimage (miner) vs Part A (on-chain) preimage diff', () => {
  const nonceBytes = nonceBytesV2(NONCE_U32);

  const minerPreimage = concatBytes(
    powPreimage({
      txid: TXID,
      contractRef: CONTRACT_REF,
      inputScript: INPUT_SCRIPT,
      outputScript: OUTPUT_SCRIPT,
    }),
    nonceBytes,
  );

  const onChainPreimage_AssumingDoubleSha256 = onChainPartAPreimage({
    outpointTxHash: TXID,
    contractRef: CONTRACT_REF,
    inputHash: sha256(sha256(INPUT_SCRIPT)),
    outputHash: sha256(sha256(OUTPUT_SCRIPT)),
    nonceBytes,
  });

  const onChainPreimage_AssumingSingleSha256 = onChainPartAPreimage({
    outpointTxHash: TXID,
    contractRef: CONTRACT_REF,
    inputHash: sha256(INPUT_SCRIPT),
    outputHash: sha256(OUTPUT_SCRIPT),
    nonceBytes,
  });

  it('miner preimage equals on-chain preimage IF spender pushes sha256(sha256(script))', () => {
    expect(bytesToHex(minerPreimage)).toBe(bytesToHex(onChainPreimage_AssumingDoubleSha256));
  });

  it('miner preimage does NOT equal on-chain preimage if spender pushes only single-sha256(script)', () => {
    // This documents the failure mode: if the miner-built spend tx pushes
    // single-sha256 hashes (or raw scripts) into the inputHash/outputHash
    // slots, Part A computes a different preimage than the miner's powPreimage.
    expect(bytesToHex(minerPreimage)).not.toBe(bytesToHex(onChainPreimage_AssumingSingleSha256));
  });

  it('printable diagnostic — log both preimages and the resulting BLAKE3/K12 hashes', () => {
    const out: string[] = [];
    out.push(`miner preimage (72B)         : ${bytesToHex(minerPreimage)}`);
    out.push(`on-chain (double-sha256 IH/OH): ${bytesToHex(onChainPreimage_AssumingDoubleSha256)}`);
    out.push(`on-chain (single-sha256 IH/OH): ${bytesToHex(onChainPreimage_AssumingSingleSha256)}`);
    out.push(`blake3(miner)                : ${bytesToHex(blake3(minerPreimage))}`);
    out.push(`blake3(onchain double-sha)   : ${bytesToHex(blake3(onChainPreimage_AssumingDoubleSha256))}`);
    out.push(`k12(miner)                   : ${bytesToHex(k12(minerPreimage, { dkLen: 32 }))}`);
    out.push(`k12(onchain double-sha)      : ${bytesToHex(k12(onChainPreimage_AssumingDoubleSha256, { dkLen: 32 }))}`);
    // eslint-disable-next-line no-console
    console.log('\n' + out.join('\n') + '\n');
    expect(true).toBe(true);
  });

  it('hashMeetsTarget convention matches PartB1 (digest-agnostic spot-check)', () => {
    // Synthetic hash with 4 leading zero bytes and a known middle 8 bytes.
    const synthetic = new Uint8Array(32);
    synthetic[0] = 0;
    synthetic[1] = 0;
    synthetic[2] = 0;
    synthetic[3] = 0;
    // bytes 4..11 = 0x00000000_00000001 (BE) — i.e. comparison value = 1
    synthetic[11] = 1;
    expect(hashMeetsTarget(synthetic, 2n)).toBe(true);
    expect(hashMeetsTarget(synthetic, 1n)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// P2-NEW: BLAKE3 / K12 implementation agreement (§3.6)
//
// Goal: confirm @noble/hashes and radiantjs's pure-JS implementations produce
// identical output. Radiant-Core's C++ impl is the consensus authority and
// must be cross-checked separately via a unit test in Radiant-Core (not from
// this TS suite).
// ---------------------------------------------------------------------------
describe('P2-NEW: BLAKE3 / K12 cross-implementation agreement', () => {
  // Standard test vectors (from the BLAKE3 reference test vector file and
  // the K12 spec / RFC drafts). Inputs are short here; an extended suite
  // should include >8192-byte inputs to exercise BLAKE3's chunking and K12's
  // tree mode.
  const VECTORS: Array<{ name: string; input: Uint8Array }> = [
    { name: 'empty', input: new Uint8Array(0) },
    { name: 'abc', input: new TextEncoder().encode('abc') },
    { name: '64 x "a"', input: new TextEncoder().encode('a'.repeat(64)) },
    { name: '1024 x "a" (single BLAKE3 chunk)', input: new TextEncoder().encode('a'.repeat(1024)) },
    { name: '8193 x "a" (crosses BLAKE3 chunk + K12 chunk)', input: new TextEncoder().encode('a'.repeat(8193)) },
  ];

  for (const v of VECTORS) {
    it(`@noble/hashes BLAKE3(${v.name}) is deterministic and 32 bytes`, () => {
      const h = blake3(v.input);
      expect(h.length).toBe(32);
      // Sanity: re-computing yields the same bytes (no state leakage)
      expect(bytesToHex(h)).toBe(bytesToHex(blake3(v.input)));
    });

    it(`@noble/hashes K12(${v.name}, dkLen=32) is deterministic and 32 bytes`, () => {
      const h = k12(v.input, { dkLen: 32 });
      expect(h.length).toBe(32);
      expect(bytesToHex(h)).toBe(bytesToHex(k12(v.input, { dkLen: 32 })));
    });
  }

  // -------------------------------------------------------------------------
  // §3.6 RADIANT-CORE VECTORS — these are the EXACT expected outputs that
  // Radiant-Core's CBlake3 / CK12 are tested against in
  // src/test/crypto_tests.cpp (blake3_tests, k12_tests).
  // If @noble/hashes disagrees with any of these, §3.6 is the bug:
  // the miner is generating hashes that the consensus engine cannot reproduce.
  // -------------------------------------------------------------------------
  const incrementing = (len: number): Uint8Array => {
    const a = new Uint8Array(len);
    for (let i = 0; i < len; i++) a[i] = i % 251;
    return a;
  };

  const BLAKE3_RADIANT_VECTORS: Array<{ name: string; input: Uint8Array; expected: string }> = [
    { name: 'empty', input: new Uint8Array(0), expected: 'af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262' },
    { name: '1B 0x00', input: new Uint8Array([0x00]), expected: '2d3adedff11b61f14c886e35afa036736dcd87a74d27b5c1510225d0f592e213' },
    { name: '2B 00..01', input: new Uint8Array([0x00, 0x01]), expected: '7b7015bb92cf0b318037702a6cdd81dee41224f734684c2c122cd6359cb1ee63' },
    { name: '3B 00..02', input: new Uint8Array([0x00, 0x01, 0x02]), expected: 'e1be4d7a8ab5560aa4199eea339849ba8e293d55ca0a81006726d184519e647f' },
    { name: '4B 00..03', input: new Uint8Array([0x00, 0x01, 0x02, 0x03]), expected: 'f30f5ab28fe047904037f77b6da4fea1e27241c5d132638d8bedce9d40494f32' },
    { name: '65B i%251', input: incrementing(65), expected: 'de1e5fa0be70df6d2be8fffd0e99ceaa8eb6e8c93a63f2d8d1c30ecb6b263dee' },
    // 72B is the dMint v2 preimage size (64B preimage + 8B nonce).
    { name: '72B i%251 (dMint preimage size!)', input: incrementing(72), expected: '028eb97d80291fc1f4ab846657fb2277cae9d7eda639c09bd220a9c869f0e9e6' },
    { name: '128B i%251', input: incrementing(128), expected: 'f17e570564b26578c33bb7f44643f539624b05df1a76c81f30acd548c44b45ef' },
    { name: '251B i%251', input: incrementing(251), expected: '2a43e6bf5d7dfe202bf9653c94aacb221a20cd5e449602684d9ffbd38d9a8920' },
  ];

  const K12_RADIANT_VECTORS: Array<{ name: string; input: Uint8Array; expected: string }> = [
    { name: 'empty (C="")', input: new Uint8Array(0), expected: '1ac2d450fc3b4205d19da7bfca1b37513c0803577ac7167f06fe2ce1f0ef39e5' },
    { name: '17B zeros (C="")', input: new Uint8Array(17), expected: '9b201678f3160105ce0941a58f52a7c0e6898f3d73b7300a9582fed4adb63b22' },
  ];

  for (const v of BLAKE3_RADIANT_VECTORS) {
    it(`@noble/hashes BLAKE3 matches Radiant-Core for: ${v.name}`, () => {
      const got = bytesToHex(blake3(v.input));
      if (got !== v.expected) {
        // eslint-disable-next-line no-console
        console.error(
          `\n§3.6 CROSS-IMPL MISMATCH (BLAKE3, ${v.name}):\n` +
            `  Radiant-Core:  ${v.expected}\n` +
            `  @noble/hashes: ${got}\n` +
            `This is the bug. The miner CPU-verifies with @noble/hashes but the node hashes with Radiant-Core C++.\n`,
        );
      }
      expect(got).toBe(v.expected);
    });
  }

  for (const v of K12_RADIANT_VECTORS) {
    it(`@noble/hashes K12 matches Radiant-Core for: ${v.name}`, () => {
      const got = bytesToHex(k12(v.input, { dkLen: 32 }));
      if (got !== v.expected) {
        // eslint-disable-next-line no-console
        console.error(
          `\n§3.6 CROSS-IMPL MISMATCH (K12, ${v.name}):\n` +
            `  Radiant-Core:  ${v.expected}\n` +
            `  @noble/hashes: ${got}\n`,
        );
      }
      expect(got).toBe(v.expected);
    });
  }

  it('radiantjs cross-check (if Hash.blake3 / Hash.k12 are importable)', () => {
    if (!radiantjsHash || (!radiantjsHash.blake3 && !radiantjsHash.k12)) {
      // eslint-disable-next-line no-console
      console.warn(
        '\n[P2-NEW] radiantjs Hash module not found at lib/crypto/hash.\n' +
          'Run manually: open Photonic Wallet DevTools and compare\n' +
          '  Hash.blake3(buf) vs noble.blake3(buf)\n' +
          '  Hash.k12(buf)   vs noble.k12(buf, {dkLen:32})\n' +
          'for the VECTORS above. Any mismatch is a §3.6 cross-impl bug.\n',
      );
      expect(true).toBe(true); // diagnostic only
      return;
    }
    for (const v of VECTORS) {
      if (radiantjsHash.blake3) {
        const rj = radiantjsHash.blake3(Buffer.from(v.input));
        const nb = blake3(v.input);
        expect(bytesToHex(Uint8Array.from(rj))).toBe(bytesToHex(nb));
      }
      if (radiantjsHash.k12) {
        const rj = radiantjsHash.k12(Buffer.from(v.input));
        const nb = k12(v.input, { dkLen: 32 });
        expect(bytesToHex(Uint8Array.from(rj))).toBe(bytesToHex(nb));
      }
    }
  });
});
