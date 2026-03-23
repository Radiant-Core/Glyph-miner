/**
 * dMint Contracts API Client
 * 
 * Fetches mineable dMint contracts from RXinDexer via Electrum protocol.
 * Provides both simple format (backward compatible) and extended format
 * with profitability sorting and algorithm filtering.
 */

import { client } from "./client";

let getContractSupported: boolean | null = null;
let getContractsSupported: boolean | null = null;
let warnedGetContractUnsupported = false;
let warnedGetContractsUnsupported = false;
const extendedContractsCache = new Map<string, ExtendedContract>();

function normalizeRef(ref: string): string {
  return ref.toLowerCase().replace(/[^0-9a-f]/g, "");
}

function isUnsupportedMethodError(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes("unknown method") || m.includes("not supported") || m.includes("method not found");
}

function indexExtendedContracts(contracts: ExtendedContract[]): void {
  extendedContractsCache.clear();
  for (const c of contracts) {
    extendedContractsCache.set(normalizeRef(c.ref), c);
  }
}

function getFromExtendedCache(ref: string): ExtendedContract | null {
  return extendedContractsCache.get(normalizeRef(ref)) ?? null;
}

// Extended contract info from RXinDexer
export interface ExtendedContract {
  ref: string;
  outputs: number;
  ticker?: string;
  name?: string;
  algorithm: number;
  difficulty: number;
  reward: number;
  percent_mined: number;
  active: boolean;
  deploy_height: number;
  daa_mode?: number;
  daa_mode_name?: string;
  icon_type?: string;
  icon_data?: string;
  icon_url?: string;
  total_supply?: number;
  mined_supply?: number;
}

export interface ExtendedContractsResponse {
  version: number;
  updated_at: string;
  updated_height: number;
  count: number;
  contracts: ExtendedContract[];
}

// Algorithm IDs aligned with Glyph dMint v2
export const DMINT_ALGORITHM = {
  SHA256D: 0x00,
  BLAKE3: 0x01,
  K12: 0x02,
} as const;

/**
 * Fetch contracts in simple format: [[ref, outputs], ...]
 * This is backward compatible with the static contracts.json format.
 */
export async function fetchContractsSimple(): Promise<[string, number][]> {
  try {
    const result = await client.request("dmint.get_contracts", "simple");
    
    // Handle error response
    if (result && typeof result === 'object' && 'error' in result) {
      console.warn("dMint API error:", (result as { error: string }).error);
      return [];
    }
    
    return result as [string, number][];
  } catch (error) {
    console.warn("Failed to fetch contracts from API:", error);
    return [];
  }
}

/**
 * Fetch contracts in extended format with full metadata.
 */
export async function fetchContractsExtended(): Promise<ExtendedContractsResponse | null> {
  if (getContractsSupported === false) {
    return null;
  }

  try {
    const result = await client.request("dmint.get_contracts", "extended");
    
    // Handle error response
    if (result && typeof result === 'object' && 'error' in result) {
      const error = (result as { error: string }).error;
      if (isUnsupportedMethodError(error)) {
        getContractsSupported = false;
        if (!warnedGetContractsUnsupported) {
          console.warn("dmint.get_contracts unsupported; extended RPC fallback disabled");
          warnedGetContractsUnsupported = true;
        }
        return null;
      }

      getContractsSupported = true;
      console.warn("dMint API error:", error);
      return null;
    }

    const response = result as ExtendedContractsResponse;
    getContractsSupported = true;
    if (Array.isArray(response.contracts)) {
      indexExtendedContracts(response.contracts);
    }

    return response;
  } catch (error) {
    const message = String((error as Error)?.message || error || "");
    if (isUnsupportedMethodError(message)) {
      getContractsSupported = false;
      if (!warnedGetContractsUnsupported) {
        console.warn("dmint.get_contracts unsupported; extended RPC fallback disabled");
        warnedGetContractsUnsupported = true;
      }
      return null;
    }

    getContractsSupported = true;
    console.warn("Failed to fetch extended contracts from API:", error);
    return null;
  }
}

