import { Buffer } from "buffer";
import { Networks, PrivateKey } from "@radiantblockchain/radiantjs";
import { generateMnemonic, mnemonicToSeedSync } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { HDKey } from "@scure/bip32";
import { Wallet } from "./types";

const derivationPath = "m/44'/0'/0'/0/0";

export function createWallet(): Wallet | undefined {
  const mnemonic = generateMnemonic(wordlist);
  window.localStorage.setItem("mnemonic", mnemonic);
  return createKeys(mnemonic);
}

export function openWallet(): Wallet | undefined {
  const mnemonic = window.localStorage.getItem("mnemonic");
  if (!mnemonic) {
    return undefined;
  }

  return createKeys(mnemonic);
}

function createKeys(mnemonic: string): Wallet | undefined {
  const seed = mnemonicToSeedSync(mnemonic);
  const hdKey = HDKey.fromMasterSeed(seed);
  const key = Buffer.from(
    hdKey.derive(derivationPath).privateKey as Uint8Array
  ).toString("hex");
  if (!key) return;
  const privKey = new PrivateKey(key, Networks.mainnet);
  const address = privKey?.toAddress().toString() as string;

  return { privKey, address, mnemonic };
}
