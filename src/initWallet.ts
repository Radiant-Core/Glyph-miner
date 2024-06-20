import {
  contractsUrl,
  hideMessages,
  mineToAddress,
  mintMessage,
  wallet,
} from "./signals";
import { createWallet, openWallet } from "./wallet";

console.debug("Init wallet");
wallet.value = openWallet() || createWallet();
mineToAddress.value = localStorage.getItem("mineToAddress") || "";
mintMessage.value =
  localStorage.getItem("mintMessage") || "The future is Radiant 😎";
hideMessages.value = localStorage.getItem("hideMessages") === "1";
contractsUrl.value =
  localStorage.getItem("contractsUrl") ||
  "https://glyph.radiant4people.com/contracts.json";
