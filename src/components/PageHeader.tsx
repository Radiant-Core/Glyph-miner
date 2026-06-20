import { ReactNode } from "react";
import { Box, Container, Flex, Heading, Text } from "@chakra-ui/react";

type PageHeaderProps = {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Right-aligned action slot (buttons / icon buttons). */
  children?: ReactNode;
};

/**
 * The sticky page header bar shared by the list and settings routes. Extracts
 * the duplicated `bg.300 + Container + Flex + Heading + actions` pattern.
 */
export default function PageHeader({
  title,
  subtitle,
  children,
}: PageHeaderProps) {
  return (
    <Box
      bg="surface.inset"
      borderBottom="1px solid"
      borderBottomColor="border.subtle"
      position="sticky"
      top={0}
      zIndex={2}
      backdropFilter="blur(12px)"
    >
      <Container maxW="container.lg">
        <Flex
          align="center"
          justify="space-between"
          gap={3}
          minH={{ base: "60px", md: "72px" }}
          py={3}
        >
          <Box minW={0}>
            <Heading as="h1" size="md" noOfLines={1}>
              {title}
            </Heading>
            {subtitle && (
              <Text fontSize="sm" color="text.muted" noOfLines={1}>
                {subtitle}
              </Text>
            )}
          </Box>
          <Flex align="center" gap={2} flexShrink={0}>
            {children}
          </Flex>
        </Flex>
      </Container>
    </Box>
  );
}
