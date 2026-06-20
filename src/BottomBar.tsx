import { Box, Container, Flex } from "@chakra-ui/react";
import ConnectionStatus from "./ConnectionStatus";
import BalanceBadge from "./BalanceBadge";

// Bottom bar is only shown on mobile since not everything can fit in the top bar
export default function BottomBar() {
  return (
    <Box
      bg="surface.bar"
      position="fixed"
      width="100vw"
      bottom={0}
      zIndex={10}
      display={{ base: "block", md: "none" }}
      borderTop="1px solid"
      borderTopColor="border.subtle"
      backdropFilter="blur(12px)"
    >
      <Container
        maxW="container.lg"
        as={Flex}
        alignItems="center"
        justifyContent="flex-end"
        gap={2}
        py={2}
      >
        <ConnectionStatus />
        <BalanceBadge />
      </Container>
    </Box>
  );
}
