import { Icon, Text } from "@chakra-ui/react";
import { TbDiamond } from "react-icons/tb";

export default function Logo() {
  return (
    <>
      <Icon
        as={TbDiamond}
        boxSize={6}
        color="accent.fg"
        filter="blur(3px)"
        opacity={0.6}
        animation="glow 800ms ease-out"
        zIndex={0}
      />
      <Icon
        ml={-6}
        as={TbDiamond}
        mr={2}
        boxSize={6}
        zIndex={1}
        color="accent.fg"
      />
      <Text
        fontFamily="Days One, sans-serif"
        as="div"
        fontSize="medium"
        letterSpacing="0.02em"
        color="text.primary"
        userSelect="none"
      >
        GLYPH MINER
      </Text>
    </>
  );
}
