import { signal } from "@preact/signals-react";
import { ElectrumWS } from "ws-electrumx-client";
import miner from "./miner";
import { miningEnabled, miningStatus, servers } from "./signals";
import { subscribeToAddress } from "./blockchain";
import { Transaction } from "@radiantblockchain/radiantjs";
import localforage from "localforage";

export enum ServerStatus {
  DISCONNECTED,
  CONNECTING,
  CONNECTED,
}
export const serverStatus = signal(ServerStatus.DISCONNECTED);
export let client: ElectrumWS;
type Timeout = ReturnType<typeof setTimeout>;

let serverNum = 0;
let autoStopTimer: Timeout;
let autoReconnectTimer: Timeout;
let connectionTimer: Timeout;
let didAutoStop = false;

function startConnectionTimer() {
  clearTimeout(connectionTimer);
  connectionTimer = setTimeout(() => {
    client?.close("");
  }, 10000);
}

function startAutoReconnectTimer() {
  if (!autoReconnectTimer) {
    autoReconnectTimer = setTimeout(() => {
      // Try the next server
      serverNum = (serverNum + 1) % servers.value.length;
      console.debug("Attempting to reconnect");
      connect();
    }, 10000);
  }
}

export async function connect(newServerList = false) {
  if (newServerList) {
    serverNum = 0;
  }

  await miner.stop();

  if (client?.isConnected()) {
    client.close("");
  }

  const server = servers.value[serverNum];
  client = new ElectrumWS(server);
  console.debug(`Connecting to ${server}`);
  startConnectionTimer();
  client.on("connected", () => {
    clearTimeout(connectionTimer);
    console.debug(`Connected to ${server}`);
    serverStatus.value = ServerStatus.CONNECTED;
    clearTimeout(autoStopTimer);
    clearTimeout(autoReconnectTimer);
    autoStopTimer = 0 as unknown as Timeout;
    autoReconnectTimer = 0 as unknown as Timeout;

    if (didAutoStop && miningEnabled.value) {
      miner.start();
    }

    didAutoStop = false;
  });
  client.on("close", () => {
    console.debug("Close");
    serverStatus.value = ServerStatus.DISCONNECTED;
    // If mining, wait for 10 seconds before auto stopping
    if (miningStatus.value !== "ready") {
      if (!autoStopTimer) {
        autoStopTimer = setTimeout(() => {
          console.debug("Auto stopped miner");
          didAutoStop = true;
          miner.stop();
          startAutoReconnectTimer();
        }, 10000);
      }
    } else {
      // Not mining, so start auto reconnect timer immediately
      startAutoReconnectTimer();
    }
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

export async function broadcast(hex: string) {
  return await client.request("blockchain.transaction.broadcast", hex);
}
