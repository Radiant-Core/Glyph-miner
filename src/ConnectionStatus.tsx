import { Box, BoxProps } from "@chakra-ui/react";
import { ServerStatus, status } from "./blockchain";

const statusText = {
  [ServerStatus.CONNECTED]: { color: "lightGreen.A200", text: "Connected" },
  [ServerStatus.DISCONNECTED]: { color: "red.200", text: "Disconnected" },
  [ServerStatus.CONNECTING]: { color: "yellow.200", text: "Connecting" },
};

export default function ConnectionStatus(props: BoxProps) {
  const serverStatus = statusText[status.value];
  return (
    <Box
      color={serverStatus.color}
      bgColor="blackAlpha.400"
      px={2}
      py={1}
      mr={2}
      fontSize="medium"
      {...props}
    >
      {serverStatus.text}
    </Box>
  );
}
