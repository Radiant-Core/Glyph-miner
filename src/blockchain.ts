import { base58AddressToLockingBytecode } from "@bitauth/libauth";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { Script, Transaction } from "@radiant-core/radiantjs";
import { burnScript, dMintScript, fetchToken, parseContractTx } from "./glyph";
import {
  accepted,
  balance,
  contract,
  glyph,
  loadingContract,
  mineToAddress,
  miningEnabled,
  miningStatus,
  mintMessage,
  rejected,
  selectedContract,
  utxos,
  wallet,
  work,
} from "./signals";
import { addMessage } from "./message";
import miner, { updateWork } from "./miner";
import {
  reverseRef,
  scriptHash,
  deriveSubContractRefCandidates,
  push4bytes,
  pushMinimal,
} from "./utils";
import { broadcast, client, fetchRef, fetchTx } from "./client";
import { Contract, Work, Utxo, AlgorithmId } from "./types";
import { FEE_PER_KB } from "./constants";
import { fetchContract as fetchContractFromApi } from "./dmint-api";
import { normalizeNonceHexForScriptSig } from "./nonce";

// Map API algorithm ID to AlgorithmId string (0/1/2 only for now)
function mapAlgorithmId(apiAlgo: number): AlgorithmId {
  // 0 = sha256d, 1 = blake3, 2 = k12
  switch (apiAlgo) {
    case 0: return 'sha256d';
    case 1: return 'blake3';
    case 2: return 'k12';
    default: return 'sha256d';
  }
}

// Subscription statuses
let addressSubscriptionStatus = "";
let contractSubscriptionStatus = "";

// Timer to ensure address subscription is received after mint
let subscriptionCheckTimer: ReturnType<typeof setTimeout>;

// Timer to periodically update the contract in case of subscription failure
let contractCheckTimer: ReturnType<typeof setTimeout>;

type PendingNonce = {
  nonce: string;
  work: Work;
  contract: Contract;
};

let nonces: PendingNonce[] = [];

// Ready will be true when there is no pending token claim
let ready: boolean = true;

// Sometimes subscriptions arrive late after another nonce is found so keep track of previous locations
let acceptedLocations: string[] = [];

// Keep track of consecutive mempool conflicts
let mempoolConflictCounter = 0;

enum ClaimError {
  MEMPOOL_CONFLICT,
  CONTRACT_FAIL,
  MISSING_INPUTS,
  LOW_FEE,
  NON_MINIMAL_PUSH,
}

type DmintPreimageStackCheck = {
  usesIndexedLegacyPreimage: boolean;
  stateItemCount: number;
  pick5: string;
  pick9a: string;
  pick9b: string;
  roll10: string;
  matchesExpectedLayout: boolean;
};

function pickStackItem(stack: string[], n: number): string {
  return stack[stack.length - 1 - n];
}

function stackPick(stack: string[], n: number) {
  stack.push(pickStackItem(stack, n));
}

function stackCat(stack: string[]) {
  const right = stack.pop();
  const left = stack.pop();
  stack.push(`cat(${left},${right})`);
}

function stackSha256(stack: string[]) {
  const value = stack.pop();
  stack.push(`sha256(${value})`);
}

function stackRoll(stack: string[], n: number): string {
  const index = stack.length - 1 - n;
  const [value] = stack.splice(index, 1);
  stack.push(value);
  return value;
}

function getStateItemsFromScriptHex(stateScriptHex: string): string[] | undefined {
  const asm = Script.fromHex(stateScriptHex).toASM();
  const tokens = asm.split(" ").filter(Boolean);
  const singletonIndex = tokens.indexOf("OP_PUSHINPUTREFSINGLETON");
  const refIndex = tokens.indexOf("OP_PUSHINPUTREF", singletonIndex + 2);
  if (singletonIndex < 0 || refIndex < 0) {
    return;
  }

  // Use semantic labels so the stack simulation can verify PICK/ROLL correctness.
  // The actual hex values don't matter for layout validation — only positions do.
  const tail = tokens.slice(refIndex + 2);
  const labeledTail = tail.map((_, i) => `stateItem${i}`);
  return ["height", "contractRef", "tokenRef", ...labeledTail];
}

function parsePreimageIndicesFromCodeAsm(codeAsm: string): {
  contractRefPickIndex: number;
  ioPickIndex: number;
  nonceRollIndex: number;
} | undefined {
  // Match pattern: OP_OUTPOINTTXHASH <N> OP_PICK ... <M> OP_PICK <M> OP_PICK ... <R> OP_ROLL
  const match = codeAsm.match(
    /OP_OUTPOINTTXHASH\s+(OP_\d+|\d+)\s+OP_PICK\s+OP_CAT\s+OP_SHA256\s+(OP_\d+|\d+)\s+OP_PICK\s+(OP_\d+|\d+)\s+OP_PICK\s+OP_CAT\s+OP_SHA256\s+OP_CAT\s+(OP_\d+|\d+)\s+OP_ROLL/
  );
  if (!match) return;

  const parseOpNum = (token: string): number => {
    if (/^OP_\d+$/.test(token)) return Number(token.slice(3));
    if (token === 'OP_0') return 0;
    return parseInt(token, 10);
  };

  return {
    contractRefPickIndex: parseOpNum(match[1]),
    ioPickIndex: parseOpNum(match[2]),
    nonceRollIndex: parseOpNum(match[4]),
  };
}

export function analyzeDmintPreimageStackLayout(
  stateScriptHex: string,
  codeScriptHex?: string,
): DmintPreimageStackCheck | undefined {
  if (!codeScriptHex) {
    return;
  }

  const codeAsm = Script.fromHex(codeScriptHex).toASM();
  const indices = parsePreimageIndicesFromCodeAsm(codeAsm);

  if (!indices) {
    return;
  }

  const stateItems = getStateItemsFromScriptHex(stateScriptHex);
  if (!stateItems) {
    return;
  }

  const stack = [
    "nonce",
    "inputHash",
    "outputHash",
    "outputIndex",
    ...stateItems,
    "outpointTxHash",
  ];

  stackPick(stack, indices.contractRefPickIndex);
  const pickContractRef = stack[stack.length - 1];
  stackCat(stack);
  stackSha256(stack);

  stackPick(stack, indices.ioPickIndex);
  const pickInputHash = stack[stack.length - 1];
  stackPick(stack, indices.ioPickIndex);
  const pickOutputHash = stack[stack.length - 1];
  stackCat(stack);
  stackSha256(stack);
  stackCat(stack);

  const rollNonce = stackRoll(stack, indices.nonceRollIndex);

  const matchesExpectedLayout =
    pickContractRef === "contractRef" &&
    pickInputHash === "inputHash" &&
    pickOutputHash === "outputHash" &&
    rollNonce === "nonce";

  return {
    usesIndexedLegacyPreimage: true,
    stateItemCount: stateItems.length,
    pick5: pickContractRef,
    pick9a: pickInputHash,
    pick9b: pickOutputHash,
    roll10: rollNonce,
    matchesExpectedLayout,
  };
}

