import { Box, BoxProps } from "@chakra-ui/react";

type MonoTagProps = BoxProps & {
  /** Single-line ellipsis instead of wrapping. */
  truncate?: boolean;
};

/**
 * Inline monospace "chip" for IDs, refs, addresses and nonces. Replaces the
 * repeated inline mono markup in Messages (Id/Msg), Miner (mine-to chip),
 * Settings (address) and the list ref cells.
 */
export default function MonoTag({
  truncate = false,
  children,
  ...rest
}: MonoTagProps) {
  return (
    <Box
      as="span"
      display="inline-block"
      verticalAlign="middle"
      fontFamily="ono"
      fontSize="xs"
      bg="surface.inset"
      color="text.secondary"
      px={1.5}
      py={0.5}
      borderRadius="md"
      maxW={truncate ? "100%" : undefined}
      overflow={truncate ? "hidden" : undefined}
      textOverflow={truncate ? "ellipsis" : undefined}
      whiteSpace={truncate ? "nowrap" : undefined}
      {...rest}
    >
      {children}
    </Box>
  );
}
