import { Box, BoxProps } from "@chakra-ui/react";

type PanelProps = BoxProps & {
  /** Apply default internal padding. Set false for tables / flush content. */
  padded?: boolean;
};

/**
 * The single source of truth for card/panel chrome. Replaces the ~10 hand-rolled
 * `bg.100 + border whiteAlpha.50 + borderRadius` blocks scattered across pages.
 */
export default function Panel({ padded = true, children, ...rest }: PanelProps) {
  return (
    <Box
      bg="surface.card"
      border="1px solid"
      borderColor="border.subtle"
      borderRadius="xl"
      boxShadow="card"
      p={padded ? { base: 4, md: 5 } : 0}
      overflow="hidden"
      {...rest}
    >
      {children}
    </Box>
  );
}