export function extractCodeScriptHashOp(codeScript?: string): "aa" | "ee" | "ef" | undefined {
  if (!codeScript) return;
  const match = codeScript
    .toLowerCase()
    .match(/7a7e(aa|ee|ef)bc01147f/);
  return match?.[1] as "aa" | "ee" | "ef" | undefined;
}

function shouldIncludeOutputIndexInUnlockingScript(
  stateScriptHex: string,
  codeScriptHex?: string,
): boolean {
  void stateScriptHex;
  if (!codeScriptHex) {
    return true;
  }

  const asm = Script.fromHex(codeScriptHex).toASM();

  const usesV2Preimage =
    asm.includes("OP_OUTPOINTTXHASH OP_9 OP_PICK") &&
    asm.includes("OP_13 OP_PICK OP_13 OP_PICK") &&
    asm.includes("OP_14 OP_ROLL");

  if (usesV2Preimage) {
    return true;
  }

  // All V2 contracts include outputIndex in the unlocking stack
  // (nonce, inputHash, outputHash, outputIndex) to satisfy indexed PICK/ROLL depths.
  return true;
}

export function unlockingOutputIndexOpcodeHex(_codeScriptHex?: string): string {
  // outputIndex tells the contract which output holds the continuation state.
  // The tx always places the contract continuation at output 0.
  return "00"; // OP_0
}

export function mapHashOpToAlgorithm(hashOp?: "aa" | "ee" | "ef"): AlgorithmId | undefined {
  switch (hashOp) {
    case "aa":
      return "sha256d";
    case "ee":
      return "blake3";
    case "ef":
      return "k12";
    default:
      return;
  }
}

export function nonceBytesForAlgorithm(algorithm?: AlgorithmId): 4 | 8 {
  return algorithm === "blake3" || algorithm === "k12" ? 8 : 4;
}

function normalizeNonceHex(nonceHex: string, nonceBytes: 4 | 8): string {
  return normalizeNonceHexForScriptSig(nonceHex, nonceBytes);
}

/**
 * Walks a script's push opcodes and returns a description of the first push
 * that would fail radiantd's CheckMinimalPush (Radiant-Core
 * src/script/script.cpp:374), or undefined if all pushes are minimal.
 *
 * Replaces a pre-redesign heuristic that used Script.fromHex().toASM() and
 * matched single 2-char hex tokens — that approach false-flagged any direct
 * push of a single byte in [1..16] or 0x81 (catching real MINIMALDATA
 * violations) AND false-positive-flagged the byte `0x00` (which is minimal
 * when pushed as `01 00`, since OP_0 pushes empty rather than [0x00]). The
 * new walker matches CheckMinimalPush byte-for-byte: only single-byte data
 * pushes whose payload is in [1..16] or equals 0x81 are non-minimal, plus
 * PUSHDATA1/2/4 used below their length thresholds.
 */
export function findNonMinimalDataPush(scriptHex: string): string | undefined {
  const bytes = Buffer.from(scriptHex, "hex");
  let i = 0;
  while (i < bytes.length) {
    const op = bytes[i];
    if (op >= 0x01 && op <= 0x4b) {
      const len = op;
      if (len === 1 && i + 1 < bytes.length) {
        const v = bytes[i + 1];
        if (v >= 1 && v <= 16)
          return `push 1 0x${v.toString(16).padStart(2, "0")}`;
        if (v === 0x81) return `push 1 0x81`;
      }
      i += 1 + len;
      continue;
    }
    if (op === 0x4c) {
      const len = bytes[i + 1] ?? 0;
      if (len < 0x4c) return `PUSHDATA1 ${len}`;
      i += 2 + len;
      continue;
    }
    if (op === 0x4d) {
      const len = (bytes[i + 1] ?? 0) | ((bytes[i + 2] ?? 0) << 8);
      if (len <= 0xff) return `PUSHDATA2 ${len}`;
      i += 3 + len;
      continue;
    }
    if (op === 0x4e) {
      const len =
        (bytes[i + 1] ?? 0) |
        ((bytes[i + 2] ?? 0) << 8) |
        ((bytes[i + 3] ?? 0) << 16) |
        ((bytes[i + 4] ?? 0) << 24);
      if (len <= 0xffff) return `PUSHDATA4 ${len}`;
      i += 5 + len;
      continue;
    }
    i++;
  }
  return undefined;
}

type NextContractState = {
  script: string;
  target: bigint;
  lastTime?: bigint;
};

// Kept as an export for callers that may need it once the on-chain DAA
// propagation work lands and `buildNextContractState` starts rewriting the
// state-script fields again.
export function daaModeToId(mode?: string): bigint {
  switch (mode) {
    case 'fixed': return 0n;
    case 'epoch': return 1n;
    case 'asert': return 2n;
    case 'lwma': return 3n;
    case 'schedule': return 4n;
    default: return 0n;
  }
}

// Must match Photonic-Wallet packages/lib/src/script.ts MAX_TARGET.
// MAX_TARGET = 0x7FFF_FFFF_FFFF_FFFF — the highest 8-byte LE positive script
// number whose sign bit is clear; OP_NUM2BIN(8) in V3 PartC requires this.
const MAX_TARGET = 0x7fffffffffffffffn;
const MAX_TARGET_DIV4 = MAX_TARGET >> 2n; // 0x1FFF_FFFF_FFFF_FFFF — LWMA pre-cap

