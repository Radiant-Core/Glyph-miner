import { Buffer } from "buffer";

export default function ShortRef({
  id,
  bigEndian = true,
}: {
  id: string;
  bigEndian?: boolean;
}) {
  const buf = Buffer.from(id.substring(64), "hex");
  if (!bigEndian) {
    buf.reverse();
  }
  const vout = buf.readUInt32BE(0);
  return (
    <>
      {id.substring(0, 4)}&middot;{id.substring(60, 64)}&middot;{vout}
    </>
  );
}
