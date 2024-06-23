import { PrivateKey } from "@radiantblockchain/radiantjs";

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
