import { useEffect, useState } from "react";
import { blockchain, fetchDeployments } from "../blockchain";
import {
  Box,
  Button,
  Center,
  Container,
  Flex,
  Heading,
  Icon,
  IconButton,
  Spinner,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from "@chakra-ui/react";
import { Contract, Glyph, Token } from "../types";
import { MAX_TARGET } from "../pow";
import { FaQuestionCircle } from "react-icons/fa";
import { TokenImage } from "../TokenDetails";
import { CloseIcon } from "@chakra-ui/icons";
import { Link, useNavigate, useParams } from "react-router-dom";
import Pagination from "../Pagination";
import { reverseRef } from "../utils";
import { selectedContract } from "../signals";
import ShortRef from "../ShortRef";

function TokenRow({
  token: { glyph, contract },
}: {
  token: { glyph: Glyph; contract: Contract };
}) {
  const { target, height, maxHeight, reward } = contract;
  const navigate = useNavigate();

  const file = glyph.files.main;
  const type = file?.t || "";
  const hasImage = type?.startsWith("image/") && file?.b instanceof Uint8Array;
  const difficulty = MAX_TARGET / target;
  const ticker = (glyph.payload.ticker as string) || "???";
  const ref = reverseRef(contract.contractRef);
  const load = () => {
    selectedContract.value = ref;
    blockchain.changeToken(ref);
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
          {ticker}
        </Flex>
      </Td>
      <Td>
        <ShortRef id={ref} />
      </Td>
      <Td isNumeric>
        {`${((Number(height) / Number(maxHeight)) * 100).toFixed(2)}`}%
      </Td>
      <Td isNumeric>{`${reward}`}</Td>
      <Td isNumeric>{`${difficulty}`}</Td>
      <Td isNumeric>
        <Button onClick={load}>Load</Button>
      </Td>
    </Tr>
  );
}

export default function TokenList() {
  const [tokens, setTokens] = useState<Token[] | null>(null);
  const { page: pageParam } = useParams();
  const [pages, setPages] = useState(0);
  const page = pageParam ? parseInt(pageParam, 10) : 0;

  useEffect(() => {
    (async () => {
      const results = await fetchDeployments(page);
      setTokens(results.tokens);
      setPages(results.pages);
    })();
  }, [page]);

  const refresh = async () => {
    setTokens(null);
    setPages(0);
    const results = await fetchDeployments(0, true);
    setTokens(results.tokens);
    setPages(results.pages);
  };

  return (
    <>
      <Box bg="bg.300">
        <Container maxW="container.lg">
          <Flex justifyContent="space-between" h="128px" alignItems="center">
            <Heading size="lg" fontWeight="400" flexGrow={1}>
              Active Mining Contracts
            </Heading>
            <Button onClick={refresh}>Refresh List</Button>
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

      <Container maxW="container.lg" py={8}>
        <Table sx={{ borderCollapse: "separate", borderSpacing: "0 4px" }}>
          <Thead>
            <Tr>
              <Th>Name</Th>
              <Th>ID</Th>
              <Th isNumeric>Claimed</Th>
              <Th isNumeric>Reward</Th>
              <Th isNumeric>Difficulty</Th>
              <Th></Th>
            </Tr>
          </Thead>
          <Tbody>
            {tokens &&
              tokens.map((token) => (
                <TokenRow key={token.contract.contractRef} token={token} />
              ))}
          </Tbody>
        </Table>
        {!tokens && (
          <Center my={16}>
            <Spinner size="xl" />
          </Center>
        )}
        {tokens && (
          <Pagination
            mt={4}
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
