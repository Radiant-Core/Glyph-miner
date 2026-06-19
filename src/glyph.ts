import { Buffer } from "buffer";
import { decode } from "cbor-x";
import { Script, Transaction } from "@radiant-core/radiantjs";
import type { Contract, Glyph } from "./types";
import { isRef, opcodeToNum, push4bytes, pushMinimal, reverseRef } from "./utils";
import { swapEndianness } from "@bitauth/libauth";
import { fetchRef, fetchTx } from "./client";
import { 
  GlyphProtocol, 
  DmintAlgorithmId, 
  DaaModeId,
  GLYPH_VERSION,
} from "./types";

export const glyphHex = "676c79"; // gly
export const glyphMagic = Buffer.from("gly", "ascii");

/**
 * Glyph v2 envelope flags
 */
export const EnvelopeFlags = {
  HAS_CONTENT_ROOT: 1 << 0,
  HAS_CONTROLLER: 1 << 1,
  HAS_PROFILE_HINT: 1 << 2,
  IS_REVEAL: 1 << 7,
} as const;

/**
 * Check if protocols indicate a v2 dMint token
 */
export function isDmintToken(protocols: number[]): boolean {
  return protocols.includes(GlyphProtocol.GLYPH_FT) && 
         protocols.includes(GlyphProtocol.GLYPH_DMINT);
}

/**
 * Get algorithm name from ID
 */
export function getAlgorithmName(algoId: number): string {
  switch (algoId) {
    case DmintAlgorithmId.SHA256D: return 'SHA256d';
    case DmintAlgorithmId.BLAKE3: return 'Blake3';
    case DmintAlgorithmId.K12: return 'KangarooTwelve';
    case DmintAlgorithmId.ARGON2ID_LIGHT: return 'Argon2id-Light';
    case DmintAlgorithmId.RANDOMX_LIGHT: return 'RandomX-Light';
    default: return 'Unknown';
  }
}

/**
 * Get DAA mode name from ID
 */
export function getDaaModeName(modeId: number): string {
  switch (modeId) {
    case DaaModeId.FIXED: return 'Fixed';
    case DaaModeId.EPOCH: return 'Epoch';
    case DaaModeId.ASERT: return 'ASERT';
    case DaaModeId.LWMA: return 'LWMA';
    case DaaModeId.SCHEDULE: return 'Schedule';
    default: return 'Unknown';
  }
}

/**
 * Parse v2 dMint metadata
 */
export function parseDmintMetadata(payload: Record<string, unknown>): {
  algorithm: number;
  daaMode: number;
  maxSupply?: bigint;
  reward?: bigint;
  difficulty?: bigint;
} | undefined {
  const dmint = payload.dmint as Record<string, unknown> | undefined;
  if (!dmint) return undefined;

  const toBigIntValue = (value: unknown): bigint | undefined => {
    if (typeof value === "bigint") return value;
    if (typeof value === "number" && Number.isFinite(value)) return BigInt(value);
    return undefined;
  };

  const daa = dmint.daa as Record<string, unknown> | number | undefined;
  const daaMode =
    typeof daa === "number"
      ? daa
      : typeof daa === "object" && daa !== null && typeof daa.mode === "number"
        ? daa.mode
        : DaaModeId.FIXED;

  return {
    algorithm: typeof dmint.algo === 'number' ? dmint.algo : DmintAlgorithmId.SHA256D,
    daaMode,
    maxSupply: toBigIntValue(dmint.maxHeight ?? dmint.max),
    reward: toBigIntValue(dmint.reward),
    difficulty: toBigIntValue(dmint.diff),
  };
}

/**
 * Check if this is a v2 glyph based on version field
 */
export function isGlyphV2(payload: Record<string, unknown>): boolean {
  return payload.v === GLYPH_VERSION;
}

