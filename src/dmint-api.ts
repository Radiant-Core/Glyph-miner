/**
 * dMint Contracts API Client
 * 
 * Fetches mineable dMint contracts from RXinDexer via REST API (primary) or Electrum protocol (fallback).
 * Uses dmint.get_contracts v2 request/response contract and maps to
 * local ExtendedContract shape for existing UI consumers.
 */

import { client } from "./client";
import { restApiUrl, contractsUrl } from "./signals";

let getContractSupported: boolean | null = null;
let getContractsSupported: boolean | null = null;
let warnedGetContractUnsupported = false;
let warnedGetContractsUnsupported = false;
const extendedContractsCache = new Map<string, ExtendedContract>();

function normalizeRef(ref: string | undefined | null): string {
  if (!ref) return "";
  const normalized = ref.toLowerCase().replace(/[^0-9a-f]/g, "");
  if (normalized.length <= 64) {
    return normalized;
  }

  const txid = normalized.substring(0, 64);
  const vout = Number.parseInt(normalized.substring(64), 16);
  if (!Number.isFinite(vout)) {
    return normalized;
  }

  return txid + vout.toString(16).padStart(8, "0");
}

function isUnsupportedMethodError(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes("unknown method") || m.includes("not supported") || m.includes("method not found");
}

function indexExtendedContracts(contracts: ExtendedContract[]): void {
  extendedContractsCache.clear();
  for (const c of contracts) {
    if (!c.ref) continue;
    extendedContractsCache.set(normalizeRef(c.ref), c);
  }
}

function getFromExtendedCache(ref: string): ExtendedContract | null {
  if (!ref) return null;
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
  burned?: boolean;
  deploy_height: number;
  daa_mode?: number;
  daa_mode_name?: string;
  icon_type?: string;
  icon_data?: string;
  icon_url?: string;
  total_supply?: number;
  mined_supply?: number;
}

export interface DmintV2TokenSummaryItem {
  token_ref: string;
  ticker?: string;
  name?: string;
  algorithm: { id: number; name?: string };
  daa_mode?: { id: number; name?: string };
  contracts?: {
    total?: number;
    mineable_remaining?: number | null;
    fully_mined?: number | null;
  };
  supply?: {
    total?: string;
    minted?: string;
    remaining?: string;
    unit?: string;
  };
  reward_per_mint?: string;
  target?: string;
  percent_mined?: number;
  deploy_height?: number;
  active?: boolean;
  is_fully_mined?: boolean;
  burned?: boolean;
  icon?: {
    type?: string | null;
    url?: string | null;
    data_hex?: string | null;
  };
}

export interface DmintV2ContractsRequest {
  version: 2;
  view: "token_summary";
  filters?: {
    status?: "mineable" | "finished" | "all";
    algorithm_ids?: number[];
  };
  sort?: {
    field?: "deploy_height" | "ticker" | "reward_per_mint" | "percent_mined" | "mineable_contracts_remaining" | "total_contracts";
    dir?: "asc" | "desc";
  };
  pagination?: {
    limit?: number;
    cursor?: string | null;
  };
}

export interface DmintV2ContractsResponse {
  version: 2;
  view: "token_summary";
  schema: string;
  generated_at: string;
  indexed_height: number;
  cursor_next?: string | null;
  count: number;
  total_estimate: number;
  items: DmintV2TokenSummaryItem[];
}

export interface ExtendedContractsResponse {
  version: number;
  updated_at: string;
  updated_height: number;
  count: number;
  contracts: ExtendedContract[];
}

function parseIntString(value: string | undefined): number {
  if (!value) return 0;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : 0;
}

function mapV2ItemToExtended(item: DmintV2TokenSummaryItem): ExtendedContract {
  const totalSupply = parseIntString(item.supply?.total);
  const minedSupply = parseIntString(item.supply?.minted);
  const percentMined =
    typeof item.percent_mined === "number"
      ? item.percent_mined
      : totalSupply > 0
        ? (minedSupply / totalSupply) * 100
        : 0;

  return {
    ref: item.token_ref,
    outputs: item.contracts?.total ?? 0,
    ticker: item.ticker,
    name: item.name,
    algorithm: item.algorithm?.id ?? 0,
    difficulty: parseIntString(item.target),
    reward: parseIntString(item.reward_per_mint),
    percent_mined: percentMined,
    active: item.active ?? !item.is_fully_mined,
    burned: item.burned,
    deploy_height: item.deploy_height ?? 0,
    daa_mode: item.daa_mode?.id ?? 0,
    daa_mode_name: item.daa_mode?.name,
    icon_type: item.icon?.type ?? undefined,
    icon_data: item.icon?.data_hex ?? undefined,
    icon_url: item.icon?.url ?? undefined,
    total_supply: totalSupply,
    mined_supply: minedSupply,
  };
}