export function computeAsertTarget(
  oldTarget: bigint,
  lastTime: bigint,
  currentTime: bigint,
  targetTime: bigint,
  halfLife: bigint,
): bigint {
  const timeDelta = currentTime - lastTime;
  const excess = timeDelta - targetTime;
  let drift = excess / halfLife; // integer division (truncates toward zero in bigint)

  // Clamp drift to [-4, +4]
  if (drift > 4n) drift = 4n;
  if (drift < -4n) drift = -4n;

  let newTarget: bigint;
  if (drift > 0n) {
    // Mirrors the on-chain 4×OP_2MUL unroll with per-step cap at MAX_TARGET.
    // Once target reaches MAX_TARGET it's a fixed point — the bytecode caps
    // pre-OP_2MUL via `min(target, MAX_TARGET/2)`, equivalent to capping the
    // final result at MAX_TARGET.
    newTarget = oldTarget << drift;
    if (newTarget > MAX_TARGET) newTarget = MAX_TARGET;
  } else if (drift < 0n) {
    newTarget = oldTarget >> (-drift);
  } else {
    newTarget = oldTarget;
  }

  // Clamp to minimum 1
  if (newTarget < 1n) newTarget = 1n;
  return newTarget;
}

export function computeLinearTarget(
  oldTarget: bigint,
  lastTime: bigint,
  currentTime: bigint,
  targetTime: bigint,
): bigint {
  // Mirrors Photonic-Wallet buildLinearDaaBytecode() after the §S-CRIT-3 fix:
  //   1. Cap timeDelta to 4 × targetTime  (matches ASERT drift range).
  //   2. Cap target to MAX_TARGET/4       (keeps the OP_MUL within int64).
  //   3. Divide-first: (target_capped / targetTime) × cappedDelta.
  //   4. Final defensive MIN with MAX_TARGET.
  // Without these caps the on-chain OP_MUL aborts at default difficulty
  // (oldTarget ≈ MAX_TARGET/10) and broadcast fails OP_EQUALVERIFY.
  let cappedDelta = currentTime - lastTime;
  const deltaCap = 4n * targetTime;
  if (cappedDelta > deltaCap) cappedDelta = deltaCap;

  const targetCapped =
    oldTarget > MAX_TARGET_DIV4 ? MAX_TARGET_DIV4 : oldTarget;

  let newTarget = (targetCapped / targetTime) * cappedDelta;
  if (newTarget > MAX_TARGET) newTarget = MAX_TARGET;
  if (newTarget < 1n) newTarget = 1n;
  return newTarget;
}

/**
 * Translate a user-facing maxAdjustment factor (2, 4, 8, 16) to the log2 shift
 * count the on-chain EPOCH bytecode embeds. Mirrors Photonic-Wallet
 * packages/lib/src/script.ts maxAdjustmentToLog2() exactly.
 */
export function epochMaxAdjustmentToLog2(value: number | undefined): bigint {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 2n; // default 4x
  if (value === 1 || value === 2 || value === 3 || value === 4) return BigInt(value); // already log2
  const factorToLog2: Record<number, bigint> = { 2: 1n, 4: 2n, 8: 3n, 16: 4n };
  if (value in factorToLog2) return factorToLog2[value];
  // Out-of-range value: fall back to default rather than throw mid-mine.
  return 2n;
}

/**
 * Compute the EPOCH-mode next target. Mirrors the on-chain bytecode from
 * Photonic-Wallet buildEpochDaaBytecode() so miner predictions match what
 * the contract spend will compute.
 *
 *   if (height > 0) and (height % epochLength == 0):
 *     delta        = currentTime - lastTime
 *     clampedDelta = max(targetTime >> N, min(targetTime << N, delta))
 *     newTarget    = max(1, oldTarget * clampedDelta / targetTime)
 *   else:
 *     target unchanged
 */
export function computeEpochTarget(
  oldTarget: bigint,
  height: bigint,
  lastTime: bigint,
  currentTime: bigint,
  targetTime: bigint,
  epochLength: bigint,
  maxAdjustmentLog2: bigint,
): bigint {
  if (height <= 0n) return oldTarget;
  if (epochLength <= 0n) return oldTarget;
  if (height % epochLength !== 0n) return oldTarget;

  const n = maxAdjustmentLog2;
  const delta = currentTime - lastTime;
  // On-chain (post §2.3 fix) computes `targetTime × 2^N` and `targetTime / 2^N`
  // via N unrolled OP_2MUL/OP_2DIV. For positive operands bigint shift is
  // numerically identical, so no code change is needed here.
  const upperBound = targetTime << n;
  const lowerBound = targetTime >> n;

  let clampedDelta = delta;
  if (clampedDelta > upperBound) clampedDelta = upperBound;
  if (clampedDelta < lowerBound) clampedDelta = lowerBound;

  let newTarget = (oldTarget * clampedDelta) / targetTime;
  // Mirror the defensive PUSH_MAX_TARGET OP_MIN added in the bytecode.
  if (newTarget > MAX_TARGET) newTarget = MAX_TARGET;
  if (newTarget < 1n) newTarget = 1n;
  return newTarget;
}

/**
 * Compute the SCHEDULE-mode next target. Mirrors the on-chain bytecode from
 * Photonic-Wallet buildScheduleDaaBytecode() — walk schedule descending by
 * height, return the first entry whose height ≤ current height; otherwise
 * preserve the old target.
 *
 * Accepts entries with either `target` (bigint, preferred) or `difficulty`
 * (number, converted via dMintDiffToTarget semantics) so that miner code
 * stays robust against either CBOR form.
 */
export function computeScheduleTarget(
  oldTarget: bigint,
  height: bigint,
  schedule: Array<{ height: number | bigint; target?: bigint | number; difficulty?: number }>,
  maxTarget: bigint = 0x7fffffffffffffffn, // same as Photonic-Wallet MAX_TARGET
): bigint {
  if (!Array.isArray(schedule) || schedule.length === 0) return oldTarget;

  // Build a sorted-descending list of {height, target}
  const normalized: Array<{ height: bigint; target: bigint }> = schedule
    .map((e) => {
      const h = typeof e.height === 'bigint' ? e.height : BigInt(e.height);
      let t: bigint;
      if (typeof e.target === 'bigint') {
        t = e.target;
      } else if (typeof e.target === 'number' && Number.isFinite(e.target)) {
        t = BigInt(e.target);
      } else if (typeof e.difficulty === 'number' && Number.isFinite(e.difficulty) && e.difficulty > 0) {
        t = maxTarget / BigInt(e.difficulty);
      } else {
        // Skip entries we can't interpret; the miner should never see these in
        // practice because the wallet validates at build time.
        return null;
      }
      return { height: h, target: t };
    })
    .filter((x): x is { height: bigint; target: bigint } => x !== null)
    .sort((a, b) => (a.height > b.height ? -1 : a.height < b.height ? 1 : 0));

  for (const entry of normalized) {
    if (height >= entry.height) return entry.target;
  }
  return oldTarget;
}

