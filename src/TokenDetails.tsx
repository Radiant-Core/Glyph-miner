import {
  Box,
  Button,
  Flex,
  Icon,
  Image,
  Progress,
  SimpleGrid,
  Spinner,
  Text,
} from "@chakra-ui/react";
import { FaQuestionCircle } from "react-icons/fa";
import { TbListSearch } from "react-icons/tb";
import { Link } from "react-router-dom";
import { MAX_TARGET } from "./pow";
import { glyph, contract, loadingContract, tokenSupply } from "./signals";
import { useSignals } from "@preact/signals-react/runtime";
import Panel from "./components/Panel";
import EmptyState from "./components/EmptyState";

export function TokenImage({ type, file }: { type: string; file: Uint8Array }) {
  // Create a proper copy of the data to avoid SharedArrayBuffer issues
  const data = new Uint8Array(file);
  const blob = new Blob([data], { type });
  const src = URL.createObjectURL(blob);
  return (
    <Image
      w={10}
      h={10}
      objectFit="contain"
      borderRadius="md"
      src={src}
      alt="Token icon"
    />
  );
}

function Metric({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Box>
      <Text
        fontSize="xs"
        fontWeight="bold"
        letterSpacing="wider"
        textTransform="uppercase"
        color="text.muted"
        mb={1}
      >
        {label}
      </Text>
      <Box fontSize="sm" fontWeight="semibold" color="text.primary">
        {children}
      </Box>
    </Box>
  );
}

export default function TokenDetails() {
  useSignals();

  if (loadingContract.value) {
    return (
      <Panel mt={3} display="flex" alignItems="center" justifyContent="center" minH="88px">
        <Spinner mr={3} color="accent.fg" />
        <Text color="text.secondary">Loading contract…</Text>
      </Panel>
    );
  }

  if (!glyph.value || !contract.value) {
    return (
      <Panel mt={3} padded={false}>
        <EmptyState
          icon={TbListSearch}
          title="No mining contract loaded"
          description="Enter a contract address above or pick one from the contract list."
          action={
            <Button as={Link} to="/tokens" variant="outline" size="sm">
              Browse contracts
            </Button>
          }
        />
      </Panel>
    );
  }

  const { target, height, maxHeight, reward } = contract.value;

  const file = glyph.value.files.main;
  const type = file?.t || "";
  const hasImage = type?.startsWith("image/") && file?.b instanceof Uint8Array;
  const difficulty = MAX_TARGET / target;
  const ticker = (glyph.value.payload.ticker as string) || "???";
  const heightN = Number(height);
  const maxHeightN = Number(maxHeight);
  const pct = maxHeightN > 0 ? Math.min(100, (heightN / maxHeightN) * 100) : 0;
  const mintedOut = height >= maxHeight;

  // Whole-token aggregate across all sub-contracts (from the indexer). When a
  // token is split across multiple contracts the single loaded contract's
  // progress is misleading, so the bar reflects the entire token instead.
  //
  // The indexer's reported contract count is unreliable for some tokens, so the
  // real count is also inferred from total supply ÷ this contract's max supply
  // (sub-contracts share the same per-contract max). The token is treated as
  // multi-contract if EITHER signal says so.
  const agg = tokenSupply.value;
  const hasAgg = !!agg && agg.totalSupply > 0;
  const aggPct = agg ? Math.min(100, Math.max(0, agg.percentMined)) : 0;
  const singleMaxSupply = maxHeightN * Number(reward);
  const supplyRatio =
    hasAgg && singleMaxSupply > 0 ? agg!.totalSupply / singleMaxSupply : 1;
  const multiContract = hasAgg && (agg!.contracts > 1 || supplyRatio >= 1.5);
  const contractCount = Math.max(agg?.contracts ?? 0, Math.round(supplyRatio));
  const barPct = multiContract ? aggPct : pct;
  const barMintedOut = multiContract ? aggPct >= 100 : mintedOut;

  return (
    <Panel mt={3}>
      <Flex align="center" gap={3} mb={4}>
        {hasImage ? (
          <TokenImage type={type} file={file.b} />
        ) : (
          <Icon as={FaQuestionCircle} boxSize={10} color="text.muted" />
        )}
        <Box minW={0}>
          <Text fontSize="lg" fontWeight="bold" noOfLines={1}>
            {ticker}
          </Text>
          <Text fontSize="xs" color="text.muted">
            dMint contract
          </Text>
        </Box>
      </Flex>

      <Box mb={4}>
        <Flex justify="space-between" mb={1.5} fontSize="xs">
          <Text color="text.muted" textTransform="uppercase" letterSpacing="wider" fontWeight="bold">
            {multiContract ? `Supply mined · ${contractCount} contracts` : "Supply mined"}
          </Text>
          <Text color={barMintedOut ? "negative.fg" : "text.secondary"} fontWeight="semibold">
            {multiContract
              ? `${aggPct.toFixed(1)}%`
              : `${heightN.toLocaleString()} / ${maxHeightN.toLocaleString()} (${pct.toFixed(1)}%)`}
          </Text>
        </Flex>
        <Progress
          value={barPct}
          size="sm"
          borderRadius="full"
          colorScheme={barMintedOut ? "red" : "green"}
          bg="surface.inset"
          sx={{ "& > div": { bgColor: barMintedOut ? "negative" : "accent" } }}
        />
        {multiContract && (
          <Text mt={1.5} fontSize="xs" color="text.muted">
            This contract: {heightN.toLocaleString()} / {maxHeightN.toLocaleString()} ({pct.toFixed(1)}%)
          </Text>
        )}
      </Box>

      <SimpleGrid columns={{ base: 2, md: 2 }} spacing={4}>
        <Metric label="Reward">
          {reward.toLocaleString()} {ticker.substring(0, 20)}
        </Metric>
        <Metric label="Difficulty">{difficulty.toLocaleString()}</Metric>
      </SimpleGrid>
    </Panel>
  );
}
