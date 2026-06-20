import { Box, BoxProps } from "@chakra-ui/react";
import Balance from "./Balance";

/**
 * Shared "Balance: <amount>" pill used by both TopBar and BottomBar — replaces
 * the two identical inline blocks they each carried.
 */
export default function BalanceBadge(props: BoxProps) {
  return (
    <Box
      color="accent.fg"
      bgColor="whiteAlpha.100"
      px={3}
      py={1}
      fontSize="sm"
      fontWeight="semibold"
      borderRadius="lg"
      whiteSpace="nowrap"
      {...props}
    >
      Balance: <Balance /> RXD
    </Box>
  );
}
