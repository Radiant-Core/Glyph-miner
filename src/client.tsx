import { signal } from "@preact/signals-react";
import { ElectrumWS } from "ws-electrumx-client";
import miner from "./miner";
import { miningEnabled, servers } from "./signals";
import { recoverFromError, subscribeToAddress } from "./blockchain";
import { Transaction } from "@radiant-core/radiantjs";
import localforage from "localforage";
import { addMessage } from "./message";
import { resetApiCache } from "./deployments";
import { resetDmintApiState } from "./dmint-api";

export enum ServerStatus {
  DISCONNECTED,
  CONNECTING,
  CONNECTED,
}
export const serverStatus = signal(ServerStatus.DISCONNECTED);
export let client: ElectrumWS;
type Timeout = ReturnType<typeof setTimeout>;
type Interval = ReturnType<typeof setInterval>;

let serverNum = 0;
let autoStopTimer: Timeout;
let autoReconnectTimer: Timeout;
let connectionTimer: Timeout;
let connectAttemptCounter = 0;

function startConnectionTimer() {
  clearTimeout(connectionTimer);
  connectionTimer = setTimeout(() => {
    console.debug("Connection timed out");
    onClose(false);
  }, 10000);
}

function startAutoReconnectTimer() {
  if (!autoReconnectTimer) {
    const allServersAttempted =
      connectAttemptCounter > 0 &&
      connectAttemptCounter % servers.value.length === 0;
    // Jitter the reconnect (±25%) so a fleet of miners that all lost the same
    // server don't reconnect in lockstep and hammer the indexer the instant it
    // comes back — the same thundering-herd that pinned the public indexer.
    const baseDelay = allServersAttempted ? 120000 : 10000;
    const delay = Math.round(baseDelay * (0.75 + Math.random() * 0.5));
    autoReconnectTimer = setTimeout(() => {
      // Try the next server
      serverNum = (serverNum + 1) % servers.value.length;
      console.debug("Attempting to reconnect");
      connect();
    }, delay);
  }
}

let heartbeatInterval: Interval;
async function heartbeat() {
  const n = serverNum;
  const pong = await Promise.race([
    client.request("server.ping"),
    new Promise((resolve) => {
      // Time out after 10 seconds
      setTimeout(() => resolve(false), 10000);
    }),
  ]);

  // If server changed while waiting for a response then discard this heartbeat
  if (n !== serverNum) {
    return;
  }

  // This happens if the network connection is lost
  // If the server is down then the close function will be called instead
  // Close will also be called when network connection is reestablished
  if (pong !== null && serverStatus.value != ServerStatus.DISCONNECTED) {
    addMessage({
      type: "general",
      msg: "Connection lost, waiting to reconnect",
    });
    serverStatus.value = ServerStatus.DISCONNECTED;
    addMessage({ type: "stop" });
    miner.stop();
  }

  if (pong === null && serverStatus.value === ServerStatus.DISCONNECTED) {
    serverStatus.value = ServerStatus.CONNECTED;
    if (miningEnabled.value) {
      recoverFromError();
    }
  }
}

function onClose(wasClean: boolean) {
  console.debug("Close");
  clearTimeout(connectionTimer);
  clearTimeout(autoReconnectTimer);
  connectionTimer = 0 as unknown as Timeout;
  autoReconnectTimer = 0 as unknown as Timeout;
  if (!wasClean) {
    connectAttemptCounter++;

    if (connectAttemptCounter >= servers.value.length) {
      addMessage({
        type: "general",
        msg: "All servers unresponsive, waiting to reconnect",
      });
    } else {
      addMessage({
        type: "general",
        msg: "Server disconnected, waiting to reconnect",
      });
    }
  }
  serverStatus.value = ServerStatus.DISCONNECTED;
  if (miningEnabled.value) {
    // If mining, wait for 10 seconds before auto stopping
    if (!autoStopTimer) {
      autoStopTimer = setTimeout(() => {
        console.debug("Auto stopped miner");
        miner.stop();
        addMessage({ type: "stop" });
        startAutoReconnectTimer();
      }, 10000);
    }
  } else {
    // Not mining, so start auto reconnect timer immediately
    startAutoReconnectTimer();
  }
}

export async function connect(newServerList = false) {
  if (newServerList) {
    serverNum = 0;
  }

  // Reset API cache when connecting to a new server
  resetApiCache();
  resetDmintApiState();

  await miner.stop();

  if (client?.isConnected()) {
    client.close("");
  }

  const server = servers.value[serverNum];
  client = new ElectrumWS(server);
  console.debug(`Connecting to ${server}`);
  startConnectionTimer();
  client.on("disconnected", () => {
    console.debug("Disconnected");
  });
  client.on("connected", () => {
    connectAttemptCounter = 0;
    clearTimeout(connectionTimer);
    clearInterval(heartbeatInterval);
    connectionTimer = 0 as unknown as Timeout;
    heartbeatInterval = 0 as unknown as Interval;
    // Check connection is alive every 30 seconds
    heartbeatInterval = setInterval(heartbeat, 30000);
    console.debug(`Connected to ${server}`);
    addMessage({
      type: "general",
      msg: `Connected to ${server}`,
    });
    serverStatus.value = ServerStatus.CONNECTED;
    clearTimeout(autoStopTimer);
    clearTimeout(autoReconnectTimer);
    autoStopTimer = 0 as unknown as Timeout;
    autoReconnectTimer = 0 as unknown as Timeout;

    if (miningEnabled.value) {
      // Resubscribe to everything and restart mining
      recoverFromError();
    }
  });
  client.on("close", (event) => {
    console.log("Close event received");
    onClose((event as CloseEvent).wasClean);
  });

  serverStatus.value = ServerStatus.CONNECTING;

  subscribeToAddress();
}