function toExtendedResponse(result: unknown): ExtendedContractsResponse | null {
  if (!result || typeof result !== "object") {
    return null;
  }

  const candidate = result as Record<string, unknown>;

  if (Array.isArray(candidate.contracts)) {
    return candidate as unknown as ExtendedContractsResponse;
  }

  if (Array.isArray(candidate.items)) {
    const v2 = candidate as unknown as DmintV2ContractsResponse;
    return {
      version: 2,
      updated_at: v2.generated_at,
      updated_height: v2.indexed_height,
      count: v2.count,
      contracts: v2.items.map(mapV2ItemToExtended),
    };
  }

  return null;
}

// Algorithm IDs aligned with Glyph dMint v2
export const DMINT_ALGORITHM = {
  SHA256D: 0x00,
  BLAKE3: 0x01,
  K12: 0x02,
} as const;

// REST API response types
interface RestDmintContract {
  ref: string;
  ticker?: string;
  name?: string;
  algorithm: number;
  difficulty?: number;
  reward?: number;
  percent_mined?: number;
  active?: boolean;
  deploy_height?: number;
  daa_mode?: number;
  daa_mode_name?: string;
  outputs?: number;
  total_supply?: number;
  mined_supply?: number;
  icon_type?: string | null;
  icon_data?: string | null;
  icon_url?: string | null;
}

/**
 * Fetch contracts from REST API
 */
async function fetchFromRestApi(endpoint: string): Promise<RestDmintContract[] | null> {
  const url = restApiUrl.value;
  if (!url) {
    console.warn("REST API URL not configured");
    return null;
  }

  try {
    const response = await fetch(`${url}${endpoint}`, {
      signal: AbortSignal.timeout(10000), // 10 second timeout
    });
    if (!response.ok) {
      console.warn(`REST API request failed: ${response.status} ${response.statusText} for ${url}${endpoint}`);
      return null;
    }

    const data: any = await response.json();
    // v2 format uses 'items' (DmintV2TokenSummaryItem[]) — map to flat RestDmintContract shape
    if (Array.isArray(data.items)) {
      return (data.items as DmintV2TokenSummaryItem[]).filter((item) => !!item.token_ref).map((item) => ({
        ref: item.token_ref,
        ticker: item.ticker,
        name: item.name,
        algorithm: item.algorithm?.id ?? 0,
        difficulty: item.target ? Number(item.target) : 0,
        reward: item.reward_per_mint ? Number(item.reward_per_mint) : 0,
        percent_mined: item.percent_mined ?? 0,
        active: item.active ?? !item.is_fully_mined,
        burned: item.burned,
        deploy_height: item.deploy_height ?? 0,
        daa_mode: item.daa_mode?.id ?? 0,
        daa_mode_name: item.daa_mode?.name,
        outputs: item.contracts?.total ?? 0,
        total_supply: item.supply?.total ? Number(item.supply.total) : 0,
        mined_supply: item.supply?.minted ? Number(item.supply.minted) : 0,
        icon_type: item.icon?.type ?? null,
        icon_data: item.icon?.data_hex ?? null,
        icon_url: item.icon?.url ?? null,
      } as RestDmintContract));
    }
    const raw: RestDmintContract[] = data.results || data.contracts || [];
    return raw.filter((c: RestDmintContract) => !!c.ref);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      console.warn(`REST API timeout for ${url}${endpoint}`);
    } else {
      console.warn(`Failed to fetch from REST API at ${url}${endpoint}:`, error);
    }
    return null;
  }
}

/**
 * Map REST API contract to ExtendedContract format
 */
