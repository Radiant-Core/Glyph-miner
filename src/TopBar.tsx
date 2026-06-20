import { Link } from "react-router-dom";
import { SettingsIcon } from "@chakra-ui/icons";
import { Box, Container, Flex, IconButton, Icon } from "@chakra-ui/react";
import { BiSolidHide } from "react-icons/bi";
import Logo from "./Logo";
import ConnectionStatus from "./ConnectionStatus";
import BalanceBadge from "./BalanceBadge";

export default function TopBar() {
  return (
    <Box
      bg="surface.bar"
      position="fixed"
      width="100vw"
      top={0}
      zIndex={10}
      borderBottom="1px solid"
      borderBottomColor="border.subtle"
      backdropFilter="blur(12px)"
    >
      <Container maxW="container.lg" as={Flex} alignItems="center" gap={2} py={2}>
        <Logo />
        <Box flexGrow={1} />
        <ConnectionStatus display={{ base: "none", md: "inline-flex" }} />
        <BalanceBadge display={{ base: "none", md: "block" }} />
        <IconButton
          as={Link}
          to="/quiet"
          variant="ghost"
          icon={<Icon as={BiSolidHide} />}
          aria-label="Hide UI"
          size="sm"
        />
        <IconButton
          as={Link}
          to="/settings"
          variant="ghost"
          icon={<SettingsIcon />}
          aria-label="Settings"
          size="sm"
        />
      </Container>
    </Box>
  );
}
