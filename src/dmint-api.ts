/**
 * dMint Contracts API Client
 * 
 * Fetches mineable dMint contracts from RXinDexer via Electrum protocol.
 * Provides both simple format (backward compatible) and extended format
 * with profitability sorting and algorithm filtering.
 */

import { client } from "./client";

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
}

export interface ExtendedContractsResponse {
  version: number;
  updated_at: string;
  updated_height: number;
  count: number;
  contracts: ExtendedContract[];
}

// Algorithm IDs matching RXinDexer
export const DMINT_ALGORITHM = {
  NONE: 0x00,
  SHA256D: 0x01,
  RADIANTHASH: 0x02,
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
  try {
    const result = await client.request("dmint.get_contracts", "extended");
    
    // Handle error response
    if (result && typeof result === 'object' && 'error' in result) {
      console.warn("dMint API error:", (result as { error: string }).error);
      return null;
    }
    
    return result as ExtendedContractsResponse;
  } catch (error) {
    console.warn("Failed to fetch extended contracts from API:", error);
    return null;
  }
}

/**
 * Fetch a single contract by ref.
 */
export async function fetchContract(ref: string): Promise<ExtendedContract | null> {
  try {
    const result = await client.request("dmint.get_contract", ref);
    
    if (result && typeof result === 'object' && 'error' in result) {
      console.warn("dMint API error:", (result as { error: string }).error);
      return null;
    }
    
    return result as ExtendedContract;
  } catch (error) {
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