export function decodeGlyph(script: Script): undefined | Glyph {
  let result: { payload: { [key: string]: unknown } } = {
    payload: {},
  };
  (
    script.chunks as {
      opcodenum: number;
      buf?: Uint8Array;
    }[]
  ).some(({ opcodenum, buf }, index) => {
    if (
      !buf ||
      opcodenum !== 3 ||
      Buffer.from(buf).toString("hex") !== glyphHex ||
      script.chunks.length <= index + 1
    ) {
      return false;
    }

    const payload = script.chunks[index + 1];
    const decoded = decode(Buffer.from(payload.buf));
    if (!decoded) {
      return false;
    }

    result = {
      payload: decoded,
    };
    return true;
  });

  if (
    !Array.isArray(result.payload.p) ||
    !result.payload.p.includes(1) ||
    !result.payload.p.includes(4)
  )
    return undefined;

  // Separate meta and file fields from root object
  const { meta, files } = Object.entries(result.payload).reduce<{
    meta: [string, unknown][];
    files: [string, unknown][];
  }>(
    (a, [k, v]) => {
      const embed = v as { t: string; b: Uint8Array };
      const isEmbed =
        typeof embed.t === "string" && embed.b instanceof Uint8Array;
      if (isEmbed) {
        a.files.push([k, v]);
      } else {
        a.meta.push([k, v]);
      }
      return a;
    },
    { meta: [], files: [] }
  );

  return {
    payload: {
      ...Object.fromEntries(meta),
    },
    files: Object.fromEntries(files) as {
      [key: string]: { t: string; b: Uint8Array };
    },
  };
}

export async function fetchToken(contractRef: string) {
  if (!isRef(contractRef)) {
    console.debug("Not a ref");
    return;
  }

  console.debug(`Fetching ${contractRef}`);
  const refLe = reverseRef(contractRef);

  const refTxids = await fetchRef(contractRef);
  if (!refTxids.length) {
    console.debug("Ref not found:", contractRef);
    return;
  }

  const revealTxid = refTxids[0].tx_hash;
  const revealTx = await fetchTx(revealTxid, false);
  const revealParams = await parseContractTx(revealTx, refLe);

  if (!revealParams || revealParams.state === "burn") {
    return;
  }

  // TODO pick random location that still has tokens available

  const locTxid = refTxids[1].tx_hash;
  const fresh = revealTxid === locTxid;
  const locTx = fresh ? revealTx : await fetchTx(locTxid, true);
  const locParams = fresh ? revealParams : await parseContractTx(locTx, refLe);
  if (!locParams) {
    return;
  }
  const currentParams =
    locParams.state === "burn"
      ? {
          ...revealParams.params,
          height: revealParams.params.maxHeight,
          message: locParams.params.message,
        }
      : locParams.params;

  // Find token script in the reveal tx
  const tokenRefBE = swapEndianness(currentParams.tokenRef);
  const refTxId = tokenRefBE.substring(8);
  const refVout = parseInt(tokenRefBE.substring(0, 8), 10);
  const revealIndex = revealTx.inputs.findIndex(
    (input) =>
      input.prevTxId.toString("hex") === refTxId &&
      input.outputIndex === refVout
  );
  const script = revealIndex >= 0 && revealTx.inputs[revealIndex].script;

  if (!script) {
    console.debug("Glyph script not found");
    return;
  }

  const glyph = decodeGlyph(script);

  if (!glyph) {
    console.debug("Invalid glyph script");
    return;
  }

  return { glyph, contract: currentParams };
}

export function dMintScript({
  height,
  contractRef,
  tokenRef,
  maxHeight,
  reward,
  target,
}: Contract) {
  // V1 legacy fallback — only used when codeScript is unavailable
  return `${push4bytes(
    Number(height)
  )}d8${contractRef}d0${tokenRef}${pushMinimal(maxHeight)}${pushMinimal(
    reward
  )}${pushMinimal(
    target
  )}bd5175c0c855797ea8597959797ea87e5a7a7eaabc01147f77587f040000000088817600a269a269577ae500a069567ae600a06901d053797e0cdec0e9aa76e378e4a269e69d7eaa76e47b9d547a818b76537a9c537ade789181547ae6939d635279cd01d853797e016a7e886778de519d547854807ec0eb557f777e5379ec78885379eac0e9885379cc519d75686d7551`;
}

