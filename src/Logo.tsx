import { Icon, Text } from "@chakra-ui/react";
import { TbDiamond } from "react-icons/tb";

export default function Logo() {
  return (
    <>
      <Icon
        as={TbDiamond}
        boxSize={6}
        color="lightGreen.A400"
        filter="blur(7px)"
        animation="glow 800ms ease-out"
        zIndex={0}
      />
      <Icon
        ml={-6}
        as={TbDiamond}
        mr={1}
        boxSize={6}
        zIndex={1}
        color="lightGreen.A200"
      />
      <Text
        fontFamily="Days One, sans-serif"
        as="div"
        fontSize="medium"
        userSelect="none"
      >
        GLYPH MINER
      </Text>
    </>
  );
}
