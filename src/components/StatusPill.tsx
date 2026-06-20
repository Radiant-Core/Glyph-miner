import { Box, BoxProps } from "@chakra-ui/react";

export type PillTone =
  | "positive"
  | "negative"
  | "warning"
  | "info"
  | "neutral";

const toneStyles: Record<PillTone, { bg: string; color: string; dot: string }> =
  {
    positive: { bg: "accent.900", color: "accent.fg", dot: "accent.fg" },
    negative: { bg: "#3a1f1f", color: "negative.fg", dot: "negative.fg" },
    warning: { bg: "#3a2e1c", color: "warning.fg", dot: "warning" },
    info: { bg: "#1c2c3a", color: "info.fg", dot: "info.fg" },
    neutral: { bg: "whiteAlpha.100", color: "text.secondary", dot: "text.muted" },
  };

type StatusPillProps = BoxProps & {
  tone?: PillTone;
  /** Show a leading status dot. */
  dot?: boolean;
};

/**
 * Tone-tinted rounded pill. Generalizes ConnectionStatus and the percent
 * badges in the contract lists into one consistent affordance.
 */
export default function StatusPill({
  tone = "neutral",
  dot = false,
  children,
  ...rest
}: StatusPillProps) {
  const s = toneStyles[tone];
  return (
    <Box
      display="inline-flex"
      alignItems="center"
      gap={1.5}
      bg={s.bg}
      color={s.color}
      px={2.5}
      py={1}
      borderRadius="full"
      fontSize="xs"
      fontWeight="semibold"
      lineHeight={1}
      whiteSpace="nowrap"
      {...rest}
    >
      {dot && (
        <Box as="span" boxSize="6px" borderRadius="full" bg={s.dot} flexShrink={0} />
      )}
      {children}
    </Box>
  );
}