export function burnScript(ref: string) {
  return `d8${ref}6a`;
}

// V1 Part B: PoW extraction + target comparison + output validation (no DAA).
// Exported so blockchain.ts can branch on V1-vs-V2 by codescript signature
// (e.g. shouldIncludeOutputIndexInUnlockingScript needs to omit the OP_0
// outputIndex push on V1 to avoid leaving the stack unclean).
export const V1_BYTECODE_PART_B =
  "bc01147f77587f040000000088817600a269a269577ae500a069567ae600a06901d053797e0cdec0e9aa76e378e4a269e69d7eaa76e47b9d547a818b76537a9c537ade789181547ae6939d635279cd01d853797e016a7e886778de519d547854807ec0eb557f777e5379ec78885379eac0e9885379cc519d75686d7551";

// V2 Part B.1: PoW hash extraction (shared)
const V2_BYTECODE_PART_B1 = "bc01147f77587f040000000088817600a269";
// V2 Part B.2: Target comparison with preservation
const V2_BYTECODE_PART_B2 = "51797ca269";
// V2 Part B.4 (post-2026-05-26 redesign): TOALTSTACK newTarget + 4×OP_DROP.
// Preserves DAA-computed newTarget on the alt stack so PartC can splice it
// into the next state. See b3t-forensics/V2_CONTRACT_AUDIT_REMEDIATION.md §§7-8.
const V2_BYTECODE_PART_B4 = "6b75757575";

// V2 PartC is now deploy-parameterized (it embeds items 2-8 of the state as a
// literal blob, and uses a runtime MINIMAL_PUSH primitive for height/target).
// We can no longer match PartC against a fixed constant; instead we match
// against the constant suffix that follows the variable middle.
//
// The suffix is: continuation-state EQUALVERIFY chain → codescript continuity
// EQUALVERIFY → output value == reward NUMEQUALVERIFY → ENDIF 2DROP DROP 1.
// 21 bytes (42 hex chars).
const V2_BYTECODE_PART_C_SUFFIX =
  "5379ec78885379eac0e9885379cc519d75686d7551";

// Distinctive 21-byte signature of the MINIMAL_PUSH primitive (PartC subroutine).
// PartC inlines MINIMAL_PUSH exactly twice — once for newHeight, once for the
// alt-stack newTarget. Presence of this signature is the strongest marker
// that the code script is a post-redesign V2 dMint.
const MINIMAL_PUSH_SIGNATURE =
  "76009c637501006776" + "60" + "a16301509351806782" + "7c7e6868";

