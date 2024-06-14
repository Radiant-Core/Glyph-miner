import { useSignals } from "@preact/signals-react/runtime";
import { hashrate } from "./signals";

const fixed = (n: number) => n.toFixed(2);

export default function Hashrate() {
  useSignals();
  const value = hashrate.value;

  if (value > 1000000000) {
    return `${fixed(value / 1000000000)} Gh/s`;
  } else if (value > 1000000) {
    return `${fixed(value / 1000000000)} Mh/s`;
  } else if (value > 1000) {
    return `${fixed(value / 1000000000)} Kh/s`;
  }
  return `${fixed(value)} H/s`;
}
