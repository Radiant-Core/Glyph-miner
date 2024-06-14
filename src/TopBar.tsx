import { Link } from "react-router-dom";
import { SettingsIcon } from "@chakra-ui/icons";
import { Box, Container, Flex, IconButton, Icon } from "@chakra-ui/react";
import { BiSolidHide } from "react-icons/bi";
import Balance from "./Balance";
import Logo from "./Logo";
import { ServerStatus, status } from "./blockchain";

const statusText = {
  [ServerStatus.CONNECTED]: { color: "lightGreen.A200", text: "Connected" },
  [ServerStatus.DISCONNECTED]: { color: "red.200", text: "Disconnected" },
  [ServerStatus.CONNECTING]: { color: "yellow.200", text: "Connecting" },
};

export default function TopBar() {
  const serverStatus = statusText[status.value];
  return (
    <Box bg="bg.400">
      <Container maxW="container.lg" as={Flex} alignItems="center" py={2}>
        <Logo />
        <Box flexGrow={1} />
        <Box
          color={serverStatus.color}
          bgColor="blackAlpha.400"
          px={2}
          py={1}
          mr={2}
          fontSize="medium"
        >
          {serverStatus.text}
        </Box>
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
