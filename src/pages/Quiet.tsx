import { Box, Flex, Text } from "@chakra-ui/react";
import Accepted from "../Accepted";
import Hashrate from "../Hashrate";
import Rejected from "../Rejected";
import HashrateChart from "../components/HashrateChart";
import { Link } from "react-router-dom";

function QuietStat({
  label,
  color,
  children,
}: {
  label: string;
  color: string;
  children: React.ReactNode;
}) {
  return (
    <Box textAlign="center">
      <Text
        fontSize="xs"
        fontWeight="bold"
        letterSpacing="widest"
        textTransform="uppercase"
        color="text.muted"
        mb={1}
      >
        {label}
      </Text>
      <Text fontSize={{ base: "3xl", md: "5xl" }} fontWeight="bold" color={color}>
        {children}
      </Text>
    </Box>
  );
}

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
      fontFamily="ono"
      userSelect="none"
      cursor="pointer"
      gap={10}
    >
      <Box w={{ base: "70vw", md: "420px" }} opacity={0.8}>
        <HashrateChart width={420} height={90} />
      </Box>

      <Flex gap={{ base: 8, md: 16 }} wrap="wrap" justifyContent="center">
        <QuietStat label="Hashrate" color="accent.fg">
          <Hashrate />
        </QuietStat>
        <QuietStat label="Accepted" color="positive.fg">
          <Accepted />
        </QuietStat>
        <QuietStat label="Rejected" color="negative.fg">
          <Rejected />
        </QuietStat>
      </Flex>

      <Text fontSize="sm" color="text.muted">
        Click anywhere to return
      </Text>
    </Flex>
  );
}
