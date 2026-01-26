import { PrivateKey } from "@radiantblockchain/radiantjs";

/**
 * Glyph v2 Token Standard Types
 * Reference: https://github.com/Radiant-Core/Glyph-Token-Standards
 */

// Protocol version
export const GLYPH_VERSION = 2;

// Protocol IDs per Glyph v2 spec
export const GlyphProtocol = {
  GLYPH_FT: 1,
  GLYPH_NFT: 2,
  GLYPH_DAT: 3,
  GLYPH_DMINT: 4,
  GLYPH_MUT: 5,
  GLYPH_BURN: 6,
  GLYPH_CONTAINER: 7,
  GLYPH_ENCRYPTED: 8,
  GLYPH_TIMELOCK: 9,
  GLYPH_AUTHORITY: 10,
  GLYPH_WAVE: 11,
} as const;

export type GlyphProtocolId = typeof GlyphProtocol[keyof typeof GlyphProtocol];

// Algorithm IDs per Glyph v2 dMint spec (REP-3010)
export const DmintAlgorithmId = {
  SHA256D: 0x00,
  BLAKE3: 0x01,
  K12: 0x02,
  ARGON2ID_LIGHT: 0x03,
  RANDOMX_LIGHT: 0x04,
} as const;

export type AlgorithmId = 'sha256d' | 'blake3' | 'k12' | 'argon2light' | 'randomx-light';

// DAA Mode IDs per Glyph v2 dMint spec
export const DaaModeId = {
  FIXED: 0x00,
  EPOCH: 0x01,
  ASERT: 0x02,
  LWMA: 0x03,
  SCHEDULE: 0x04,
} as const;

export type DAAMode = 'fixed' | 'epoch' | 'asert' | 'lwma' | 'schedule';

export type Contract = {
  location: string;
  outputIndex: number;
  height: bigint;
  contractRef: string;
  tokenRef: string;
  maxHeight: bigint;
  reward: bigint;
  target: bigint;
  script: string;
  message: string;
  // Enhanced contract fields
  algorithm?: AlgorithmId;
  daaMode?: DAAMode;
  daaParams?: any;
};

export type ContractGroup = {
  glyph: Glyph;
  summary: TokenSummary;
  contracts: Contract[];
};

export type TokenSummary = {
  numContracts: number;
  totalSupply: bigint;
  mintedSupply: bigint;
};

export type GlyphPayload = {
  in?: Uint8Array[];
  by?: Uint8Array[];
  [key: string]: unknown;
};

export type Glyph = {
  payload: GlyphPayload;
  files: { [key: string]: { t: string; b: Uint8Array } };
};

export type Token = {
  contract: Contract;
  glyph: Glyph;
};

export type Work = {
  txid: Uint8Array;
  contractRef: Uint8Array;
  inputScript: Uint8Array;
  outputScript: Uint8Array;
  target: bigint;
  algorithm?: AlgorithmId;
};

export type Wallet = {
  mnemonic: string;
  privKey: PrivateKey;
  address: string;
};

export type Utxo = {
  tx_hash: string;
  tx_pos: number;
  value: number;
  refs?: { ref: string; type: "single" | "normal" }[];
};

export type Message = {
  id: string;
  date: string;
} & (
  | {
      type: "found";
      nonce: string;
    }
  | {
      type: "accept";
      nonce: string;
      txid: string;
      msg: string;
    }
  | {
      type: "reject";
      nonce: string;
      reason?: string;
    }
  | {
      type: "general";
      msg: string;
    }
  | {
      type: "new-location";
      txid: string;
      msg: string;
    }
  | {
      type: "loaded" | "minted-out";
      ref: string;
      msg: string;
    }
  | {
      type: "not-found";
      ref: string;
    }
  | {
      type: "mint-time";
      seconds: number;
    }
  | {
      type: "start" | "stop";
    }
);
