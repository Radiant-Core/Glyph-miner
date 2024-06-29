import { swapEndianness } from "@bitauth/libauth";
import localforage from "localforage";
import { fetchToken } from "./glyph";
import { contractsUrl } from "./signals";
import { ContractGroup, Token } from "./types";
import { arrayChunks } from "./utils";

// Temporary replacement for fetchContractUtxos
async function fetchCuratedContracts(): Promise<[string, number][]> {
  try {
    const response = await fetch(contractsUrl.value);
    if (!response.ok) {
      return [];
    }
    return (await response.json()) as [string, number][];
  } catch {
    return [];
  }
}

// Needs improvement to remove spam
/*
async function fetchContractUtxos() {
  const cache = await localforage.getItem("unspent");
  if (cache) {
    return cache as Utxo[];
  }

  const unspent = (
    (await client.request(
      "blockchain.codescripthash.listunspent",
      "e8ed45cef15052dbe4b53274cd10a4c55c4065505cbb3420b6d1da20c365dad1" // SHA-256 of mining contract
    )) as Utxo[]
  ).filter(
    (u) => u.refs?.length === 2 && u.refs[0].type === "single" && u.refs[1].type
  );

  localforage.setItem("unspent", unspent);
  return unspent;
}
*/

const RESULTS_PER_PAGE = 10;
export async function fetchDeployments(
  onProgress: (n: number) => undefined = () => undefined,
  page = 0,
  refresh = false
): Promise<{ contractGroups: ContractGroup[]; pages: number }> {
  if (refresh) {
    await localforage.clear();
  }

  const allKey = "tokens";
  const cacheKey = `tokens-${page}`;
  const pageCache = await localforage.getItem(cacheKey);
  if (pageCache) {
    const contractAddresses = await localforage.getItem<string[]>(allKey);
    if (contractAddresses?.length) {
      const pages = Math.ceil(contractAddresses.length / RESULTS_PER_PAGE);

      // Get each cached group
      const firstRefs = pageCache as string[];
      const contractGroups = (
        await Promise.all(
          firstRefs.map((firstRef) =>
            localforage.getItem<ContractGroup>(`contractGroup.${firstRef}`)
          )
        )
      ).filter(Boolean) as ContractGroup[];

      return { contractGroups, pages };
    }
  }

  // TODO implement pagination in ElectrumX
  const all =
    (await localforage.getItem<[string, number][]>(allKey)) ||
    (await fetchCuratedContracts());
  const contractAddresses = all.slice(
    page * RESULTS_PER_PAGE,
    (page + 1) * RESULTS_PER_PAGE
  );

  const expanded = contractAddresses.flatMap(([singleton, numContracts]) => {
    const txid = singleton.slice(0, 64);
    const vout = parseInt(singleton.slice(65), 16);

    return new Array(numContracts).fill(undefined).map((_, i) => {
      // Add to vout and convert short format to big endian hex
      const buf = Buffer.alloc(36);
      buf.write(txid, 0, 32, "hex");
      buf.writeUInt32BE(vout + i, 32);
      // Save firstVout so we can group by first ref later
      return { firstVout: vout, singleton: buf.toString("hex") };
    });
  });

  const batches = arrayChunks(expanded, 4);
  const contracts: { firstVout: number; token: Token }[] = [];
  let progress = 1;

  // Fetch in batches
  for (const batch of batches) {
    contracts.push(
      ...((
        await Promise.all(
          batch.map(async ({ firstVout, singleton }) => {
            const cachedToken = await localforage.getItem<Token>(singleton);
            const token = cachedToken || (await fetchToken(singleton));
            onProgress((++progress / expanded.length) * 100);
            if (token) {
              localforage.setItem(singleton, token);
              return { firstVout, token };
            }
            return undefined;
          })
        )
      ).filter(Boolean) as { firstVout: number; token: Token }[])
    );
  }

  // Build contract groups
  const contractGroups = new Map<string, ContractGroup>();
  contracts.forEach(({ firstVout, token: contract }) => {
    const txid = contract.contract.contractRef.substring(0, 64);
    // Group by the first ref
    const buf = Buffer.alloc(36);
    buf.write(swapEndianness(txid), 0, 32, "hex");
    buf.writeUInt32BE(firstVout, 32);
    const firstRef = buf.toString("hex");

    if (!contractGroups.has(firstRef)) {
      contractGroups.set(firstRef, {
        glyph: contract.glyph,
        summary: {
          numContracts: 0,
          totalSupply: 0n,
          mintedSupply: 0n,
        },
        contracts: [],
      });
    }
    const token = contractGroups.get(firstRef);
    if (token) {
      token.contracts.push(contract.contract);
      token.summary.numContracts++;
      token.summary.totalSupply +=
        contract.contract.maxHeight * contract.contract.reward;
      token.summary.mintedSupply +=
        contract.contract.height * contract.contract.reward;
    }
  });

  // Cache page refs and contract groups
  for (const [firstRef, g] of contractGroups) {
    localforage.setItem(`contractGroup.${firstRef}`, g);
  }
  const firstRefs = [...contractGroups.keys()];
  localforage.setItem(cacheKey, firstRefs);

  const pages = Math.ceil(all.length / RESULTS_PER_PAGE);
  return { contractGroups: [...contractGroups.values()], pages };
}

export async function getCachedTokenContracts(firstRef: string) {
  return await localforage.getItem<ContractGroup>(`contractGroup.${firstRef}`);
}