export function parseDmintScript(script: string): string {
  const isDmintCodeScript = (codeScript: string): boolean => {
    const normalized = codeScript.toLowerCase();
    // Accept three Part A prefixes corresponding to the wallet's evolution:
    //   c0c8     — fixed format (Photonic-Wallet 4060ac1): OP_INPUTINDEX
    //              OP_OUTPOINTTXHASH directly; UNARY c8 consumes the input
    //              index that c0 pushes.
    //   5175c8   — broken format (Photonic-Wallet 5d39971): OP_1 OP_DROP
    //              OP_OUTPOINTTXHASH; the OP_1/OP_DROP no-op leaves
    //              target on the stack and c8 consumes it as an input
    //              index, causing SCRIPT_ERR_INVALID_TX_INPUT_INDEX. The
    //              contracts that have this prefix are PERMANENTLY
    //              UN-MINEABLE, but we still parse them so the miner can
    //              identify the contract and surface a clear error.
    //   5175c0c8 — original pre-5d39971 format; equivalent to c0c8 with a
    //              spurious OP_1 OP_DROP prefix that's a true no-op here
    //              (c0 pushes after the drop, so the index value is the
    //              one OP_INPUTINDEX produces, not target).
    if (
      !normalized.startsWith("c0c8") &&
      !normalized.startsWith("5175c8") &&
      !normalized.startsWith("5175c0c8")
    )
      return false;
    if (!/7a7e(?:aa|ee|ef)/.test(normalized)) return false;

    // V1: ends with V1_BYTECODE_PART_B
    if (normalized.endsWith(V1_BYTECODE_PART_B)) return true;

    // V2 (post-2026-05-26 redesign): the launch shape. PartB1+PartB2 are
    // unchanged from the pre-redesign V2, PartB4 is `6b75757575` (TOALTSTACK
    // + 4×DROP). PartC is variable-length but always ends in
    // V2_BYTECODE_PART_C_SUFFIX and contains MINIMAL_PUSH_SIGNATURE exactly
    // twice. We don't try to parse pre-redesign V2/V3 deploys (B3T2, K12T,
    // DEEZ, apple, VRT, etc.) — those were test tokens and considered
    // disposable.
    const hasV2PartB =
      normalized.includes(V2_BYTECODE_PART_B1 + V2_BYTECODE_PART_B2);
    const hasNewPartB4 = normalized.includes(V2_BYTECODE_PART_B4);
    const endsWithPartCSuffix = normalized.endsWith(V2_BYTECODE_PART_C_SUFFIX);
    const minimalPushOccurrences =
      normalized.split(MINIMAL_PUSH_SIGNATURE).length - 1;
    if (
      hasV2PartB &&
      hasNewPartB4 &&
      endsWithPartCSuffix &&
      minimalPushOccurrences === 2
    ) {
      return true;
    }

    return false;
  };

  const normalizedScript = script.toLowerCase();
  let searchStart = 0;

  while (searchStart < normalizedScript.length) {
    // Find the next occurrence of any known Part A separator. The wallet
    // evolved through three formats — see isDmintCodeScript above. Pick
    // the earliest match so we don't skip a valid separator just because
    // a later format string happens to appear inside data first.
    const candidates = ["bdc0c8", "bd5175c0c8", "bd5175c8"]
      .map((needle) => normalizedScript.indexOf(needle, searchStart))
      .filter((i) => i !== -1);
    if (candidates.length === 0) break;
    const index = Math.min(...candidates);

    const stateScript = normalizedScript.substring(0, index);
    const codeScript = normalizedScript.substring(index + 2);
    if (isDmintCodeScript(codeScript)) {
      return stateScript;
    }

    searchStart = index + 2;
  }

  return "";
}

function mapDaaModeId(modeId: number): Contract["daaMode"] | undefined {
  switch (modeId) {
    case DaaModeId.FIXED: return "fixed";
    case DaaModeId.EPOCH: return "epoch";
    case DaaModeId.ASERT: return "asert";
    case DaaModeId.LWMA: return "lwma";
    case DaaModeId.SCHEDULE: return "schedule";
    default: return;
  }
}

/**
 * Decode a single minimal push at `pos` in a hex string. Returns the decoded
 * value as a BigInt and the position immediately after the push, or undefined
 * if the bytes there are not a valid minimal push of a script number.
 *
 * Used to extract deploy-time DAA parameters baked into the codescript
 * (e.g. ASERT's halfLife at `c552799453795379 94 <push> 96`), which the
 * miner needs to mirror the on-chain DAA computation exactly. Without this,
 * the miner uses the fallback (240 for halfLife) and the next-state target push
 * diverges from what PartC reconstructs → state-script OP_EQUALVERIFY fails.
 */