export function isV2Contract(contract: Contract): boolean {
  return contract.algoId !== undefined && contract.daaMode !== undefined;
}

/**
 * Detect the post-2026-05-26 redesigned V2 (launch) dMint contract shape.
 * Marker: PartB4 = `6b75757575` (TOALTSTACK + 4×DROP). Pre-redesign V2
 * contracts (B3T2, K12T, DEEZ, apple — and the dead V3 VRT deploy) have
 * different bytecode and would not parse as v2 via parseDmintScript anyway.
 * Retained as a helper for code paths that already passed parsing (e.g.
 * buildNextContractState) and need to confirm shape before branching.
 */
export function isLaunchV2Contract(contract: Contract): boolean {
  if (!isV2Contract(contract) || !contract.codeScript) return false;
  return contract.codeScript.toLowerCase().includes("6b75757575");
}

/** @deprecated retained as an alias during the migration — points at the
 *  same predicate as isLaunchV2Contract since the pre-redesign "V3" path is
 *  gone. Will be removed once external callers are updated. */
export const isV3Contract = isLaunchV2Contract;

/**
 * Lower bound on the wallet balance (in photons/sats) needed to fund one
 * more mint of the given contract.
 *
 * Estimates `fee_for_tx + reward + dust + safety_margin`:
 *
 *   - V2 mint txs are ~1500-1600 bytes (state script + bytecode + signed
 *     funding input). V1 are ~1300-1400. Use the high end for both so the
 *     threshold cushions for nonce-length variance and signature DER size.
 *   - At FEE_PER_KB the fee is `bytes / 1000 * FEE_PER_KB`. We multiply by
 *     1.2 as a safety margin against actual-tx-size-bigger-than-estimate.
 *   - Add the reward (paid to the mine-to address) plus 2 dust outputs
 *     (1 sat next-contract + 0 sat OP_RETURN), rounded up to 2000 photons.
 *
 * Used by the mining loop to decide "do not start (or stop) mining when the
 * next broadcast will be rejected with `min relay fee not met`."
 *
 * History: the previous low-balance checks (blockchain.ts:1039,1170 and
 * Miner.tsx:100) compared `balance.value` (photons) to fractional RXD
 * constants (0.0001, 0.01). Because photons ≥ 1 always exceeds 0.01, the
 * checks effectively never fired — observed today (2026-05-25) when a K12T
 * mine wasted nonce 2f51041d on a "fee not met" broadcast after the wallet
 * balance dropped below the relay-fee floor mid-session.
 */
export function estimateMintBalanceFloorPhotons(contract: Contract): number {
  const estimatedTxBytes = isV2Contract(contract) ? 1600 : 1400;
  const estimatedFeePhotons = Math.ceil(
    (estimatedTxBytes * FEE_PER_KB) / 1000 * 1.2
  );
  const dustPhotons = 2000;
  return estimatedFeePhotons + Number(contract.reward) + dustPhotons;
}

/**
 * Build the next contract state script for the V2-launch shape.
 *
 * The on-chain PartC reconstructs `expected_next_state` from scratch as:
 *   MINIMAL_PUSH(newHeight) || <middle_literal> || "04" || NUM2BIN(4, locktime) ||
 *   MINIMAL_PUSH(newTarget_from_alt)
 *
 * where <middle_literal> is the deploy-time-baked blob containing items 2-8
 * (cRef, tRef, mh, r, algoId, daaMode, targetTime — all unchanging across mints).
 * The miner mirrors that emission exactly: same pushMinimal helper, same fixed
 * lastTime width, with the unchanged middle pulled directly from the old state
 * script via length-based slicing.
 */
export function buildNextContractState(
  contract: Contract,
  newHeight: bigint,
  txLockTime?: number,
): NextContractState {
  if (isLaunchV2Contract(contract) && contract.codeScript) {
    const currentTime = BigInt(txLockTime || Math.floor(Date.now() / 1000));
    const oldTarget = contract.target;
    const lastTime = contract.lastTime ?? currentTime;
    const targetTime = contract.targetTime ?? 60n;

    let newTarget = oldTarget;
    if (contract.daaMode === "asert") {
      const halfLife = BigInt(contract.daaParams?.halfLife || 3600);
      newTarget = computeAsertTarget(
        oldTarget,
        lastTime,
        currentTime,
        targetTime,
        halfLife,
      );
    } else if (contract.daaMode === "lwma") {
      newTarget = computeLinearTarget(
        oldTarget,
        lastTime,
        currentTime,
        targetTime,
      );
    } else if (contract.daaMode === "epoch") {
      const epochLength = BigInt(contract.daaParams?.epochLength || 2016);
      const maxAdjustmentLog2 = epochMaxAdjustmentToLog2(
        contract.daaParams?.maxAdjustmentLog2 ??
          contract.daaParams?.maxAdjustment,
      );
      newTarget = computeEpochTarget(
        oldTarget,
        newHeight,
        lastTime,
        currentTime,
        targetTime,
        epochLength,
        maxAdjustmentLog2,
      );
    } else if (contract.daaMode === "schedule") {
      newTarget = computeScheduleTarget(
        oldTarget,
        newHeight,
        contract.daaParams?.schedule ?? [],
      );
    }
    // fixed: newTarget = oldTarget (no change)

    // The wallet emits stateScript = heightPush || middleLiteral || lastTimePush || targetPush
    // where heightPush and targetPush are pushMinimal (variable width) and
    // lastTimePush is push4bytes (fixed 5 bytes). The middle is unchanged
    // across mints. We rebuild by slicing the OLD state script:
    //   - skip leading heightPush (variable: 1 byte for OP_N/OP_0, else 1+L bytes)
    //   - keep middleLiteral
    //   - skip trailing lastTimePush (5 bytes) + targetPush (variable)
    //
    // Easier than parsing pushes: rebuild middleLiteral from the contract's
    // already-parsed fields and re-emit.
    const algoIdToHex: Record<string, number> = {
      sha256d: 0,
      blake3: 1,
      k12: 2,
    };
    const algoId = algoIdToHex[contract.algorithm ?? "sha256d"] ?? 0;
    const daaId = daaModeToId(contract.daaMode);
    const middleLiteralHex = [
      `d8${contract.contractRef}`,
      `d0${contract.tokenRef}`,
      pushMinimal(contract.maxHeight),
      pushMinimal(contract.reward),
      pushMinimal(BigInt(algoId)),
      pushMinimal(daaId),
      pushMinimal(targetTime),
    ].join("");
    const newHeightPush = pushMinimal(newHeight);
    const newLastTimePush = push4bytes(Number(currentTime));
    const newTargetPush = pushMinimal(newTarget);
    const nextStateScript = `${newHeightPush}${middleLiteralHex}${newLastTimePush}${newTargetPush}`;

    return {
      script: `${nextStateScript}bd${contract.codeScript}`,
      target: newTarget,
      lastTime: currentTime,
    };
  }

  // V1 fallback: only the height push (first 5 bytes) may change; lastTime
  // and target are pinned by V1 PartC's expected_next_state equation.
  void txLockTime;
  const nextStateScript = `${push4bytes(Number(newHeight))}${contract.script.substring(10)}`;

  if (contract.codeScript) {
    return {
      script: `${nextStateScript}bd${contract.codeScript}`,
      target: contract.target,
      lastTime: contract.lastTime,
    };
  }

  return {
    script: dMintScript({
      ...contract,
      height: newHeight,
    }),
    target: contract.target,
    lastTime: contract.lastTime,
  };
}

