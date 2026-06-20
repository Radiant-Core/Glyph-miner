import { useCallback, useEffect, useState } from "react";
import { useClipboard } from "@chakra-ui/react";
import { changeToken } from "../blockchain";
import {
  Button,
  Container,
  Icon,
  IconButton,
  Skeleton,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from "@chakra-ui/react";
import {
  ArrowBackIcon,
  CheckIcon,
  CloseIcon,
  CopyIcon,
} from "@chakra-ui/icons";
import { LuRefreshCw } from "react-icons/lu";
import { TbFileSearch } from "react-icons/tb";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ContractGroup, Contract } from "../types";
import { miningEnabled, miningStatus, selectedContract } from "../signals";
import ShortId from "../ShortId";
import { reverseRef } from "../utils";
import miner from "../miner";
import { addMessage } from "../message";
import { getCachedTokenContracts } from "../deployments";
import PageHeader from "../components/PageHeader";
import Panel from "../components/Panel";
import StatusPill, { PillTone } from "../components/StatusPill";
import MonoTag from "../components/MonoTag";
import EmptyState from "../components/EmptyState";

function claimedTone(pct: number): PillTone {
  if (pct >= 100) return "negative";
  if (pct >= 75) return "warning";
  return "neutral";
}

function ContractRow({ num, contract }: { num: number; contract: Contract }) {
  const navigate = useNavigate();
  const { contractRef, height, maxHeight, location } = contract;
  const { onCopy, hasCopied } = useClipboard(location);
  const load = () => {
    const ref = reverseRef(contractRef);
    selectedContract.value = ref;
    changeToken(ref);
    if (miningStatus.value !== "ready") {
      addMessage({ type: "stop" });
    }
    miner.stop();
    miningEnabled.value = false;
    navigate("/");
  };

  const pct = Number(maxHeight) > 0 ? (Number(height) / Number(maxHeight)) * 100 : 0;

  return (
    <Tr _hover={{ bg: "surface.elevated" }} transition="background 0.1s">
      <Td fontSize="sm">{num}</Td>
      <Td fontSize="sm">
        <MonoTag>
          <ShortId id={location} />
        </MonoTag>
        <IconButton
          ml={1}
          onClick={onCopy}
          icon={
            hasCopied ? (
              <CheckIcon color="accent.fg" />
            ) : (
              <CopyIcon color="accent.fg" />
            )
          }
          variant="ghost"
          aria-label="Copy location"
          size="xs"
        />
      </Td>
      <Td isNumeric fontSize="sm">
        <StatusPill tone={claimedTone(pct)}>{pct.toFixed(2)}%</StatusPill>
      </Td>
      <Td isNumeric>
        <Button size="xs" onClick={load} variant="outline">Load</Button>
      </Td>
    </Tr>
  );
}

export default function ContractList() {
  const { firstRef } = useParams();
  const [contractGroup, setContractGroup] = useState<
    ContractGroup | null | undefined
  >(null);

  const doLoad = useCallback(() => {
    setContractGroup(null);
    (async () => {
      const gr = await getCachedTokenContracts(firstRef || "");
      setContractGroup(gr || undefined);
    })();
  }, [firstRef]);

  useEffect(() => { doLoad(); }, [doLoad]);

  const loading = contractGroup === null;

  return (
    <>
      <PageHeader
        title={
          contractGroup === undefined
            ? "Unknown token"
            : (contractGroup?.glyph.payload.ticker as string) || "Sub-contracts"
        }
        subtitle="Sub-contracts"
      >
        <IconButton
          icon={<Icon as={LuRefreshCw} />}
          aria-label="Refresh list"
          onClick={doLoad}
          display={{ base: "flex", md: "none" }}
          variant="ghost"
          size="sm"
        />
        <Button
          as={Link}
          to="/tokens"
          leftIcon={<ArrowBackIcon />}
          display={{ base: "none", md: "flex" }}
          variant="outline"
          size="sm"
        >
          Back
        </Button>
        <IconButton
          icon={<CloseIcon />}
          as={Link}
          aria-label="Close"
          to="/"
          variant="ghost"
          size="sm"
        />
      </PageHeader>

      <Container maxW="container.lg" py={6} px={{ base: 2, md: 0 }}>
        {contractGroup === undefined ? (
          <Panel padded={false}>
            <EmptyState
              icon={TbFileSearch}
              title="Token not found"
              description="No sub-contracts could be loaded for this token reference."
              action={
                <Button as={Link} to="/tokens" variant="outline" size="sm">
                  Back to contracts
                </Button>
              }
            />
          </Panel>
        ) : (
          <Panel padded={false} width="100%" overflowX="auto">
            <Table variant="unstyled" size="sm">
              <Thead>
                <Tr borderBottom="1px solid" borderBottomColor="border.subtle">
                  <Th>#</Th>
                  <Th>Location</Th>
                  <Th isNumeric>Claimed</Th>
                  <Th></Th>
                </Tr>
              </Thead>
              <Tbody>
                {loading &&
                  Array.from({ length: 6 }).map((_, r) => (
                    <Tr key={r}>
                      {Array.from({ length: 4 }).map((_, c) => (
                        <Td key={c}>
                          <Skeleton height="16px" borderRadius="md" startColor="bg.300" endColor="bg.50" />
                        </Td>
                      ))}
                    </Tr>
                  ))}
                {!loading &&
                  contractGroup.contracts.map((contract, num) => (
                    <ContractRow
                      key={contract.contractRef}
                      contract={contract}
                      num={num}
                    />
                  ))}
              </Tbody>
            </Table>
          </Panel>
        )}
      </Container>
    </>
  );
}
