import { useEffect, useState } from "react";
import { changeToken } from "../blockchain";
import {
  Box,
  Button,
  Center,
  CircularProgress,
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
import { ContractGroup } from "../types";
import { MAX_TARGET } from "../pow";
import { FaQuestionCircle } from "react-icons/fa";
import { MdExpand } from "react-icons/md";
import { TokenImage } from "../TokenDetails";
import { CloseIcon } from "@chakra-ui/icons";
import { LuRefreshCw } from "react-icons/lu";
import { Link, useNavigate, useParams } from "react-router-dom";
import Pagination from "../Pagination";
import { reverseRef } from "../utils";
import { miningEnabled, miningStatus, selectedContract } from "../signals";
import ShortRef from "../ShortRef";
import miner from "../miner";
import { addMessage } from "../message";
import { fetchDeployments } from "../deployments";

function TokenRow({ token }: { token: ContractGroup }) {
  const { target, reward, contractRef } = token.contracts[0];
  const { mintedSupply, numContracts, totalSupply } = token.summary;
  const { glyph } = token;
  const navigate = useNavigate();

  const file = glyph.files.main;
  const type = file?.t || "";
  const hasImage = type?.startsWith("image/") && file?.b instanceof Uint8Array;
  const difficulty = MAX_TARGET / target;
  const ticker = (glyph.payload.ticker as string) || "???";
  const load = () => {
    // Select a random contract with unminted tokens
    const unminted = token.contracts.filter((c) => c.height < c.maxHeight);
    const ref = reverseRef(
      unminted[Math.floor(Math.random() * unminted.length)].contractRef
    );

    selectedContract.value = ref;
    changeToken(ref);
    if (miningStatus.value !== "ready") {
      addMessage({ type: "stop" });
    }
    miner.stop();
    miningEnabled.value = false;
    navigate("/");
  };

  return (
    <Tr bgColor="bg.100">
      <Td>
        <Flex gap={2} alignItems="center">
          {hasImage ? (
            <TokenImage type={type} file={file.b} />
          ) : (
            <Icon as={FaQuestionCircle} boxSize={6} color="gray.500" />
          )}
          {ticker.substring(0, 20)}
        </Flex>
      </Td>
      <Td>
        <ShortRef id={contractRef} omitVout />
      </Td>
      <Td isNumeric>
        {((Number(mintedSupply) / Number(totalSupply)) * 100).toFixed(2)}%
      </Td>
      <Td isNumeric>{numContracts}</Td>
      <Td isNumeric>{`${reward}`}</Td>
      <Td isNumeric>{`${difficulty}`}</Td>
      <Td isNumeric>
        <IconButton
          as={Link}
          to={`/contracts/${reverseRef(contractRef)}`}
          icon={<Icon as={MdExpand} />}
          aria-label="View contracts"
          mr={2}
        />
        <Button onClick={load}>Load</Button>
      </Td>
    </Tr>
  );
}

export default function TokenList() {
  const [tokens, setTokens] = useState<ContractGroup[] | null>(null);
  const { page: pageParam } = useParams();
  const [pages, setPages] = useState(0);
  const page = pageParam ? parseInt(pageParam, 10) : 0;
  const [progress, setProgress] = useState<number>(0);

  useEffect(() => {
    setTokens(null);
    (async () => {
      const results = await fetchDeployments((n) => {
        setProgress(n);
      }, page);
      setTokens(results.contractGroups);
      setPages(results.pages);
      setProgress(0);
    })();
  }, [page]);

  const refresh = async () => {
    setTokens(null);
    setPages(0);
    setProgress(0);
    const results = await fetchDeployments(
      (n) => {
        setProgress(n);
      },
      0,
      true
    );
    setTokens(results.contractGroups);
    setPages(results.pages);
    setProgress(0);
  };

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
              Mining Contracts
            </Heading>
            <IconButton
              icon={<Icon as={LuRefreshCw} />}
              aria-label="Refresh list"
              display={{ base: "flex", md: "none" }}
            />
            <Button
              onClick={refresh}
              leftIcon={<Icon as={LuRefreshCw} />}
              display={{ base: "none", md: "flex" }}
            >
              Refresh List
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
        <Box width="100%" overflowY="auto">
          <Table sx={{ borderCollapse: "separate", borderSpacing: "0 4px" }}>
            <Thead>
              <Tr>
                <Th>Name</Th>
                <Th>ID</Th>
                <Th isNumeric>Claimed</Th>
                <Th isNumeric>Contracts</Th>
                <Th isNumeric>Reward</Th>
                <Th isNumeric>Difficulty</Th>
                <Th></Th>
              </Tr>
            </Thead>
            <Tbody>
              {tokens &&
                tokens.map((token) => (
                  <TokenRow
                    key={token.contracts[0].contractRef}
                    token={token}
                  />
                ))}
            </Tbody>
          </Table>
        </Box>
        {!tokens && (
          <Center my={16}>
            <CircularProgress
              value={progress}
              size="92px"
              color="lightGreen.A200"
              trackColor="bg.300"
              thickness={12}
            />
          </Center>
        )}
        {tokens && (
          <Pagination
            mt={4}
            mr={4}
            startUrl="/tokens"
            page={page}
            prevUrl={page > 0 ? `/tokens/${page - 1}` : undefined}
            nextUrl={page === pages - 1 ? undefined : `/tokens/${page + 1}`}
          />
        )}
      </Container>
    </>
  );
}
