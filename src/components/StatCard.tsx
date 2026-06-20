import { Box, Flex, Icon, Text } from "@chakra-ui/react";
import { IconType } from "react-icons";
import { ReactNode } from "react";
import Panel from "./Panel";

export type StatTone = "neutral" | "positive" | "negative" | "accent";

const toneColor: Record<StatTone, string> = {
  neutral: "text.primary",
  positive: "positive.fg",
  negative: "negative.fg",
  accent: "accent.fg",
};

type StatCardProps = {
  label: string;
  /** Already-formatted value. Caller may pass a signal-reading component. */
  value: ReactNode;
  icon?: IconType;
  tone?: StatTone;
  /** Optional secondary slot under the value (unit, sparkline, etc.). */
  sub?: ReactNode;
};

/**
 * A compact dashboard metric tile: muted uppercase label + large value, with an
 * optional icon and a secondary slot. The new home for Hashrate / Accepted /
 * Rejected / Balance on the Miner page.
 */
export default function StatCard({
  label,
  value,
  icon,
  tone = "neutral",
  sub,
}: StatCardProps) {
  return (
    <Panel padded={false} p={{ base: 3, md: 4 }}>
      <Flex align="flex-start" justify="space-between" gap={2}>
        <Text
          fontSize="xs"
          fontWeight="bold"
          letterSpacing="wider"
          textTransform="uppercase"
          color="text.muted"
        >
          {label}
        </Text>
        {icon && <Icon as={icon} boxSize={4} color="text.muted" />}
      </Flex>
      <Text
        mt={1}
        fontSize={{ base: "xl", md: "2xl" }}
        fontWeight="bold"
        lineHeight={1.2}
        color={toneColor[tone]}
        wordBreak="break-word"
      >
        {value}
      </Text>
      {sub && (
        <Box mt={2} color="text.muted" fontSize="xs">
          {sub}
        </Box>
      )}
    </Panel>
  );
}
