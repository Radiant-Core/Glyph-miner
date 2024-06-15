import { Box, Container, Flex } from "@chakra-ui/react";
import Balance from "./Balance";
import ConnectionStatus from "./ConnectionStatus";

// Bottom bar is only shown on mobile since not everything can fit in the top bar
export default function BottomBar() {
  return (
    <Box
      bg="bg.400"
      position="fixed"
      width="100vw"
      bottom={0}
      display={{ base: "block", md: "none" }}
    >
      <Container
        maxW="container.lg"
        as={Flex}
        alignItems="center"
        justifyContent="right"
        py={2}
      >
        <ConnectionStatus />
        <Box
          color="lightGreen.A200"
          bgColor="blackAlpha.400"
          px={2}
          py={1}
          mr={2}
          fontSize="medium"
        >
          Balance: <Balance />
        </Box>
      </Container>
    </Box>
  );
}
