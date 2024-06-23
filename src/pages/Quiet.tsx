import { Flex, Text } from "@chakra-ui/react";
import Accepted from "../Accepted";
import Hashrate from "../Hashrate";
import Rejected from "../Rejected";
import { Link } from "react-router-dom";

export default function Quiet() {
  return (
    <Flex
      as={Link}
      to="/"
      direction="column"
      alignItems="center"
      justifyContent="center"
      w="100vw"
      h="100vh"
      fontFamily="Source Code Pro Variable, sans-serif"
      userSelect="none"
      cursor="pointer"
    >
      <Text fontSize="xx-large" as="div">
        <Hashrate /> A:
        <Accepted /> R:
        <Rejected />
      </Text>
      <Text as="div" mt={16}>
        Click anywhere to return
      </Text>
    </Flex>
  );
}
