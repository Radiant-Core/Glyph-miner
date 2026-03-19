import { useEffect, useMemo, useState, useCallback } from "react";
import { changeToken } from "../blockchain";
import {
  Box, Button, Center, CircularProgress, Container, Flex, Heading,
  Icon, IconButton, Image, Input, InputGroup, InputLeftElement,
  Table, Tbody, Td, Th, Thead, Tr, Text, Tooltip,
} from "@chakra-ui/react";
import { SearchIcon, TriangleDownIcon, TriangleUpIcon, CloseIcon } from "@chakra-ui/icons";
import { FaQuestionCircle } from "react-icons/fa";
import { LuRefreshCw } from "react-icons/lu";
import { Link, useNavigate } from "react-router-dom";
import { deriveSubContractRef } from "../utils";
import { miningEnabled, miningStatus, selectedContract } from "../signals";
import miner from "../miner";
import { addMessage } from "../message";
import { fetchContractSummaries, ContractSummaryItem } from "../deployments";
import { MAX_TARGET } from "../pow";
import { fetchToken } from "../glyph";

type SortField = "ticker" | "claimed" | "contracts" | "reward" | "difficulty";
type SortDir = "asc" | "desc";

const DAA_MODE_FIXED = 0;

/**
 * Format difficulty for display.
 * For fixed DAA: compute human-readable difficulty from raw target.
 * The API's "difficulty" field is actually the raw on-chain target value.
 */
function computeDifficulty(item: ContractSummaryItem): string {
  if (item.daaMode !== DAA_MODE_FIXED) {
    return item.daaModeName || "Variable";
  }
  if (!item.difficulty || item.difficulty <= 0) return "—";
  try {
    const target = BigInt(Math.floor(item.difficulty));
    if (target <= 0n) return "—";
    const diff = MAX_TARGET / target;
    return fmtDiff(Number(diff));
  } catch {
    return fmtDiff(item.difficulty);
  }
}

function fmtDiff(d: number): string {
  if (d >= 1e15) return (d / 1e15).toFixed(1) + "P";
  if (d >= 1e12) return (d / 1e12).toFixed(1) + "T";
  if (d >= 1e9) return (d / 1e9).toFixed(1) + "G";
  if (d >= 1e6) return (d / 1e6).toFixed(1) + "M";
  if (d >= 1e3) return (d / 1e3).toFixed(1) + "K";
  return d.toFixed(0);
}

/**
 * Build a blob URL from hex-encoded icon data and MIME type.
 * This mirrors how Photonic Wallet decodes embedded icons:
 *   const blob = new Blob([embed.b], { type: embed.t });
 * Except the API returns hex-encoded bytes, so we decode first.
 */
function iconDataUrl(iconType?: string, iconData?: string): string | undefined {
  if (!iconType || !iconData) return undefined;
  try {
    const bytes = new Uint8Array(
      iconData.match(/.{1,2}/g)?.map(b => parseInt(b, 16)) || []
    );
    const blob = new Blob([bytes], { type: iconType });
    return URL.createObjectURL(blob);
  } catch {
    return undefined;
  }
}

/**
 * Resolve IPFS URLs to a public gateway, similar to Photonic Wallet's useIpfsUrl.
 */
function resolveIconUrl(url?: string): string | undefined {
  if (!url) return undefined;
  if (url.startsWith("ipfs://")) {
    const cid = url.replace("ipfs://", "");
    return `https://ipfs.io/ipfs/${cid}`;
  }
  return url;
}

function TokenIcon({ iconType, iconData, iconUrl }: {
  iconType?: string; iconData?: string; iconUrl?: string;
}) {
  const [blobUrl, setBlobUrl] = useState<string | undefined>();

  useEffect(() => {
    const u = iconDataUrl(iconType, iconData);
    setBlobUrl(u);
    return () => { if (u) URL.revokeObjectURL(u); };
  }, [iconType, iconData]);

  const src = blobUrl || resolveIconUrl(iconUrl);
  if (src) {
    return (
      <Image
        src={src}
        boxSize="24px"
        borderRadius="full"
        objectFit="cover"
        fallback={<Icon as={FaQuestionCircle} boxSize={5} color="gray.500" />}
      />
    );
  }
  return <Icon as={FaQuestionCircle} boxSize={5} color="gray.500" />;
}

