import { ReactNode } from "react";
import { Flex, Icon, Text } from "@chakra-ui/react";
import { IconType } from "react-icons";

type EmptyStateProps = {
  icon?: IconType;
  title: ReactNode;
  description?: ReactNode;
  /** Optional call-to-action (typically a Button). */
  action?: ReactNode;
};

/**
 * Standardized centered empty / onboarding block. Replaces the ad-hoc empty
 * markup on the Miner page (no-GPU, not-configured) and the lists.
 */
export default function EmptyState({
  icon,
  title,
  description,
  action,
}: EmptyStateProps) {
  return (
    <Flex
      direction="column"
      align="center"
      textAlign="center"
      py={{ base: 12, md: 16 }}
      px={4}
      gap={3}
    >
      {icon && <Icon as={icon} boxSize={12} color="text.muted" />}
      <Text fontSize="lg" fontWeight="semibold" color="text.primary">
        {title}
      </Text>
      {description && (
        <Text fontSize="sm" color="text.muted" maxW="md">
          {description}
        </Text>
      )}
      {action && <Flex mt={2}>{action}</Flex>}
    </Flex>
  );
}
