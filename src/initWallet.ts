import { connect } from "./client";
import {
  contractsUrl,
  hideMessages,
  mineToAddress,
  mintMessage,
  servers,
  wallet,
} from "./signals";
import { shuffle } from "./utils";
import { createWallet, openWallet } from "./wallet";

const defaultMessages = [
  "The future is Radiant 😎",
  "Radiance 🌄",
  "Radiate 🌞",
];

const defaultServers = [
  //"wss://electrumx-testnet.radiant4people.com:53002",
  "wss://electrumx.radiant4people.com:50022",
  "wss://electrumx2.radiant4people.com:50022",
];

console.debug("Init wallet");
wallet.value = openWallet() || createWallet();
mineToAddress.value = localStorage.getItem("mineToAddress") || "";
mintMessage.value = localStorage.getItem("mintMessage") || "";
hideMessages.value = localStorage.getItem("hideMessages") === "1";
contractsUrl.value =
  localStorage.getItem("contractsUrl") ||
  "https://glyph.radiant4people.com/contracts.json";

// If servers isn't saved then set to default servers, randomly sorted
const storedServers = localStorage.getItem("servers");
servers.value = storedServers
  ? JSON.parse(storedServers)
  : shuffle(defaultServers);

connect();