function decodePushAt(hex: string, pos: number): { value: bigint; nextPos: number } | undefined {
  if (pos >= hex.length) return undefined;
  const op = parseInt(hex.slice(pos, pos + 2), 16);
  if (Number.isNaN(op)) return undefined;

  // OP_0 → 0
  if (op === 0x00) return { value: 0n, nextPos: pos + 2 };
  // OP_1NEGATE → -1
  if (op === 0x4f) return { value: -1n, nextPos: pos + 2 };
  // OP_1..OP_16 → 1..16
  if (op >= 0x51 && op <= 0x60) return { value: BigInt(op - 0x50), nextPos: pos + 2 };
  // Direct push of L bytes (1..75)
  if (op >= 0x01 && op <= 0x4b) {
    const dataHex = hex.slice(pos + 2, pos + 2 + op * 2);
    if (dataHex.length !== op * 2) return undefined;
    try {
      const bytes = Buffer.from(dataHex, "hex");
      // Decode as little-endian sign-magnitude script number.
      let n = 0n;
      const neg = (bytes[bytes.length - 1] & 0x80) !== 0;
      for (let i = 0; i < bytes.length; i++) {
        n |= BigInt(bytes[i]) << (8n * BigInt(i));
      }
      if (neg) {
        const mask = ~(0x80n << (8n * BigInt(bytes.length - 1)));
        n &= mask;
        n = -n;
      }
      return { value: n, nextPos: pos + 2 + op * 2 };
    } catch {
      return undefined;
    }
  }
  // PUSHDATA1 (0x4c) — supported, though DAA params should never need it.
  if (op === 0x4c) {
    const len = parseInt(hex.slice(pos + 2, pos + 4), 16);
    if (Number.isNaN(len)) return undefined;
    const dataHex = hex.slice(pos + 4, pos + 4 + len * 2);
    if (dataHex.length !== len * 2) return undefined;
    const bytes = Buffer.from(dataHex, "hex");
    let n = 0n;
    const neg = (bytes[bytes.length - 1] & 0x80) !== 0;
    for (let i = 0; i < bytes.length; i++) {
      n |= BigInt(bytes[i]) << (8n * BigInt(i));
    }
    if (neg) {
      const mask = ~(0x80n << (8n * BigInt(bytes.length - 1)));
      n &= mask;
      n = -n;
    }
    return { value: n, nextPos: pos + 4 + len * 2 };
  }
  return undefined;
}

/**
 * Extract the DAA-mode-specific parameters that the wallet baked into the
 * codescript at deploy time. Mirrors the bytecode emitted by Photonic-Wallet
 * `buildAsertDaaBytecode` / `buildEpochDaaBytecode` etc., reading back the
 * exact constants the on-chain DAA will use during the spend.
 *
 * Returns the params object the miner should put on `contract.daaParams` so
 * that `computeAsertTarget` / `computeEpochTarget` produce a newTarget byte-
 * identical to what PartC reconstructs from `OP_FROMALTSTACK + MINIMAL_PUSH`.
 *
 * Pre-2026-05-27 the miner left `daaParams = undefined`, falling back to the
 * the fallback (halfLife=240 for ASERT). Any contract deployed with a
 * non-default halfLife would emit a mismatched next-state target push and
 * fail the PartC state-script OP_EQUALVERIFY. See bug #4 of the V2-launch
 * remediation.
 */
