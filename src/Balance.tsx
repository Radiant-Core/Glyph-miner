import { useSignals } from "@preact/signals-react/runtime";
import { photonsToRXD } from "./utils";
import { balance } from "./signals";

export default function Balance() {
  useSignals();
  return photonsToRXD(balance.value);
}
