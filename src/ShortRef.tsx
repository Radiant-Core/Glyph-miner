import { Text } from "@chakra-ui/react";
import { Buffer } from "buffer";

export default function ShortRef({
  id,
  bigEndian = true,
  omitVout = false,
}: {
  id: string;
  bigEndian?: boolean;
  omitVout?: boolean;
}) {
  const buf = Buffer.from(id.substring(64), "hex");
  if (!bigEndian) {
    buf.reverse();
  }
  const vout = buf.readUInt32BE(0);
  return (
    <Text fontFamily="Source Code Pro Variable, sans-serif" as="span">
      {id.substring(0, 4)}&middot;{id.substring(60, 64)}
      {omitVout ? "" : <>&middot;{vout}</>}
    </Text>
  );
}
