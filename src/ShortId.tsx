import { Text } from "@chakra-ui/react";

export default function ShortId({ id }: { id: string }) {
  return (
    <Text fontFamily="Source Code Pro Variable, sans-serif" as="span">
      {id.substring(0, 4)}&middot;{id.substring(id.length - 4)}
    </Text>
  );
}