function mapRestContract(rest: RestDmintContract): ExtendedContract {
  const totalSupply = rest.total_supply || 0;
  const minedSupply = rest.mined_supply || 0;
  const percentMined =
    typeof rest.percent_mined === "number"
      ? rest.percent_mined
      : totalSupply > 0
        ? (minedSupply / totalSupply) * 100
        : 0;

  return {
    ref: rest.ref,
    outputs: rest.outputs ?? 0,
    ticker: rest.ticker,
    name: rest.name,
    algorithm: rest.algorithm ?? 0,
    difficulty: rest.difficulty ?? 0,
    reward: rest.reward ?? 0,
    percent_mined: percentMined,
    active: rest.active ?? true,
    burned: false,
    deploy_height: rest.deploy_height ?? 0,
    daa_mode: rest.daa_mode ?? 0,
    daa_mode_name: rest.daa_mode_name,
    icon_type: rest.icon_type || undefined,
    icon_data: rest.icon_data || undefined,
    icon_url: rest.icon_url || undefined,
    total_supply: totalSupply,
    mined_supply: minedSupply,
  };
}

/**
 * Fetch contracts in simple tuple format: [[ref, outputs], ...]
 * Uses REST API (primary) with Electrum RPC fallback, then static fallback.
 */
export async function fetchContractsSimple(): Promise<[string, number][]> {
  // Try REST API first
  const restContracts = await fetchFromRestApi("/dmint/contracts?version=2&limit=5000");
  if (restContracts && restContracts.length > 0) {
    console.log(`Loaded ${restContracts.length} contracts from REST API`);
    return restContracts.map((c) => [c.ref, c.outputs ?? 0]);
  }

  // Fallback to Electrum RPC
  try {
    const request: DmintV2ContractsRequest = {
      version: 2,
      view: "token_summary",
      filters: { status: "all" },
      pagination: { limit: 5000 },
    };
    const result = await client.request("dmint.get_contracts", request as unknown as string);
    
    // Handle error response
    if (result && typeof result === 'object' && 'error' in result) {
      console.warn("dMint API error:", (result as { error: string }).error);
    } else {
      const response = toExtendedResponse(result);
      if (response?.contracts?.length) {
        console.log(`Loaded ${response.contracts.length} contracts from Electrum API`);
        return response.contracts.map((c) => [c.ref, c.outputs]);
      }
    }
  } catch (error) {
    console.warn("Failed to fetch contracts from Electrum API:", error);
  }

  // Final fallback to static contracts URL
  try {
    const staticUrl = contractsUrl.value;
    console.log("Attempting static fallback with URL:", staticUrl);
    if (!staticUrl) {
      console.warn("Static contracts URL not configured");
      return [];
    }
    
    const response = await fetch(staticUrl, {
      signal: AbortSignal.timeout(10000),
      headers: {
        'Accept': 'application/json',
        'Cache-Control': 'no-cache'
      }
    });
    
    console.log("Static fallback response status:", response.status, response.statusText);
    
    if (!response.ok) {
      console.warn(`Static contracts URL failed: ${response.status} ${response.statusText}`);
      return [];
    }
    
    const contentType = response.headers.get('content-type');
    console.log("Static fallback content-type:", contentType);
    if (!contentType?.includes('application/json')) {
      console.warn(`Static contracts URL returned non-JSON content: ${contentType}`);
      return [];
    }
    
    const contracts = await response.json() as [string, number][];
    console.log(`Loaded ${contracts.length} contracts from static URL:`, contracts);
    return contracts;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      console.warn("Static contracts URL timeout");
    } else {
      console.error("All contract loading methods failed:", error);
    }
    return [];
  }
}

/**
 * Fetch contracts in extended format with full metadata.
 * Uses REST API (primary) with Electrum RPC fallback.
 */
export async function fetchContractsExtended(): Promise<ExtendedContractsResponse | null> {
  // Try REST API first
  const restContracts = await fetchFromRestApi("/dmint/contracts?version=2&limit=5000");
  if (restContracts && restContracts.length > 0) {
    const mapped = restContracts.map(mapRestContract);
    indexExtendedContracts(mapped);
    return {
      version: 2,
      updated_at: new Date().toISOString(),
      updated_height: 0,
      count: mapped.length,
      contracts: mapped,
    };
  }

  // Fallback to Electrum RPC
  if (getContractsSupported === false) {
    return null;
  }

  try {
    const request: DmintV2ContractsRequest = {
      version: 2,
      view: "token_summary",
      filters: { status: "mineable" },
      sort: { field: "deploy_height", dir: "desc" },
      pagination: { limit: 5000 },
    };

    const result = await client.request("dmint.get_contracts", request as unknown as string);
    
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

    const response = toExtendedResponse(result);
    if (!response) {
      console.warn("dMint API returned unexpected contracts response shape");
      return null;
    }
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
  const url = restApiUrl.value;
  if (!url) return false;
  try {
    const response = await fetch(`${url}/dmint/stats`, {
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