export async function fetchTx(txid: string, fresh: boolean) {
  const cached = fresh ? undefined : await localforage.getItem<string>(txid);
  if (cached) {
    return new Transaction(cached);
  }
  const hex = await client.request("blockchain.transaction.get", txid);
  localforage.setItem(txid, hex);
  return new Transaction(hex);
}

export async function fetchRef(ref: string) {
  const ids = (await client.request("blockchain.ref.get", ref)) as {
    tx_hash: string;
  }[];
  if (ids.length) {
    return [ids[0], ids[ids.length - 1]];
  }
  return [];
}

// V2 BLAKE3/K12 dMint contracts are rejected by Radiant-Node-backed Electrum
// servers (e.g. bladenet, radiant4people) because that fork doesn't implement
// OP_BLAKE3/OP_K12 — the half-evaluated script then trips a downstream
// EQUALVERIFY and the user sees a misleading "contract execution failed" log
// even though the transaction is valid per Radiant Core consensus.
//
// `broadcast` first tries the currently-connected server (fast path; matches
// the pre-fix behavior for V1 contracts and any non-V2 broadcast). If that
// rejects, it fans out to the remaining configured servers in parallel via
// short-lived WebSocket connections and treats the first successful submission
// as authoritative — once any node accepts the tx, it propagates through
// mempool gossip regardless of which front-end was used. All per-server
// rejections are logged to the console for debugging but only the
// "no server accepted" case bubbles up to the UI as a hard error.
export async function broadcast(hex: string) {
  console.debug("Broadcasting transaction, length:", hex.length);
  const primary = servers.value[serverNum];

  try {
    const result = await client.request("blockchain.transaction.broadcast", hex);
    console.debug(`Broadcast accepted by primary ${primary}:`, result);
    return result;
  } catch (primaryErr) {
    console.warn(`Primary server ${primary} rejected broadcast:`, primaryErr);

    const others = servers.value.filter((s) => s !== primary);
    if (others.length === 0) {
      throw primaryErr;
    }

    addMessage({
      type: "general",
      msg: `Primary broadcast rejected; trying ${others.length} other server${others.length === 1 ? "" : "s"}...`,
    });

    const result = await broadcastFanOut(hex, others);
    if (result.ok) {
      addMessage({
        type: "general",
        msg: `Broadcast accepted by ${result.server} (primary disagreed — likely stale node behind ${primary})`,
      });
      return result.txid;
    }

    // All servers disagree with the primary too — surface the primary error
    // since that's the most useful signal (matches the previous behavior).
    throw primaryErr;
  }
}

interface FanOutResult {
  ok: boolean;
  txid?: string;
  server?: string;
}

async function broadcastFanOut(hex: string, urls: string[]): Promise<FanOutResult> {
  // Each attempt is wrapped in a self-resolving Promise so Promise.race can
  // surface the first success without short-circuiting the others (we want
  // their console diagnostics even after a winner is declared).
  let winner: FanOutResult | undefined;
  const attempts = urls.map(
    (url) =>
      new Promise<FanOutResult>((resolve) => {
        attemptBroadcastOnServer(url, hex)
          .then((txid) => {
            if (!winner) winner = { ok: true, txid, server: url };
            resolve({ ok: true, txid, server: url });
          })
          .catch((err) => {
            console.warn(`Server ${url} rejected broadcast:`, err);
            resolve({ ok: false });
          });
      })
  );

  const results = await Promise.all(attempts);
  return results.find((r) => r.ok) || winner || { ok: false };
}

function attemptBroadcastOnServer(url: string, hex: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const transient = new ElectrumWS(url);
    const cleanup = () => {
      try {
        transient.close("");
      } catch {
        // best effort
      }
    };

    // Hard cap: don't let a single hanging server slow the user down.
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`broadcast timeout on ${url}`));
    }, 15000);

    transient.on("connected", async () => {
      try {
        const txid = (await transient.request(
          "blockchain.transaction.broadcast",
          hex
        )) as string;
        clearTimeout(timeout);
        cleanup();
        resolve(txid);
      } catch (err) {
        clearTimeout(timeout);
        cleanup();
        reject(err);
      }
    });

    transient.on("close", () => {
      // If close fires before connected (connection refused, TLS error),
      // surface that as a rejection so Promise.race can move on.
      clearTimeout(timeout);
      // No-op if we already resolved/rejected.
      reject(new Error(`connection closed before broadcast on ${url}`));
    });
  });
}
