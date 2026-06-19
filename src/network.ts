import { Networks } from "@radiant-core/radiantjs";

/**
 * Network selection for the miner. Defaults to mainnet; set VITE_NETWORK=regtest
 * (or testnet) at build/dev time to target a local Radiant regtest stack for
 * testing. radiantjs `regtest` uses the same address params as `testnet`
 * (P2PKH 0x6f, WIF 0xef), distinct from mainnet (0x00 / 0x80).
 *
 *   VITE_NETWORK=regtest VITE_ELECTRUM=ws://localhost:50020 npm run dev
 */
export type NetworkName = "mainnet" | "testnet" | "regtest";

function resolveNetworkName(): NetworkName {
  const v = (import.meta.env.VITE_NETWORK as string | undefined)
    ?.trim()
    .toLowerCase();
  return v === "regtest" || v === "testnet" ? (v as NetworkName) : "mainnet";
}

export const networkName: NetworkName = resolveNetworkName();
export const isMainnet = networkName === "mainnet";

/** radiantjs network object for key/address derivation. radiantjs ships no separate
 *  `regtest` network — regtest reuses testnet's address params (P2PKH 0x6f / WIF 0xef),
 *  so any non-mainnet name maps to `Networks.testnet`. Typed as the radiantjs
 *  `Networks.Network` the PrivateKey/Address constructors expect. */
export const network: Networks.Network =
  networkName === "mainnet" ? Networks.mainnet : Networks.testnet;

/**
 * Default Electrum server(s) for non-mainnet. Mainnet keeps the curated list in
 * initWallet.ts (returns null here). Non-mainnet uses VITE_ELECTRUM if provided,
 * else a local regtest indexer over plain ws (allowed for loopback by the wallet
 * server validation). Plain ws avoids the self-signed-cert prompt that wss would
 * trigger for a local dev indexer.
 */
export const networkDefaultServers: string[] | null = isMainnet
  ? null
  : [
      (import.meta.env.VITE_ELECTRUM as string | undefined)?.trim() ||
        "ws://localhost:50020",
    ];
