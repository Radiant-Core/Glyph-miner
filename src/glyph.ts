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

// V1 Part B: PoW extraction + target comparison + output validation (no DAA)
const V1_BYTECODE_PART_B =
  "bc01147f77587f040000000088817600a269a269577ae500a069567ae600a06901d053797e0cdec0e9aa76e378e4a269e69d7eaa76e47b9d547a818b76537a9c537ade789181547ae6939d635279cd01d853797e016a7e886778de519d547854807ec0eb557f777e5379ec78885379eac0e9885379cc519d75686d7551";

// V2 Part B.1: PoW hash extraction (shared)
const V2_BYTECODE_PART_B1 = "bc01147f77587f040000000088817600a269";
// V2 Part B.2: Target comparison with preservation
const V2_BYTECODE_PART_B2 = "51797ca269";
// V2 Part B.4: Stack cleanup (5x OP_DROP)
const V2_BYTECODE_PART_B4 = "7575757575";
// V2 Part C: Output validation (same as V1 Part C).
//
// Photonic-Wallet 7f19cbb dropped the leading `a269` (OP_GREATERTHANOREQUAL
// OP_VERIFY "maxHeight >= reward" sanity prefix) because it consumed mh and r
// that the V1-style continuation immediately needed for ROLL 7, causing every
// V2 contract deployed before that fix to stack-underflow at broadcast (rejected
// as SCRIPT_ERR_INVALID_STACK_OPERATION). The new (mineable) form is on top;
// the legacy (un-mineable) form is kept so the parser can still surface those
// contracts in the UI with the right error.
const V2_BYTECODE_PART_C =
  "577ae500a069567ae600a06901d053797e0cdec0e9aa76e378e4a269e69d7eaa76e47b9d547a818b76537a9c537ade789181547ae6939d635279cd01d853797e016a7e886778de519d547854807ec0eb557f777e5379ec78885379eac0e9885379cc519d75686d7551";
const V2_BYTECODE_PART_C_LEGACY_UNMINEABLE =
  "a269577ae500a069567ae600a06901d053797e0cdec0e9aa76e378e4a269e69d7eaa76e47b9d547a818b76537a9c537ade789181547ae6939d635279cd01d853797e016a7e886778de519d547854807ec0eb557f777e5379ec78885379eac0e9885379cc519d75686d7551";

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

    // V2: has B.1+B.2 after powHashOp, B.4 cleanup, and ends with Part C.
    // Accept both the fixed Part C and the legacy un-mineable form so the UI
    // can still display the older contracts even though they can't be mined.
    const hasV2PartB = normalized.includes(V2_BYTECODE_PART_B1 + V2_BYTECODE_PART_B2);
    const hasV2Cleanup = normalized.includes(V2_BYTECODE_PART_B4);
    const endsWithPartC =
      normalized.endsWith(V2_BYTECODE_PART_C) ||
      normalized.endsWith(V2_BYTECODE_PART_C_LEGACY_UNMINEABLE);
    if (hasV2PartB && hasV2Cleanup && endsWithPartC) return true;

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
      let daaParams: bigint[] | undefined;

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
