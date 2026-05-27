import { Buffer } from "buffer";
import { Networks, PrivateKey } from "@radiant-core/radiantjs";
import { generateMnemonic, mnemonicToSeedSync } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { HDKey } from "@scure/bip32";
import { Wallet } from "./types";

export const RADIANT_DERIVATION_PATH = "m/44'/512'/0'/0/0";
export const LEGACY_DERIVATION_PATH = "m/44'/0'/0'/0/0";

export type DerivationType = "radiant" | "legacy";

const DERIVATION_TYPE_KEY = "derivationType";

function readStoredDerivationType(): DerivationType | null {
  const v = window.localStorage.getItem(DERIVATION_TYPE_KEY);
  return v === "radiant" || v === "legacy" ? v : null;
}

function pathFor(type: DerivationType): string {
  return type === "legacy" ? LEGACY_DERIVATION_PATH : RADIANT_DERIVATION_PATH;
}

export function createWallet(type: DerivationType = "radiant"): Wallet | undefined {
  const mnemonic = generateMnemonic(wordlist);
  window.localStorage.setItem("mnemonic", mnemonic);
  window.localStorage.setItem(DERIVATION_TYPE_KEY, type);
  return createKeys(mnemonic, type);
}

export function openWallet(): Wallet | undefined {
  const mnemonic = window.localStorage.getItem("mnemonic");
  if (!mnemonic) {
    return undefined;
  }

  // Wallets created before the v3.0.0 SLIP-0044 change have no stored
  // derivation type; their keys were derived from the legacy path, so keep
  // using it to preserve addresses and pin the value going forward.
  let type = readStoredDerivationType();
  if (!type) {
    type = "legacy";
    window.localStorage.setItem(DERIVATION_TYPE_KEY, type);
  }
  return createKeys(mnemonic, type);
}

function createKeys(mnemonic: string, type: DerivationType): Wallet | undefined {
  const seed = mnemonicToSeedSync(mnemonic);
  const hdKey = HDKey.fromMasterSeed(seed);
  const key = Buffer.from(
    hdKey.derive(pathFor(type)).privateKey as Uint8Array
  ).toString("hex");
  if (!key) return;
  const privKey = new PrivateKey(key, Networks.mainnet);
  const address = privKey?.toAddress().toString() as string;

  return { privKey, address, mnemonic };
}
