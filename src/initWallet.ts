import { connect } from "./client";
import {
  autoReseed,
  contractsUrl,
  hideMessages,
  mineToAddress,
  mintMessage,
  restApiUrl,
  servers,
  useIndexerApi,
  wallet,
} from "./signals";
import { createWallet, openWallet } from "./wallet";

// Server ordering matters for V2 (BLAKE3/K12) dMint contracts. ElectrumX
// just forwards `transaction.broadcast` to the node behind it; the script
// evaluator lives in that node. The radiantcore.org pair runs Radiant Core
// (consensus implementation with OP_BLAKE3 / OP_K12); the bladenet and
// radiant4people pair run the older Radiant-Node fork which treats those
// opcodes as no-ops and rejects every V2 mint with a misleading
// `SCRIPT_ERR_EQUALVERIFY`. Keeping Radiant Core servers at the top of the
// list ensures the primary broadcast attempt goes to a node that can
// actually validate the script. The fan-out in `broadcast()` covers the
// stragglers if the primary is down.
const defaultServers = [
  //"wss://electrumx-testnet.radiant4people.com:53002",
  "wss://electrumx.radiantcore.org:50011",
  "wss://radiantcore.org:50011",
  "wss://radiantus.bladenet.online:50022",
  "wss://electrumx.radiant4people.com:50022",
  "wss://radiant2.bladenet.online:50022",
  "wss://radiant4.bladenet.online:50022",
  "wss://electrumx2.radiant4people.com:50022",
];

console.debug("Init wallet");
wallet.value = openWallet() || createWallet();
mineToAddress.value = localStorage.getItem("mineToAddress") || "";
mintMessage.value = localStorage.getItem("mintMessage") || "";
hideMessages.value = localStorage.getItem("hideMessages") === "1";
contractsUrl.value =
  localStorage.getItem("contractsUrl") ||
  "/contracts.json";
// Default to using RXinDexer API (true unless explicitly disabled)
useIndexerApi.value = localStorage.getItem("useIndexerApi") !== "";
// Load RXinDexer REST API URL
restApiUrl.value = localStorage.getItem("restApiUrl") || "https://glyph-miner.com/api";

// autoReseed default: ON. Honor an explicit "0" to disable; treat anything
// else (including missing / legacy empty string) as enabled. The previous
// check (`!== ""`) inverted the convention so writing "0" silently failed
// to disable — kept as a fallback for legacy stored values.
{
  const stored = localStorage.getItem("autoReseed");
  if (stored === null) {
    autoReseed.value = true;
  } else if (stored === "0") {
    autoReseed.value = false;
  } else if (stored === "") {
    // Legacy form written by the old Settings UI; treat as disabled.
    autoReseed.value = false;
  } else {
    autoReseed.value = true;
  }
}

// If servers isn't saved then set to default servers in canonical order.
//
// On first run we seed the user's stored list with the defaults. On
// subsequent runs we respect the stored list as-is — we do NOT silently
// merge in any new defaults that the user previously removed, because that
// makes "remove server" stick for one session and reappear on the next.
// Users who want refreshed defaults can clear the entry from Settings or
// localStorage.
const storedServers = localStorage.getItem("servers");
if (storedServers) {
  try {
    const parsed: string[] = JSON.parse(storedServers);
    servers.value = Array.isArray(parsed) && parsed.length > 0
      ? parsed
      : defaultServers.slice();
  } catch {
    // Corrupt JSON in storage — fall back to defaults rather than crash.
    servers.value = defaultServers.slice();
  }
} else {
  // Deterministic order — first entries are Radiant Core nodes that
  // accept V2 BLAKE3/K12 dMint contracts. See defaultServers comment.
  servers.value = defaultServers.slice();
  localStorage.setItem("servers", JSON.stringify(servers.value));
}

connect();