function SummaryRow({ item }: { item: ContractSummaryItem }) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Derive sub-contract refs from token ref (big-endian 72-char format)
      // changeToken and fetchToken both expect big-endian refs
      const numToTry = Math.min(item.outputs || 1, 64);
      let loaded = false;

      for (let i = 0; i < numToTry; i++) {
        const candidateRef = deriveSubContractRef(item.ref, i);
        try {
          const token = await fetchToken(candidateRef);
          if (token && token.contract.height < token.contract.maxHeight) {
            selectedContract.value = candidateRef;
            changeToken(candidateRef);
            loaded = true;
            break;
          }
        } catch {
          continue;
        }
      }

      if (!loaded) {
        addMessage({ type: "general", msg: `All sub-contracts for ${item.ticker} are fully mined` });
        setLoading(false);
        return;
      }

      if (miningStatus.value !== "ready") addMessage({ type: "stop" });
      miner.stop();
      miningEnabled.value = false;
      navigate("/");
    } catch (e) {
      console.error("Failed to load contract:", e);
      addMessage({ type: "general", msg: `Failed to load ${item.ticker}` });
    } finally {
      setLoading(false);
    }
  }, [item, navigate]);

  return (
    <Tr
      _hover={{ bg: "whiteAlpha.50" }}
      transition="background 0.1s"
      cursor="default"
    >
      <Td>
        <Flex gap={2} alignItems="center">
          <TokenIcon iconType={item.iconType} iconData={item.iconData} iconUrl={item.iconUrl} />
          <Text fontWeight="medium">{item.ticker.substring(0, 20)}</Text>
        </Flex>
      </Td>
      <Td fontFamily="Source Code Pro Variable, monospace" fontSize="xs" color="gray.400">
        {item.ref.substring(0, 4)}&middot;{item.ref.substring(60, 64)}
      </Td>
      <Td isNumeric>
        <Box
          as="span"
          px={2}
          py={0.5}
          borderRadius="full"
          fontSize="xs"
          fontWeight="semibold"
          bg={item.percentMined >= 100 ? "red.900" : item.percentMined >= 75 ? "yellow.900" : "whiteAlpha.100"}
          color={item.percentMined >= 100 ? "red.200" : item.percentMined >= 75 ? "yellow.200" : "inherit"}
        >
          {item.percentMined.toFixed(2)}%
        </Box>
      </Td>
      <Td isNumeric>{item.outputs}</Td>
      <Td isNumeric>{item.reward.toLocaleString()}</Td>
      <Td isNumeric fontFamily="Source Code Pro Variable, monospace">
        <Tooltip label={item.daaMode !== DAA_MODE_FIXED ? `DAA: ${item.daaModeName}` : `Target: ${item.difficulty}`} fontSize="xs">
          <Text as="span">{computeDifficulty(item)}</Text>
        </Tooltip>
      </Td>
      <Td isNumeric>
        <Button
          size="xs"
          onClick={load}
          variant="outline"
          isLoading={loading}
          loadingText="..."
          isDisabled={item.percentMined >= 100}
        >
          {item.percentMined >= 100 ? "Done" : "Load"}
        </Button>
      </Td>
    </Tr>
  );
}

function SortTh({ label, field, cur, dir, onSort, isNumeric = false }: {
  label: string; field: SortField; cur: SortField; dir: SortDir;
  onSort: (f: SortField) => void; isNumeric?: boolean;
}) {
  const active = cur === field;
  return (
    <Th
      isNumeric={isNumeric}
      cursor="pointer"
      onClick={() => onSort(field)}
      _hover={{ color: "lightGreen.A200" }}
      userSelect="none"
      whiteSpace="nowrap"
      color={active ? "lightGreen.A200" : undefined}
    >
      {label}
      {active && (dir === "asc"
        ? <TriangleUpIcon ml={1} boxSize={2.5} />
        : <TriangleDownIcon ml={1} boxSize={2.5} />
      )}
    </Th>
  );
}

function sortVal(item: ContractSummaryItem, f: SortField): number | string {
  if (f === "ticker") return item.ticker.toLowerCase();
  if (f === "claimed") return item.percentMined;
  if (f === "contracts") return item.outputs;
  if (f === "reward") return item.reward;
  return item.difficulty;
}

