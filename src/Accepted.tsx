import { useSignals } from "@preact/signals-react/runtime";
import { accepted } from "./signals";

export default function Accepted() {
  useSignals();

  return accepted.value;
}
