import { Box, BoxProps } from "@chakra-ui/react";
import { ServerStatus, serverStatus } from "./client";

const statusText = {
  [ServerStatus.CONNECTED]: { color: "lightGreen.A200", text: "Connected" },
  [ServerStatus.DISCONNECTED]: { color: "red.200", text: "Disconnected" },
  [ServerStatus.CONNECTING]: { color: "yellow.200", text: "Connecting" },
};

export default function ConnectionStatus(props: BoxProps) {
  const status = statusText[serverStatus.value];
  return (
    <Box
      color={status.color}
      bgColor="blackAlpha.400"
      px={2}
      py={1}
      mr={2}
      fontSize="medium"
      {...props}
    >
      {status.text}
    </Box>
  );
}