async function claimTokens(
  contract: Contract,
  work: Work,
  nonce: string
): Promise<
  {
    success: true;
    txid: string;
    nextContractState?: { target: bigint; lastTime?: bigint };
  } | { success: false; error?: ClaimError }
> {
  if (!wallet.value) return { success: false };

  const newHeight = contract.height + 1n;
  const lastMint = newHeight === contract.maxHeight;
  const codeScriptHashOp = extractCodeScriptHashOp(contract.codeScript);
  const codeScriptAlgo = mapHashOpToAlgorithm(codeScriptHashOp);
  const resolvedAlgorithm = work.algorithm || contract.algorithm || codeScriptAlgo;
  const nonceBytes = nonceBytesForAlgorithm(resolvedAlgorithm);
  const nonceForScriptSig = normalizeNonceHex(nonce, nonceBytes);
  const includeOutputIndexInUnlockingScript = shouldIncludeOutputIndexInUnlockingScript(
    contract.script,
    contract.codeScript,
  );
  const inputScriptHash = bytesToHex(sha256(sha256(work.inputScript)));
  const outputScriptHash = bytesToHex(sha256(sha256(work.outputScript)));
  const fundingInputCount = utxos.value.length;
  const fundingInputsMatchInputHash = fundingInputCount > 0;
  const fullContractScript = contract.codeScript
    ? `${contract.script}bd${contract.codeScript}`
    : contract.script;
  const nonMinimalPush = findNonMinimalDataPush(fullContractScript);
  const preimageStackCheck = analyzeDmintPreimageStackLayout(
    contract.script,
    contract.codeScript,
  );

  console.debug("Pre-submit validation", {
    nonceHexLength: nonceForScriptSig.length,
    nonceByteLength: nonceForScriptSig.length / 2,
    nonceMode: `${nonceBytes}-byte`,
    includeOutputIndexInUnlockingScript,
    fundingInputCount,
    fundingInputsMatchInputHash,
    codeScriptHashOp,
    nonMinimalPush,
    inputScriptHash,
    outputScriptHash,
    preimageStackCheck,
  });

  if (nonMinimalPush) {
    console.warn(
      `Blocking submit: contract script contains non-minimal push (${nonMinimalPush}); node rejects with Data push larger than necessary`
    );
    return { success: false, error: ClaimError.NON_MINIMAL_PUSH };
  }

  if (!fundingInputsMatchInputHash) {
    console.warn(
      `Blocking submit: no funding inputs available for required inputHash ${inputScriptHash}`
    );
    return { success: false, error: ClaimError.MISSING_INPUTS };
  }

  if (preimageStackCheck && !preimageStackCheck.matchesExpectedLayout) {
    console.warn(
      "Blocking submit: dMint preimage stack layout mismatch; codeScript OP_PICK/OP_ROLL indices do not map to contractRef/inputHash/outputHash/nonce",
      preimageStackCheck,
    );
    if (resolvedAlgorithm !== "sha256d") {
      return { success: false, error: ClaimError.CONTRACT_FAIL };
    }
    console.warn(
      "Continuing submit despite preimage stack layout warning for legacy SHA256d contract",
      {
        resolvedAlgorithm,
        codeScriptHashOp,
      },
    );
  }

  const noncePushOp = nonceBytes.toString(16).padStart(2, "0");
  const outputIndexOpcodeHex = unlockingOutputIndexOpcodeHex(contract.codeScript);
  const scriptSigHex = includeOutputIndexInUnlockingScript
    ? `${noncePushOp}${nonceForScriptSig}20${inputScriptHash}20${outputScriptHash}${outputIndexOpcodeHex}`
    : `${noncePushOp}${nonceForScriptSig}20${inputScriptHash}20${outputScriptHash}`;
  const scriptSig = Script.fromHex(scriptSigHex);

  const tx = new Transaction();
  tx.feePerKb(FEE_PER_KB);
  const p2pkh = Script.fromAddress(wallet.value.address).toHex();
  const ft = `${Script.fromAddress(mineToAddress.value).toHex()}bdd0${
    contract.tokenRef
  }dec0e9aa76e378e4a269e69d`;
  const privKey = wallet.value.privKey;
  const reward = Number(contract.reward);

  // V2 DAA contracts require nLockTime for OP_TXLOCKTIME timestamp
  const needsNLockTime = isV2Contract(contract) && contract.daaMode !== 'fixed';
  const txLockTime = needsNLockTime ? Math.floor(Date.now() / 1000) : 0;
  if (txLockTime > 0) {
    (tx as any).nLockTime = txLockTime;
  }

  tx.addInput(
    new Transaction.Input({
      prevTxId: contract.location,
      outputIndex: contract.outputIndex,
      script: new Script(),
      output: new Transaction.Output({
        script: contract.script,
        satoshis: 1,
      }),
    })
  );

  // @ts-expect-error ...
  tx.setInputScript(0, () => scriptSig);

  // Consolidate all UTXOs
  utxos.value.forEach((utxo) => {
    tx.from({
      txId: utxo.tx_hash,
      outputIndex: utxo.tx_pos,
      script: p2pkh,
      satoshis: utxo.value,
    });
  });

  const nextContractState = !lastMint
    ? buildNextContractState(contract, newHeight, txLockTime || undefined)
    : undefined;

  if (lastMint) {
    const burn = burnScript(contract.contractRef);
    tx.addOutput(
      new Transaction.Output({
        satoshis: 0,
        script: burn,
      })
    );
  } else {
    const dmint = nextContractState?.script;
    tx.addOutput(
      new Transaction.Output({
        satoshis: 1,
        script: dmint,
      })
    );
  }

  tx.addOutput(
    new Transaction.Output({
      satoshis: reward,
      script: ft,
    })
  );

  // Output script is message
  tx.addOutput(
    new Transaction.Output({
      satoshis: 0,
      script: bytesToHex(work.outputScript),
    })
  );

  tx.change(wallet.value.address);
  tx.sign(privKey);
  tx.seal();

  const scriptSigAsm = scriptSig.toASM();
  const scriptSigParts = scriptSigAsm.split(" ");
  const txOutputAudit = tx.outputs.map((output, index) => {
    const scriptHex = output.script.toHex();
    return {
      index,
      scriptHash: bytesToHex(sha256(sha256(hexToBytes(scriptHex)))),
      scriptHex,
    };
  });
  console.debug("Contract submit audit", {
    nonce: nonceForScriptSig,
    algorithm: resolvedAlgorithm,
    codeScriptHashOp,
    workPreimageTxid: bytesToHex(work.txid),
    workPreimageRef: bytesToHex(work.contractRef),
    target: contract.target.toString(),
    nextTarget: nextContractState?.target?.toString(),
    nextLastTime: nextContractState?.lastTime?.toString(),
    txLockTime: tx.getLockTime(),
    contractLocation: contract.location,
    contractOutputIndex: contract.outputIndex,
    scriptSigAsm,
    scriptSigHex,
    scriptSigPartCount: scriptSigParts.length,
    scriptSigNonceLen: scriptSigParts[0]?.length,
    scriptSigInputHashLen: scriptSigParts[1]?.length,
    scriptSigOutputHashLen: scriptSigParts[2]?.length,
    inputScriptHash,
    outputScriptHash,
    txInputCount: tx.inputs.length,
    txOutputCount: tx.outputs.length,
    txOutputAudit,
  });

  const hex = tx.toString();
  try {
    console.debug("Broadcasting", hex);
    const txid = (await broadcast(hex)) as string;
    console.debug(`txid ${txid}`);

    // Update UTXOs so if there's a mint before subscription updates it can be funded
    // Set a timer that will refresh wallet in case tx was replaced and no subscription received
    startSubscriptionCheckTimer();
    const changeOutputIndex = tx.outputs.length - 1;
    utxos.value = [
      {
        tx_hash: txid,
        tx_pos: changeOutputIndex,
        value: tx.outputs[changeOutputIndex].satoshis,
      },
    ];

    // Also update balance so low balance message can be shown if needed
    balance.value = utxos.value.reduce((a, { value }) => a + value, 0);

    return {
      success: true,
      txid,
      nextContractState: nextContractState
        ? {
            target: nextContractState.target,
            lastTime: nextContractState.lastTime,
          }
        : undefined,
    };
  } catch (exception) {
    console.debug("Broadcast failed", exception);

    const msg = ((exception as Error).message || "").toLowerCase();
    let error = undefined;

    if (msg.includes("missing inputs")) {
      error = ClaimError.MISSING_INPUTS;
    }

    if (
      msg.includes("min relay fee not met") ||
      msg.includes("bad-txns-in-belowout")
    ) {
      error = ClaimError.LOW_FEE;
    }
    if (msg.includes("txn-mempool-conflict")) {
      error = ClaimError.MEMPOOL_CONFLICT;
    }
    if (msg.includes("mandatory-script-verify-flag-failed")) {
      error = ClaimError.CONTRACT_FAIL;
    }

    return { success: false, error };
  }
}