export function extractDaaParamsFromCodeScript(
  codeScript: string,
  daaMode: Contract["daaMode"],
): Record<string, unknown> | undefined {
  if (!daaMode || daaMode === "fixed") return undefined;
  const lower = codeScript.toLowerCase();

  if (daaMode === "asert") {
    // Common prefix (both ASERT versions): c5 5279 94 5379 94 → excess on stack.
    //   c5      OP_TXLOCKTIME
    //   5279    OP_2 OP_PICK     → lastTime
    //   94      OP_SUB            → timeDelta
    //   5379    OP_3 OP_PICK     → targetTime
    //   94      OP_SUB            → excess
    //
    // Then the two versions diverge:
    //   LEGACY (v1, integer power-of-2 stepper, pre-2026-06-19):
    //       <halfLifePush> 96(DIV)                 → drift
    //   V2 (fractional fixed-point):
    //       03000001(push RADIX=65536) 95(MUL) <halfLifePush> 96(DIV)  → driftFp
    // The "03000001 95" signature (RADIX push + OP_MUL) uniquely identifies v2;
    // the miner must use the matching computeAsert(V2)Target or PartC rejects.
    const prefix = "c5" + "5279" + "94" + "5379" + "94";
    const idx = lower.indexOf(prefix);
    if (idx < 0) return undefined;
    let pushStart = idx + prefix.length;
    let asertVersion = 1;
    // v2 signature: RADIX push (03000001) + OP_MUL (95) before the halfLife div.
    if (lower.slice(pushStart, pushStart + 10) === "03000001" + "95") {
      asertVersion = 2;
      pushStart += 10; // skip "03000001" (8 hex) + "95" (2 hex)
    }
    const decoded = decodePushAt(lower, pushStart);
    if (!decoded) return undefined;
    // Sanity: the byte immediately after the halfLife push must be OP_DIV (0x96).
    if (lower.slice(decoded.nextPos, decoded.nextPos + 2) !== "96") {
      return undefined;
    }
    if (decoded.value <= 0n) return undefined;
    return { halfLife: Number(decoded.value), asertVersion };
  }

  if (daaMode === "lwma") {
    // LWMA has no deploy-time constants beyond targetTime, which already
    // lives in the state script. Nothing to extract.
    return undefined;
  }

  if (daaMode === "epoch") {
    // EPOCH prefix from buildEpochDaaBytecode:
    //   5979 <epochLengthPush> 97 (MOD) ... then later N×OP_2MUL (8d) for shift.
    // We only need epochLength + maxAdjustmentLog2 for the miner's computation.
    const epochPrefix = "5979"; // OP_9 OP_PICK height
    const idx = lower.indexOf(epochPrefix);
    if (idx < 0) return undefined;
    const epochLenStart = idx + epochPrefix.length;
    const epochLen = decodePushAt(lower, epochLenStart);
    if (!epochLen) return undefined;
    if (lower.slice(epochLen.nextPos, epochLen.nextPos + 2) !== "97") return undefined;
    if (epochLen.value <= 0n) return undefined;
    // maxAdjustmentLog2 = count of 0x8d (OP_2MUL) in the epoch block. The
    // bytecode emits exactly N copies for the upper-clamp shift.
    const epochBody = lower.slice(epochLen.nextPos);
    // Count contiguous 8d runs — only the upper-clamp uses 8d, so the count
    // equals N. (Lower-clamp uses 0x8e OP_2DIV.)
    const mulMatches = epochBody.match(/8d/g) ?? [];
    const log2 = mulMatches.length > 0 && mulMatches.length <= 4 ? mulMatches.length : 2;
    return {
      epochLength: Number(epochLen.value),
      maxAdjustmentLog2: log2,
    };
  }

  if (daaMode === "schedule") {
    // SCHEDULE bytecode is a nested IF/ELSE chain. Reconstructing the full
    // schedule from bytecode is doable but non-trivial; leave as a TODO.
    // For now the miner falls back to oldTarget for SCHEDULE if the schedule
    // is unknown — which matches the bytecode's "no boundary crossed" branch.
    return undefined;
  }

  return undefined;
}

export function parseBurnScript(script: string): string {
  const pattern = /^d8([0-9a-f]{64}[0-9]{8})6a$/;
  const [, ref] = script.match(pattern) || [];
  return ref;
}

export function parseMessageScript(script: string): string {
  const pattern = /^6a036d7367(.*)$/;
  const [, msg] = script.match(pattern) || [];
  if (!msg) return "";

  const chunks = new Script(msg).chunks as {
    opcodenum: number;
    buf?: Uint8Array;
  }[];

  if (chunks.length === 0 || !chunks[0].buf || chunks[0].buf.byteLength === 0) {
    return "";
  }

  return new TextDecoder().decode(chunks[0].buf);
}

