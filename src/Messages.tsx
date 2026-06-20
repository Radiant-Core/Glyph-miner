import { PropsWithChildren } from "react";
import { Box, Flex, Icon, Text } from "@chakra-ui/react";
import { GoSmiley } from "react-icons/go";
import { useSignals } from "@preact/signals-react/runtime";
import { gpu, hideMessages, messages } from "./signals";
import ShortId from "./ShortId";
import ShortRef from "./ShortRef";
import MonoTag from "./components/MonoTag";

function formatDuration(seconds: number) {
  if (seconds <= 60) {
    return `${seconds} seconds`;
  }
  const minutes = parseFloat((seconds / 60).toFixed(2));
  return `${minutes} minutes`;
}

function Msg({ children }: PropsWithChildren) {
  return children ? (
    <Text as="span" ml={2} color="text.secondary">
      Message: <MonoTag>{children}</MonoTag>
    </Text>
  ) : null;
}

function Line({ children }: PropsWithChildren) {
  return (
    <Flex
      fontFamily="ono"
      gap={4}
      py={1}
      fontSize="sm"
      color="text.secondary"
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
          <Box color="text.muted" flexShrink={0}>
            {m.date}
          </Box>
          <Box wordBreak="break-all">
            {m.type === "found" && (
              <>
                Found nonce <MonoTag>{m.nonce}</MonoTag>
              </>
            )}
            {m.type === "accept" && (
              <>
                <Text as="span" color="positive.fg" fontWeight="semibold">
                  Tokens minted!{" "}
                </Text>
                <Icon
                  as={GoSmiley}
                  verticalAlign="middle"
                  boxSize={4}
                  color="accent.fg"
                />{" "}
                <MonoTag>
                  <ShortId id={m.txid} />
                </MonoTag>
                <Msg>{m.msg.substring(0, 80)}</Msg>
              </>
            )}
            {m.type === "new-location" && (
              <>
                New contract received{" "}
                <MonoTag>
                  <ShortId id={m.txid} />
                </MonoTag>
                {hideMessages.value || <Msg>{m.msg}</Msg>}
              </>
            )}
            {m.type === "reject" && (
              <Text as="span" color="negative.fg">
                Nonce rejected <MonoTag>{m.nonce}</MonoTag>
                {m.reason && <>({m.reason})</>}
              </Text>
            )}
            {m.type === "general" && m.msg}
            {m.type === "minted-out" && (
              <Text as="span" color="negative.fg">
                Token{" "}
                <MonoTag>
                  <ShortRef id={m.ref} />
                </MonoTag>{" "}
                is minted out!
                {hideMessages || <Msg>{m.msg}</Msg>}
              </Text>
            )}
            {m.type === "not-found" && (
              <Text as="span" color="negative.fg">
                No dmint contract found for{" "}
                <MonoTag>
                  <ShortRef id={m.ref} />
                </MonoTag>
              </Text>
            )}
            {m.type === "loaded" && (
              <>
                Contract{" "}
                <MonoTag>
                  <ShortRef id={m.ref} />
                </MonoTag>{" "}
                loaded
              </>
            )}
            {m.type === "mint-time" && (
              <>
                Estimated mint time on your {gpu.value || "GPU"} is{" "}
                {formatDuration(m.seconds)}
              </>
            )}
            {m.type === "start" && (
              <Text as="span" color="positive.fg">
                Mining started
              </Text>
            )}
            {m.type === "stop" && (
              <>Mining stopped{m.reason ? <> — {m.reason}</> : null}</>
            )}
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
