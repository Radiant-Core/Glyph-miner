import { computed, effect, signal } from "@preact/signals-react";
import { Contract, Glyph, Message, Utxo, Wallet } from "./types";
import { calcTimeToMine, createWork } from "./pow";
import { addMessage } from "./message";

export const messages = signal<Message[]>([]);
export const hashrate = signal(0);
export const found = signal(0);
export const accepted = signal(0);
export const rejected = signal(0);
export const wallet = signal<Wallet | undefined>(undefined);
export const balance = signal(0);
export const utxos = signal<Utxo[]>([]);
export const gpu = signal<string | undefined>(""); // undefined means unsupported
export const mineToAddress = signal("");
export const mintMessage = signal("");
export const hideMessages = signal(false);
export const selectedContract = signal("");
export const contract = signal<Contract | undefined>(undefined);
export const contractsUrl = signal("");
export const glyph = signal<Glyph | undefined>(undefined);
export const work = computed(() => {
  if (!contract.value || !wallet.value?.address) return;
  return createWork(contract.value, wallet.value.address);
});
export const miningStatus = signal<"stop" | "change" | "mining" | "ready">(
  "ready"
);
export const nonces = signal<string[]>([]);

let timer = 0;
let done = false;

effect(() => {
  if (done) return;
  if (miningStatus.value === "mining") {
    timer = window.setTimeout(() => {
      if (contract.value) {
        done = true;
        addMessage({
          type: "mint-time",
          seconds: calcTimeToMine(contract.value.target, hashrate.value),
        });
      }
    }, 10000);
  } else {
    clearTimeout(timer);
  }
});