/**
 * Fetch a single contract by ref.
 */
export async function fetchContract(ref: string): Promise<ExtendedContract | null> {
  // If we've already detected dmint.get_contract is unsupported on this server,
  // resolve from extended contracts cache and avoid repeat RPC errors.
  if (getContractSupported === false) {
    const cached = getFromExtendedCache(ref);
    if (cached) {
      return cached;
    }

    const extended = await fetchContractsExtended();
    if (extended?.contracts?.length) {
      return getFromExtendedCache(ref);
    }

    return null;
  }

  try {
    const result = await client.request("dmint.get_contract", ref);

    if (result && typeof result === 'object' && 'error' in result) {
      const error = (result as { error: string }).error;
      if (isUnsupportedMethodError(error)) {
        getContractSupported = false;
        if (!warnedGetContractUnsupported) {
          console.warn("dmint.get_contract unsupported; using extended contracts cache fallback");
          warnedGetContractUnsupported = true;
        }

        const cached = getFromExtendedCache(ref);
        if (cached) {
          return cached;
        }

        const extended = await fetchContractsExtended();
        if (extended?.contracts?.length) {
          return getFromExtendedCache(ref);
        }

        return null;
      }

      getContractSupported = true;
      console.warn("dMint API error:", error);
      return null;
    }

    getContractSupported = true;
    return result as ExtendedContract;
  } catch (error) {
    const message = String((error as Error)?.message || error || "");
    if (isUnsupportedMethodError(message)) {
      getContractSupported = false;
      if (!warnedGetContractUnsupported) {
        console.warn("dmint.get_contract unsupported; using extended contracts cache fallback");
        warnedGetContractUnsupported = true;
      }

      const cached = getFromExtendedCache(ref);
      if (cached) {
        return cached;
      }

      const extended = await fetchContractsExtended();
      if (extended?.contracts?.length) {
        return getFromExtendedCache(ref);
      }

      return null;
    }

    getContractSupported = true;
    console.warn("Failed to fetch contract from API:", error);
    return null;
  }
}

/**
 * Fetch contracts filtered by mining algorithm.
 */
export async function fetchContractsByAlgorithm(algorithm: number): Promise<ExtendedContract[]> {
  try {
    const result = await client.request("dmint.get_by_algorithm", algorithm);
    
    if (result && typeof result === 'object' && 'error' in result) {
      console.warn("dMint API error:", (result as { error: string }).error);
      return [];
    }
    
    return result as ExtendedContract[];
  } catch (error) {
    console.warn("Failed to fetch contracts by algorithm:", error);
    return [];
  }
}

/**
 * Fetch most profitable contracts sorted by reward/difficulty ratio.
 */
export async function fetchMostProfitable(limit: number = 10): Promise<ExtendedContract[]> {
  try {
    const result = await client.request("dmint.get_most_profitable", limit);
    
    if (result && typeof result === 'object' && 'error' in result) {
      console.warn("dMint API error:", (result as { error: string }).error);
      return [];
    }
    
    return result as ExtendedContract[];
  } catch (error) {
    console.warn("Failed to fetch most profitable contracts:", error);
    return [];
  }
}

/**
 * Check if the connected server supports the dMint API.
 * Returns true if the API is available.
 */
export async function isDmintApiAvailable(): Promise<boolean> {
  try {
    // Try a simple request - if it returns data or a proper error, API is available
    const result = await Promise.race([
      client.request("dmint.get_contracts", "simple"),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000))
    ]);
    
    // If we get an "unknown method" type error, API is not available
    if (result && typeof result === 'object' && 'error' in result) {
      const error = (result as { error: string }).error.toLowerCase();
      if (error.includes("unknown") || error.includes("not found") || error.includes("not supported")) {
        return false;
      }
    }
    
    return true;
  } catch {
    return false;
  }
}