// Sometimes a tx might not get mined and no subscription status is received
// Set a timer to update unspent. This timer will be cleared when a subscription is received.
function startSubscriptionCheckTimer() {
  clearTimeout(subscriptionCheckTimer);
  subscriptionCheckTimer = setTimeout(() => {
    console.debug("No subscription received. Updating unspent.");
    updateUnspent();
  }, 10000);
}

// If no subscription has been received in the last minute then force an update
// This timer is cleared and recreated every time a subscription is received
// The timeout is shorter after a mempool conflict
function startContractCheckTimer(duration = 60000, fullRecovery = false) {
  clearTimeout(contractCheckTimer);
  contractCheckTimer = setTimeout(() => {
    try {
      if (fullRecovery) {
        // Pause mining and update unspent and contract
        recoverFromError();
      } else if (contract.value) {
        // Only refresh contract
        updateContract();
      }
    } catch (error) {
      console.debug("Contract check error", error);
    }
    startContractCheckTimer();
  }, duration);
}

const updateUnspent = async () => {
  if (wallet.value) {
    const p2pkh = base58AddressToLockingBytecode(wallet.value?.address);
    if (typeof p2pkh !== "string") {
      const sh = scriptHash(p2pkh.bytecode);

      console.debug("updateUnspent", sh);
      const response = (await client.request(
        "blockchain.scripthash.listunspent",
        sh
      )) as Utxo[];
      if (response) {
        balance.value = response.reduce((a, { value }) => a + value, 0);
        utxos.value = response;
      }
    }
  }
};

// Resubscribe to everything and restart mining
export async function recoverFromError() {
  if (!contract.value?.contractRef) {
    return;
  }

  addMessage({
    type: "general",
    msg: "Updating wallet and resubscribing to contract",
  });

  loadingContract.value = true;
  try {
    const refBE = reverseRef(contract.value.contractRef);
    // Stop miner and wait for UTXOs to update
    miner.stop();
    await updateUnspent();
    // Refetch token and resubscribe to contract
    await changeToken(refBE);
    if (miningEnabled.value) {
      miner.start();
      addMessage({ type: "start" });
    }
    loadingContract.value = false;
  } catch {
    loadingContract.value = false;
    addMessage({
      type: "general",
      msg: "Waiting for contract",
    });
    if (miningEnabled.value) {
      miner.start();
    }
  }
}

