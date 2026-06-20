import { ReactNode } from "react";
import { Box, Flex, Icon, Link as ChakraLink, Text } from "@chakra-ui/react";
import { Link } from "react-router-dom";
import { CheckCircleIcon, WarningTwoIcon } from "@chakra-ui/icons";
import Panel from "./Panel";

export type ChecklistItem = {
  ok: boolean;
  label: ReactNode;
  /** Secondary explanatory text shown under the label when failing. */
  hint?: ReactNode;
  /** Optional in-app route to resolve the failing condition. */
  to?: string;
  toLabel?: string;
};

type ReadinessChecklistProps = {
  /** Mirrors `canStart` — when true the checklist collapses to a ready line. */
  ready: boolean;
  items: ChecklistItem[];
};

/**
 * Explains WHY the Start button is disabled by rendering each `canStart`
 * sub-condition as a pass/fail row. Purely presentational: the booleans are
 * computed once in Miner.tsx (alongside `canStart`) and passed in, so the
 * gating logic is never forked.
 */
export default function ReadinessChecklist({
  ready,
  items,
}: ReadinessChecklistProps) {
  if (ready) {
    return (
      <Panel mt={3} display="flex" alignItems="center" gap={2}>
        <Icon as={CheckCircleIcon} color="positive.fg" boxSize={5} />
        <Text fontWeight="semibold" color="text.primary">
          Ready to mine
        </Text>
        <Text fontSize="sm" color="text.muted">
          — press Start mining
        </Text>
      </Panel>
    );
  }

  return (
    <Panel mt={3}>
      <Text
        fontSize="xs"
        fontWeight="bold"
        letterSpacing="wider"
        textTransform="uppercase"
        color="text.muted"
        mb={3}
      >
        Before you can start mining
      </Text>
      <Flex direction="column" gap={2.5}>
        {items.map((item, i) => (
          <Flex key={i} align="flex-start" gap={3}>
            <Icon
              as={item.ok ? CheckCircleIcon : WarningTwoIcon}
              color={item.ok ? "positive.fg" : "warning"}
              boxSize={4}
              mt="2px"
              flexShrink={0}
            />
            <Box flex={1} minW={0}>
              <Text
                fontSize="sm"
                color={item.ok ? "text.secondary" : "text.primary"}
                fontWeight={item.ok ? "normal" : "medium"}
              >
                {item.label}
              </Text>
              {!item.ok && item.hint && (
                <Text fontSize="xs" color="text.muted" mt={0.5}>
                  {item.hint}
                </Text>
              )}
            </Box>
            {!item.ok && item.to && (
              <ChakraLink
                as={Link}
                to={item.to}
                fontSize="sm"
                fontWeight="semibold"
                color="accent.fg"
                flexShrink={0}
              >
                {item.toLabel || "Fix"}
              </ChakraLink>
            )}
          </Flex>
        ))}
      </Flex>
    </Panel>
  );
}
