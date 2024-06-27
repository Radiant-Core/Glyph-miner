import { useEffect, useState } from "react";
import { useClipboard } from "@chakra-ui/react";
import { blockchain, getCachedTokenContracts } from "../blockchain";
import {
  Box,
  Button,
  Container,
  Flex,
  Heading,
  Icon,
  IconButton,
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
import { Link, useNavigate, useParams } from "react-router-dom";
import { ContractGroup, Contract } from "../types";
import { miningStatus, selectedContract } from "../signals";
import ShortId from "../ShortId";
import { reverseRef } from "../utils";
import miner from "../miner";
import { addMessage } from "../message";

function ContractRow({ num, contract }: { num: number; contract: Contract }) {
  const navigate = useNavigate();
  const { contractRef, height, maxHeight, location } = contract;
  const { onCopy, hasCopied } = useClipboard(location);
  const load = () => {
    const ref = reverseRef(contractRef);
    selectedContract.value = ref;
    blockchain.changeToken(ref);
    if (miningStatus.value !== "ready") {
      addMessage({ type: "stop" });
    }
    miner.stop();
    navigate("/");
  };

  return (
    <Tr bgColor="bg.100">
      <Td>{num}</Td>
      <Td>
        <ShortId id={location} />
        <IconButton
          display="inline"
          onClick={onCopy}
          icon={
            hasCopied ? (
              <CheckIcon color="lightGreen.A400" />
            ) : (
              <CopyIcon color="lightGreen.A400" />
            )
          }
          variant="ghost"
          aria-label="Copy"
          size="xs"
        />
      </Td>
      <Td isNumeric>
        {((Number(height) / Number(maxHeight)) * 100).toFixed(2)}%
      </Td>
      <Td isNumeric>
        <Button onClick={load}>Load</Button>
      </Td>
    </Tr>
  );
}

export default function ContractList() {
  const { firstRef } = useParams();
  const [contractGroup, setContractGroup] = useState<
    ContractGroup | null | undefined
  >(null);
  useEffect(() => {
    setContractGroup(null);
    (async () => {
      const gr = await getCachedTokenContracts(firstRef || "");
      if (gr) {
        setContractGroup(gr);
      } else {
        setContractGroup(undefined);
      }
    })();
  }, []);

  return (
    <>
      <Box bg="bg.300">
        <Container maxW="container.lg">
          <Flex
            justifyContent="space-between"
            h={{ base: "64px", md: "128px" }}
            alignItems="center"
          >
            <Heading
              size={{ base: "md", md: "lg" }}
              fontWeight="400"
              flexGrow={1}
            >
              {contractGroup === undefined
                ? "Unknown token"
                : (contractGroup?.glyph.payload.ticker as string) || ""}
            </Heading>
            <IconButton
              icon={<Icon as={LuRefreshCw} />}
              aria-label="Refresh list"
              display={{ base: "flex", md: "none" }}
            />
            <Button
              as={Link}
              to="/tokens"
              leftIcon={<ArrowBackIcon />}
              display={{ base: "none", md: "flex" }}
            >
              Back
            </Button>
            <IconButton
              icon={<CloseIcon />}
              as={Link}
              aria-label="Close"
              to="/"
              ml={4}
            />
          </Flex>
        </Container>
      </Box>

      <Container maxW="container.lg" py={8} px={0}>
        {contractGroup && (
          <Box width="100%" overflowY="auto">
            <Table sx={{ borderCollapse: "separate", borderSpacing: "0 4px" }}>
              <Thead>
                <Tr>
                  <Th>#</Th>
                  <Th>Location</Th>
                  <Th isNumeric>Claimed</Th>
                  <Th></Th>
                </Tr>
              </Thead>
              <Tbody>
                {contractGroup &&
                  contractGroup.contracts.map((contract, num) => (
                    <ContractRow
                      key={contract.contractRef}
                      contract={contract}
                      num={num}
                    />
                  ))}
              </Tbody>
            </Table>
          </Box>
        )}
      </Container>
    </>
  );
}