export function subscribeToAddress() {
  console.debug("Subscribing to address");
  const address = wallet.value?.address;
  if (!address) {
    return;
  }

  const p2pkh = base58AddressToLockingBytecode(address);
  if (typeof p2pkh !== "string") {
    console.debug(`Address set to ${address}`);

    const sh = scriptHash(p2pkh.bytecode);
    client.subscribe(
      "blockchain.scripthash",
      (_, newStatus: unknown) => {
        clearTimeout(subscriptionCheckTimer);
        if (newStatus !== addressSubscriptionStatus) {
          addressSubscriptionStatus = newStatus as string;
          console.debug(`Status received ${newStatus}`);
          updateUnspent();
        }
      },
      sh
    );
  }
}

async function mintedOut(location: string) {
  if (!contract.value) return;

  const currentContractRef = contract.value.contractRef;
  const tokenRef = contract.value.tokenRef;

  addMessage({
    type: "minted-out",
    ref: reverseRef(currentContractRef),
  });

  // No contract data exists in burn output so use existing data and set height to max
  contract.value = {
    ...contract.value,
    location,
    height: contract.value.maxHeight,
  };

  // Auto-switch: try to find the next available sub-contract
  const beContractRef = reverseRef(currentContractRef);
  const beTokenRef = reverseRef(tokenRef);
  const currentVout = parseInt(beContractRef.substring(64), 16);
  const tokenVout = parseInt(beTokenRef.substring(64), 16);
  const currentSubIndex = currentVout - tokenVout - 1;

  addMessage({ type: "general", msg: "Searching for next available sub-contract..." });

  // Scan forward from the next sub-contract
  for (let i = currentSubIndex + 1; i < currentSubIndex + 64; i++) {
    const candidateRefs = deriveSubContractRefCandidates(beTokenRef, i);
    let hadLookupError = false;
    for (const candidateRef of candidateRefs) {
      try {
        const token = await fetchToken(candidateRef);
        if (token && token.contract.height < token.contract.maxHeight) {
          addMessage({ type: "general", msg: `Auto-switching to sub-contract ${i + 1}` });
          selectedContract.value = candidateRef;
          changeToken(candidateRef);
          miningEnabled.value = true;
          return;
        }
      } catch {
        hadLookupError = true;
      }
    }

    if (hadLookupError) {
      // No more sub-contracts found, stop scanning
      break;
    }
  }

  // Also try from the beginning in case earlier sub-contracts became available
  for (let i = 0; i < currentSubIndex; i++) {
    const candidateRefs = deriveSubContractRefCandidates(beTokenRef, i);
    for (const candidateRef of candidateRefs) {
      try {
        const token = await fetchToken(candidateRef);
        if (token && token.contract.height < token.contract.maxHeight) {
          addMessage({ type: "general", msg: `Auto-switching to sub-contract ${i + 1}` });
          selectedContract.value = candidateRef;
          changeToken(candidateRef);
          miningEnabled.value = true;
          return;
        }
      } catch {
        continue;
      }
    }
  }

  // No available sub-contracts found
  miningEnabled.value = false;
  miner.stop();
  addMessage({ type: "general", msg: "All sub-contracts are fully mined. Mining stopped." });
}

export function foundNonce(nonce: string) {
  if (!contract.value || !work.value) {
    return;
  }

  const workSnapshot: Work & { algorithm?: AlgorithmId } = {
    ...work.value,
    txid: new Uint8Array(work.value.txid),
    contractRef: new Uint8Array(work.value.contractRef),
    inputScript: new Uint8Array(work.value.inputScript),
    outputScript: new Uint8Array(work.value.outputScript),
    algorithm: (work.value as Work & { algorithm?: AlgorithmId }).algorithm,
  };

  nonces.push({
    nonce,
    work: workSnapshot,
    contract: { ...contract.value },
  });

  if (ready) {
    submit();
  }
}