export default function TokenList() {
  const [items, setItems] = useState<ContractSummaryItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sf, setSf] = useState<SortField>("ticker");
  const [sd, setSd] = useState<SortDir>("asc");

  const doLoad = useCallback(async () => {
    setLoading(true);
    setItems(null);
    const data = await fetchContractSummaries();
    setItems(data);
    setLoading(false);
  }, []);

  useEffect(() => { doLoad(); }, [doLoad]);

  const onSort = useCallback((field: SortField) => {
    setSf(prev => {
      if (prev === field) {
        setSd(d => d === "asc" ? "desc" : "asc");
        return prev;
      }
      setSd(field === "ticker" ? "asc" : "desc");
      return field;
    });
  }, []);

  const filtered = useMemo(() => {
    if (!items) return null;
    const q = search.toLowerCase().trim();
    let list = q
      ? items.filter(i =>
          i.ticker.toLowerCase().includes(q) ||
          i.name.toLowerCase().includes(q) ||
          i.ref.includes(q))
      : [...items];
    list.sort((a, b) => {
      const av = sortVal(a, sf);
      const bv = sortVal(b, sf);
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sd === "asc" ? cmp : -cmp;
    });
    return list;
  }, [items, search, sf, sd]);

  return (
    <>
      <Box bg="bg.300" borderBottom="1px solid" borderBottomColor="whiteAlpha.50">
        <Container maxW="container.lg">
          <Flex
            justifyContent="space-between"
            h={{ base: "64px", md: "96px" }}
            alignItems="center"
          >
            <Heading size={{ base: "md", md: "lg" }} fontWeight="500" flexGrow={1}>
              Mining Contracts
            </Heading>
            <IconButton
              icon={<Icon as={LuRefreshCw} />}
              aria-label="Refresh"
              onClick={doLoad}
              display={{ base: "flex", md: "none" }}
              variant="ghost"
              size="sm"
            />
            <Button
              onClick={doLoad}
              leftIcon={<Icon as={LuRefreshCw} />}
              display={{ base: "none", md: "flex" }}
              variant="outline"
              size="sm"
            >
              Refresh
            </Button>
            <IconButton
              icon={<CloseIcon />}
              as={Link}
              aria-label="Close"
              to="/"
              ml={3}
              variant="ghost"
              size="sm"
            />
          </Flex>
        </Container>
      </Box>

      <Container maxW="container.lg" py={6} px={{ base: 2, md: 0 }}>
        <Box mb={4}>
          <InputGroup maxW="360px">
            <InputLeftElement pointerEvents="none">
              <SearchIcon color="gray.500" />
            </InputLeftElement>
            <Input
              placeholder="Search by name or ID..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              bg="bg.100"
              border="1px solid"
              borderColor="whiteAlpha.100"
              _focus={{ borderColor: "lightGreen.A400", bg: "bg.50" }}
              size="sm"
              borderRadius="lg"
              h="40px"
            />
          </InputGroup>
        </Box>

        <Box
          width="100%"
          overflowX="auto"
          bg="bg.100"
          borderRadius="2xl"
          border="1px solid"
          borderColor="whiteAlpha.50"
        >
          <Table variant="unstyled" size="sm">
            <Thead>
              <Tr borderBottom="1px solid" borderBottomColor="whiteAlpha.100">
                <SortTh label="Name" field="ticker" cur={sf} dir={sd} onSort={onSort} />
                <Th>ID</Th>
                <SortTh label="Claimed" field="claimed" cur={sf} dir={sd} onSort={onSort} isNumeric />
                <SortTh label="Contracts" field="contracts" cur={sf} dir={sd} onSort={onSort} isNumeric />
                <SortTh label="Reward" field="reward" cur={sf} dir={sd} onSort={onSort} isNumeric />
                <SortTh label="Difficulty" field="difficulty" cur={sf} dir={sd} onSort={onSort} isNumeric />
                <Th></Th>
              </Tr>
            </Thead>
            <Tbody>
              {filtered && filtered.map(item => (
                <SummaryRow key={item.ref} item={item} />
              ))}
            </Tbody>
          </Table>
        </Box>

        {loading && (
          <Center my={16}>
            <CircularProgress
              isIndeterminate
              size="80px"
              color="lightGreen.A200"
              trackColor="bg.300"
              thickness={8}
            />
          </Center>
        )}

        {!loading && filtered && filtered.length === 0 && (
          <Center my={16} color="gray.400" fontSize="sm">
            {search ? "No contracts match your search" : "No contracts found"}
          </Center>
        )}

        {!loading && items && (
          <Box mt={3} color="gray.500" fontSize="xs">
            {filtered?.length} of {items.length} contracts
          </Box>
        )}
      </Container>
    </>
  );
}
