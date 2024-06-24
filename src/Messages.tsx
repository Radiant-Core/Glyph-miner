import { PropsWithChildren } from "react";
import { Box, Flex, Icon, Text } from "@chakra-ui/react";
import { GoSmiley } from "react-icons/go";
import { useSignals } from "@preact/signals-react/runtime";
import { gpu, hideMessages, messages } from "./signals";
import ShortId from "./ShortId";
import ShortRef from "./ShortRef";

function formatDuration(seconds: number) {
  if (seconds <= 60) {
    return `${seconds} seconds`;
  }
  const minutes = parseFloat((seconds / 60).toFixed(2));
  return `${minutes} minutes`;
}

function Id({ children }: PropsWithChildren) {
  return (
    <Text
      fontFamily="Source Code Pro Variable"
      color="chakra-body-text"
      bgColor="blackAlpha.400"
      as="span"
      px={1}
      py={1}
    >
      {children}
    </Text>
  );
}

function Msg({ children }: PropsWithChildren) {
  return children ? (
    <Text as="span" ml={2}>
      Message:{" "}
      <Text
        color="chakra-body-text"
        bgColor="blackAlpha.400"
        as="span"
        px={1}
        py={1}
      >
        {children}
      </Text>
    </Text>
  ) : null;
}

function Line({ children }: PropsWithChildren) {
  return (
    <Flex
      fontFamily="Source Code Pro Variable"
      gap={4}
      py={1}
      fontSize="medium"
      flexWrap={{ base: "wrap", md: "initial" }}
    >
      {children}
    </Flex>
  );
}

export default function Messages() {
  useSignals();

  return (
    <>
      {messages.value.map((m) => (
        <Line key={m.id}>
          <div>{m.date}</div>
          <Box wordBreak="break-all">
            {m.type === "found" && (
              <>
                Found nonce <Id>{m.nonce}</Id>
              </>
            )}
            {m.type === "accept" && (
              <>
                <Text
                  color="green.300"
                  bgGradient="linear(to-r, lightBlue.A400, lightGreen.A400)"
                  bgClip="text"
                  as="span"
                >
                  Tokens minted!{" "}
                </Text>
                <Icon
                  as={GoSmiley}
                  verticalAlign="middle"
                  boxSize={4}
                  color="lightGreen.A400"
                />{" "}
                <Id>
                  <ShortId id={m.txid} />
                </Id>
                <Msg>{m.msg.substring(0, 80)}</Msg>
              </>
            )}
            {m.type === "new-location" && (
              <>
                New contract received{" "}
                <Id>
                  <ShortId id={m.txid} />
                </Id>
                {hideMessages.value || <Msg>{m.msg}</Msg>}
              </>
            )}
            {m.type === "reject" && (
              <>
                Nonce rejected <Id>{m.nonce}</Id>
                {m.reason && <>({m.reason})</>}
              </>
            )}
            {m.type === "general" && m.msg}
            {m.type === "minted-out" && (
              <Text color="red.A200">
                Token{" "}
                <Id>
                  <ShortRef id={m.ref} />
                </Id>{" "}
                is minted out!
                {hideMessages || <Msg>{m.msg}</Msg>}
              </Text>
            )}
            {m.type === "not-found" && (
              <Text color="red.A200">
                No dmint contract found for{" "}
                <Id>
                  <ShortRef id={m.ref} />
                </Id>
              </Text>
            )}
            {m.type === "loaded" && (
              <>
                Contract{" "}
                <Id>
                  <ShortRef id={m.ref} />
                </Id>{" "}
                loaded
              </>
            )}
            {m.type === "mint-time" && (
              <>
                Estimated mint time on your {gpu.value || "GPU"} is{" "}
                {formatDuration(m.seconds)}
              </>
            )}
            {m.type === "start" && <>Mining started</>}
            {m.type === "stop" && <>Mining stopped</>}
          </Box>
        </Line>
      ))}
      <>
        {messages.value.length < 10 &&
          Array(10 - messages.value.length)
            .fill(null)
            .map((_, i) => <Line key={`${i}`}>&nbsp;</Line>)}
      </>
    </>
  );
}