async function submit() {
  console.debug("Submitting", { nonceCount: nonces.length, ready, contract: !!contract.value, work: !!work.value });
  const pending = nonces.pop();

  // TODO handle multiple nonces, if one fails try the next
  nonces = [];

  if (!pending) {
    return;
  }

  const { nonce, contract: pendingContract, work: pendingWork } = pending;

  const codeScriptHashOp = extractCodeScriptHashOp(pendingContract.codeScript);
  const codeScriptAlgo = mapHashOpToAlgorithm(codeScriptHashOp);
  const resolvedAlgorithm =
    pendingWork.algorithm || pendingContract.algorithm || codeScriptAlgo;
  const nonceBytes = nonceBytesForAlgorithm(resolvedAlgorithm);
  console.debug("Submit context", {
    nonceHexLength: nonce.length,
    nonceByteLength: nonce.length / 2,
    nonceMode: `${nonceBytes}-byte`,
    fundingInputCount: utxos.value.length,
    codeScriptHashOp,
  });

  ready = false;

  const result = await claimTokens(pendingContract, pendingWork, nonce);
  if (result.success) {
    const { txid } = result;
    accepted.value++;
    mempoolConflictCounter = 0;
    ready = true;
    addMessage({
      type: "accept",
      nonce,
      msg: mintMessage.value || "",
      txid,
    });

    // Keep track of the last 20 accepted locations
    acceptedLocations.push(txid);
    acceptedLocations = acceptedLocations.slice(-20);

    // Set the new location now instead of waiting for the subscription
    const height = pendingContract.height + 1n;
    if (height === pendingContract.maxHeight) {
      mintedOut(txid);
    } else {
      console.debug(`Changed location to ${txid}`);
      contract.value = {
        ...pendingContract,
        height,
        location: txid,
        outputIndex: 0,
        target: result.nextContractState?.target ?? pendingContract.target,
        lastTime: result.nextContractState?.lastTime ?? pendingContract.lastTime,
      };
      miningStatus.value = "change";
    }

    const floor = estimateMintBalanceFloorPhotons(pendingContract);
    if (balance.value < floor) {
      const needRxd = (floor / 100000000).toFixed(4);
      const haveRxd = (balance.value / 100000000).toFixed(4);
      addMessage({
        type: "general",
        msg: `Balance too low for next mint (need ~${needRxd} RXD, have ${haveRxd} RXD)`,
      });
      miner.stop();
      miningEnabled.value = false;
      addMessage({ type: "stop" });
    }
  } else {
    const rejectMessage = (reason: string) =>
      addMessage({
        type: "reject",
        nonce,
        reason,
      });

    if (
      result.error === ClaimError.MISSING_INPUTS ||
      result.error === ClaimError.CONTRACT_FAIL ||
      result.error === ClaimError.NON_MINIMAL_PUSH
    ) {
      clearTimeout(subscriptionCheckTimer);

      if (result.error === ClaimError.MISSING_INPUTS) {
        // This should be caught by subscription and subscriptionCheckTimer, but handle here in case
        rejectMessage("missing inputs");
      } else if (result.error === ClaimError.NON_MINIMAL_PUSH) {
        rejectMessage("contract uses non-minimal pushdata");
        addMessage({
          type: "general",
          msg: "Contract script is non-minimal and cannot be mined on this node policy",
        });
        miner.stop();
        miningEnabled.value = false;
        addMessage({ type: "stop" });
      } else {
        console.debug("Contract fail context", {
          algorithm: pendingWork.algorithm,
          codeScriptHashOp: extractCodeScriptHashOp(pendingContract.codeScript),
          nonce,
          inputScriptHash: bytesToHex(sha256(sha256(pendingWork.inputScript))),
          outputScriptHash: bytesToHex(sha256(sha256(pendingWork.outputScript))),
        });
        rejectMessage("contract execution failed");
      }

      recoverFromError();
    } else if (result.error == ClaimError.LOW_FEE) {
      // Stop mining if fees can't be paid
      rejectMessage("fee not met");
      miner.stop();
      miningEnabled.value = false;
      addMessage({ type: "stop" });
    } else if (result.error == ClaimError.MEMPOOL_CONFLICT) {
      rejectMessage("mempool conflict");
      mempoolConflictCounter++;

      // If there are consecutive mempool conflicts, then refetch and resubscribe to everything again
      if (mempoolConflictCounter === 3) {
        recoverFromError();
      } else {
        // If no subscription is received within the next 10 seconds, refetch
        // This timer will be cleared when contract subscription is received
        startContractCheckTimer(10000, true);
      }
    }

    rejected.value++;
    ready = true;
  }
}

// Change token. Ref is big-endian.
export async function changeToken(ref: string) {
  loadingContract.value = true;
  acceptedLocations = [];
  // Unsubscribe from current subscription
  if (work.value?.contractRef) {
    console.debug(
      `Unsubscribing from current contract ${bytesToHex(
        work.value?.contractRef
      )}`
    );
    const sh = scriptHash(work.value?.contractRef);
    // Some Electrum servers don't implement unsubscribe. Ignore that specific RPC error.
    void client
      .unsubscribe("blockchain.scripthash", sh)
      .catch((error: unknown) => {
        const msg = String((error as Error)?.message || error || "").toLowerCase();
        if (msg.includes("unknown method")) {
          console.debug("Server does not support blockchain.scripthash.unsubscribe");
          return;
        }
        console.debug("Failed to unsubscribe from current contract", error);
      });
  }

  const token = await fetchToken(ref);
  loadingContract.value = false;

  if (!token) {
    addMessage({ type: "not-found", ref });
    return;
  }

  // Try to get algorithm from dmint API.
  // If API is unavailable, leave algorithm undefined so miner can fall back
  // to algorithm from glyph payload.
  let algorithm: AlgorithmId | undefined;
  try {
    const apiContract = await fetchContractFromApi(ref);
    if (apiContract) {
      algorithm = mapAlgorithmId(apiContract.algorithm);
      console.log("Algorithm from API:", apiContract.algorithm, "->", algorithm);
    }
  } catch (e) {
    console.warn("Failed to fetch algorithm from API:", e);
  }

  // Store algorithm in contract only when API provided it
  contract.value = algorithm
    ? { ...token.contract, algorithm }
    : { ...token.contract };
  glyph.value = token.glyph;
  updateWork();

  if (token.contract.height === token.contract.maxHeight) {
    addMessage({ type: "minted-out", ref, msg: token.contract.message });
    return;
  }

  addMessage({ type: "loaded", ref, msg: token.contract.message });

  const loadFloor = estimateMintBalanceFloorPhotons(token.contract);
  if (balance.value < loadFloor) {
    const needRxd = (loadFloor / 100000000).toFixed(4);
    const haveRxd = (balance.value / 100000000).toFixed(4);
    addMessage({
      type: "general",
      msg: `Balance is low (need ~${needRxd} RXD per mint, have ${haveRxd} RXD). Please fund wallet to start mining.`,
    });
  }

  if (miningStatus.value === "mining") {
    miningStatus.value = "change";
  }

  // Subscribe to the singleton so we know when the contract moves
  // Change ref to little-endian
  const refLe = reverseRef(ref);
  const sh = scriptHash(hexToBytes(refLe));
  client.subscribe(
    "blockchain.scripthash",
    async (_, status) => {
      startContractCheckTimer();

      if (status !== contractSubscriptionStatus) {
        updateContract();
      }

      contractSubscriptionStatus = status as string;
    },
    sh
  );

  return { contract, glyph };
}

async function updateContract() {
  const ref = contract.value?.contractRef;
  if (!ref) return;

  const ids = await fetchRef(reverseRef(ref));
  const location = ids[1]?.tx_hash;
  if (
    contract.value &&
    location !== contract.value?.location &&
    !acceptedLocations.includes(location)
  ) {
    console.debug(`New contract location ${location}`);
    const locTx = await fetchTx(location, true);
    const parsed = await parseContractTx(locTx, ref);

    if (parsed?.state && parsed.params.message) {
      addMessage({
        type: "new-location",
        txid: location,
        msg: parsed.params.message,
      });
    }

    if (parsed?.state === "active") {
      contract.value = parsed.params;
      if (miningStatus.value === "mining") {
        miningStatus.value = "change";
      }
    } else if (parsed?.state === "burn") {
      mintedOut(location);
    }
  } else if (acceptedLocations.includes(location)) {
    console.debug(`Old location received ${location}`);
  }
}
