import { connect } from "./client";
import {
  contractsUrl,
  hideMessages,
  mineToAddress,
  mintMessage,
  servers,
  useIndexerApi,
  wallet,
} from "./signals";
import { shuffle } from "./utils";
import { createWallet, openWallet } from "./wallet";

const defaultServers = [
  //"wss://electrumx-testnet.radiant4people.com:53002",
  "wss://82.180.136.182:50004",
  "wss://radiantus.bladenet.online:50022",
  "wss://electrumx.radiant4people.com:50022",
  "wss://radiant2.bladenet.online:50022",
  "wss://radiant4.bladenet.online:50022",
  "wss://electrumx2.radiant4people.com:50022",
  "wss://radiantcore.org:50004",
];

console.debug("Init wallet");
wallet.value = openWallet() || createWallet();
mineToAddress.value = localStorage.getItem("mineToAddress") || "";
mintMessage.value = localStorage.getItem("mintMessage") || "";
hideMessages.value = localStorage.getItem("hideMessages") === "1";
contractsUrl.value =
  localStorage.getItem("contractsUrl") ||
  "https://glyph-miner.com/contracts.json";
// Default to using RXinDexer API (true unless explicitly disabled)
useIndexerApi.value = localStorage.getItem("useIndexerApi") !== "";

// If servers isn't saved then set to default servers, randomly sorted
const storedServers = localStorage.getItem("servers");
servers.value = storedServers
  ? JSON.parse(storedServers)
  : shuffle(defaultServers);

connect();
