import { BoxProps } from "@chakra-ui/react";
import { useSignals } from "@preact/signals-react/runtime";
import { ServerStatus, serverStatus } from "./client";
import StatusPill, { PillTone } from "./components/StatusPill";

const statusMap: Record<ServerStatus, { tone: PillTone; text: string }> = {
  [ServerStatus.CONNECTED]: { tone: "positive", text: "Connected" },
  [ServerStatus.DISCONNECTED]: { tone: "negative", text: "Disconnected" },
  [ServerStatus.CONNECTING]: { tone: "warning", text: "Connecting" },
};

export default function ConnectionStatus(props: BoxProps) {
  useSignals();
  const status = statusMap[serverStatus.value];
  return (
    <StatusPill tone={status.tone} dot {...props}>
      {status.text}
    </StatusPill>
  );
}