export async function parseContractTx(tx: Transaction, ref: string) {
  const stateScripts: [number, string, string][] = [];
  const burns: string[] = [];
  const messages: string[] = [];

  tx.outputs.forEach((o, i) => {
    const hex = o.script.toHex();
    const dmint = parseDmintScript(hex);
    if (dmint) {
      const codeScript = hex.substring(dmint.length + 2);
      return stateScripts.push([i, dmint, codeScript]);
    }

    const burn = parseBurnScript(hex);
    if (burn) {
      if (burn === ref) {
        burns.push(burn);
      }
      return;
    }

    const msg = parseMessageScript(hex);
    if (msg) {
      // Truncate messages to 80 characters
      messages.push(msg.substring(0, 80));
    }
  });

  const message = messages[0] || "";

  // State script parsing:
  // V1: height | contractRef | tokenRef | maxHeight | reward | target (6 items)
  // V2: height | contractRef | tokenRef | maxHeight | reward | algoId | daaMode | targetTime | lastTime | target (10 items)
  const contracts = stateScripts
    .map(([outputIndex, script, codeScript]) => {
      const opcodes = Script.fromHex(script).toASM().split(" ");
      const [op1, contractRef] = opcodes.splice(1, 2);
      const [op2, tokenRef] = opcodes.splice(1, 2);

      if (
        op1 !== "OP_PUSHINPUTREFSINGLETON" ||
        op2 !== "OP_PUSHINPUTREF" ||
        contractRef !== ref
      ) {
        return;
      }

      const numbers = opcodes.map(opcodeToNum).filter((v) => v !== false) as bigint[];
      if (numbers.length < 4) {
        return;
      }

      let height: bigint;
      let maxHeight: bigint;
      let reward: bigint;
      let target: bigint;
      let algoId: bigint | undefined;
      let lastTime: bigint | undefined;
      let targetTime: bigint | undefined;
      let daaMode: Contract["daaMode"];
      let daaParams: Record<string, unknown> | undefined;

      // Detect V2 format: 8+ numeric items where items[3]=algoId(0-4) and [4]=daaMode(0-4)
      const isV2 = numbers.length >= 8 &&
        numbers[3] >= 0n && numbers[3] <= 4n &&
        numbers[4] >= 0n && numbers[4] <= 4n;

      if (isV2) {
        // V2 layout: height, maxHeight, reward, algoId, daaMode, targetTime, lastTime, target
        height = numbers[0];
        maxHeight = numbers[1];
        reward = numbers[2];
        algoId = numbers[3];
        daaMode = mapDaaModeId(Number(numbers[4]));
        targetTime = numbers[5];
        lastTime = numbers[6];
        target = numbers[7];
        // Extract deploy-time DAA params from the codescript so the miner's
        // local DAA computation matches the on-chain bytecode exactly. See
        // extractDaaParamsFromCodeScript above. Without this the miner falls
        // back to the fallback (halfLife=240 for ASERT, epochLength=2016
        // for EPOCH) and any non-default deploy produces a wrong newTarget
        // → state-script OP_EQUALVERIFY fails on the spend.
        daaParams = extractDaaParamsFromCodeScript(codeScript, daaMode);
      } else {
        // V1 layout: height, maxHeight, reward, target
        height = numbers[0];
        maxHeight = numbers[1];
        reward = numbers[2];
        target = numbers[3];
      }

      return {
        state: "active",
        params: {
          location: tx.id,
          outputIndex,
          height,
          contractRef,
          tokenRef,
          maxHeight,
          reward,
          target,
          algoId,
          lastTime,
          targetTime,
          daaMode,
          daaParams,
          script,
          codeScript,
          message,
        },
      };
    })
    .filter(Boolean) as { state: "active"; params: Contract }[];

  if (!contracts.length) {
    if (burns.length) {
      return {
        state: "burn" as const,
        ref,
        params: { message },
      };
    }
    console.debug("dmint contract not found");
    return;
  }

  return contracts[0];
}
