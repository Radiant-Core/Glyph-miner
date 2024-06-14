import { useSignals } from "@preact/signals-react/runtime";
import { rejected } from "./signals";

export default function Rejected() {
  useSignals();

  return rejected.value;
}
