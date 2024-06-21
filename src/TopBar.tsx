import { Link } from "react-router-dom";
import { SettingsIcon } from "@chakra-ui/icons";
import { Box, Container, Flex, IconButton, Icon } from "@chakra-ui/react";
import { BiSolidHide } from "react-icons/bi";
import Balance from "./Balance";
import Logo from "./Logo";
import ConnectionStatus from "./ConnectionStatus";

export default function TopBar() {
  return (
    <Box bg="bg.400" position="fixed" width="100vw" top={0} zIndex={1}>
      <Container maxW="container.lg" as={Flex} alignItems="center" py={2}>
        <Logo />
        <Box flexGrow={1} />
        <ConnectionStatus display={{ base: "none", md: "flex" }} />
        <Box
          color="lightGreen.A200"
          bgColor="blackAlpha.400"
          px={2}
          py={1}
          mr={2}
          fontSize="medium"
          display={{ base: "none", md: "flex" }}
        >
          Balance: <Balance />
        </Box>
        <IconButton
          as={Link}
          to="/quiet"
          variant="ghost"
          icon={<Icon as={BiSolidHide} />}
          aria-label="Hide UI"
        />
        <IconButton
          as={Link}
          to="/settings"
          variant="ghost"
          icon={<SettingsIcon />}
          aria-label="Settings"
        />
      </Container>
    </Box>
  );
}
