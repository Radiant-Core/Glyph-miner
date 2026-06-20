import { Networks } from "@radiant-core/radiantjs";

/**
 * Network selection for the miner. Mainnet is ALWAYS the default. Regtest /
 * testnet are opt-in and can be turned on in two ways:
 *
 *   1. The Settings UI ("Network" selector), which persists the choice to
 *      localStorage. This is the ONLY way to enable a non-mainnet network in a
 *      production build (e.g. glyph-miner.com).
 *   2. A build-time `VITE_NETWORK` env var, honored ONLY during `vite dev`.
 *      This keeps the local regtest workflow convenient:
 *
 *        VITE_NETWORK=regtest VITE_ELECTRUM=ws://localhost:50020 npm run dev
 *
 *      (or a `.env.development.local` file, which Vite loads in dev mode only).
 *
 * The env var is intentionally ignored outside dev so a stray `.env.local` can
 * never bake a non-mainnet default — pointed at a loopback indexer — into a
 * shipped build again. radiantjs `regtest` uses the same address params as
 * `testnet` (P2PKH 0x6f, WIF 0xef), distinct from mainnet (0x00 / 0x80).
 */
export type NetworkName = "mainnet" | "testnet" | "regtest";

/** localStorage key holding the Settings network override. */
export const NETWORK_STORAGE_KEY = "network";

function isNetworkName(v: string | null | undefined): v is NetworkName {
  return v === "mainnet" || v === "testnet" || v === "regtest";
}

/** Runtime override set via Settings. Wins over the env var so the in-app
 *  choice always sticks. Wrapped in try/catch for environments without
 *  localStorage (SSR / privacy mode). */
function readStoredNetwork(): NetworkName | null {
  try {
    const v = localStorage.getItem(NETWORK_STORAGE_KEY)?.trim().toLowerCase();
    return isNetworkName(v) ? v : null;
  } catch {
    return null;
  }
}

/** Build-time override, honored ONLY in `vite dev` (import.meta.env.DEV). A
 *  production build always returns null here, so an env file can't ship a
 *  non-mainnet default. */
function readEnvNetwork(): NetworkName | null {
  if (!import.meta.env.DEV) return null;
  const v = (import.meta.env.VITE_NETWORK as string | undefined)
    ?.trim()
    .toLowerCase();
  return isNetworkName(v) ? v : null;
}

function resolveNetworkName(): NetworkName {
  return readStoredNetwork() ?? readEnvNetwork() ?? "mainnet";
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

const LOOPBACK_HOST = /^(localhost|127(?:\.\d+){1,3}|\[?::1\]?|0\.0\.0\.0)$/i;

/** True if `url` points at a loopback host (localhost / 127.x / ::1). Used to
 *  scrub a regtest indexer (e.g. ws://localhost:50020) that a mis-built regtest
 *  bundle may have written into a mainnet user's stored server list. */
export function isLoopbackServer(url: string): boolean {
  try {
    return LOOPBACK_HOST.test(new URL(url.trim()).hostname);
  } catch {
    return false; // unparseable — leave it for the user to deal with
  }
}

/** Remove loopback endpoints from a server list (used on mainnet only). */
export function dropLoopbackServers(list: string[]): string[] {
  return list.filter((s) => !isLoopbackServer(s));
}
