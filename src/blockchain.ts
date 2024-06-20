import localforage from "localforage";
import {
  base58AddressToLockingBytecode,
  bigIntToVmNumber,
  encodeDataPush,
  numberToBinUint32LEClamped,
  Opcodes,
  pushNumberOpcodeToNumber,
  swapEndianness,
  vmNumberToBigInt,
} from "@bitauth/libauth";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { ElectrumWS } from "ws-electrumx-client";
import { Script, Transaction } from "@radiantblockchain/radiantjs";
import type { Contract, Token, Utxo, Work } from "./types";
import { decodeGlyph } from "./glyph";
import {
  accepted,
  balance,
  contract,
  contractsUrl,
  glyph,
  mineToAddress,
  miningStatus,
  mintMessage,
  nonces,
  rejected,
  utxos,
  wallet,
  work,
} from "./signals";
import { effect, signal, untracked } from "@preact/signals-react";
import { addMessage } from "./message";
import { mintMessageScript } from "./pow";
import miner from "./miner";
import { Buffer } from "buffer";
import { reverseRef } from "./utils";

const FEE_PER_KB = 5000000;

export function scriptHash(bytecode: Uint8Array): string {
  return swapEndianness(bytesToHex(sha256(bytecode)));
}

export enum ServerStatus {
  DISCONNECTED,
  CONNECTING,
  CONNECTED,
}
export const server = signal(
  localStorage.getItem("server") ||
    //"wss://electrumx-testnet.radiant4people.com:53002",
    "wss://electrumx.radiant4people.com:50022",
);
export const status = signal(ServerStatus.DISCONNECTED);
let client: ElectrumWS;

// Reconnect when server is changed
effect(async () => {
  console.debug("effect: reconnect");
  untracked(async () => await miner.stop());

  client = new ElectrumWS(server.value);
  client.on("connected", () => {
    status.value = ServerStatus.CONNECTED;
  });
  client.on("close", () => {
    status.value = ServerStatus.DISCONNECTED;
  });

  status.value = ServerStatus.CONNECTING;

  untracked(() => subscribeToAddress());
});

// Subscriptions will be created when wallet signal changes
effect(() => {
  console.debug("effect: subscribe to address");
  const address = wallet.value?.address || "";
  if (!address && client.isConnected()) {
    client.close("");
    return;
  }

  subscribeToAddress();
});

// Consume nonces signal
effect(() => {
  if (nonces.value.length > 0) {
    const values = nonces.value;
    nonces.value = [];
    blockchain.found(values);
  }
});

async function parseContractTx(tx: Transaction, ref: string) {
  const stateScripts: [number, string][] = [];
  const burns: string[] = [];
  const messages: string[] = [];

  tx.outputs.forEach((o, i) => {
    const hex = o.script.toHex();
    const dmint = parseDmintScript(hex);
    if (dmint) {
      return stateScripts.push([i, dmint]);
    }

    const burn = parseBurnScript(hex);
    if (burn) {
      if (burn === ref) {
        burns.push(burn);
      }
      return;
    }

    const msg = parseMessageScript(hex);
    if (msg) {
      // Truncate messages to 80 characters
      messages.push(msg.substring(0, 80));
    }
  });

  const message = messages[0] || "";

  // State script:
  // height OP_PUSHINPUTREF contractRef OP_PUSHINPUTREF tokenRef maxHeight reward target
  const contracts = stateScripts
    .map(([outputIndex, script]) => {
      const opcodes = Script.fromHex(script).toASM().split(" ");
      const [op1, contractRef] = opcodes.splice(1, 2);
      const [op2, tokenRef] = opcodes.splice(1, 2);

      if (
        op1 !== "OP_PUSHINPUTREFSINGLETON" ||
        op2 !== "OP_PUSHINPUTREF" ||
        contractRef !== ref
      ) {
        return;
      }

      const numbers = opcodes.map(opcodeToNum).filter((v) => v !== false);
      if (numbers.length < 4) {
        return;
      }

      const [height, maxHeight, reward, target] = numbers as bigint[];
      return {
        state: "active",
        params: {
          location: tx.id,
          outputIndex,
          height,
          contractRef,
          tokenRef,
          maxHeight,
          reward,
          target,
          script,
          message,
        },
      };
    })
    .filter(Boolean) as { state: "active"; params: Contract }[];

  if (!contracts.length) {
    if (burns.length) {
      return {
        state: "burn" as const,
        ref,
        params: { message },
      };
    }
    console.debug("dmint contract not found");
    return;
  }

  return contracts[0];
}

async function fetchToken(contractRef: string) {
  if (!contractRef.match(/^[0-9a-f]{64}[0-9a-f]{8}$/)) {
    console.debug("Not a ref");
    return;
  }

  console.debug(`Fetching ${contractRef}`);
  const refLe = reverseRef(contractRef);

  const refTxids = await fetchRef(contractRef);
  if (!refTxids.length) {
    console.debug("Ref not found:", contractRef);
    return;
  }

  const revealTxid = refTxids[0].tx_hash;
  const revealTx = await fetchTx(revealTxid);
  const revealParams = await parseContractTx(revealTx, refLe);

  if (!revealParams || revealParams.state === "burn") {
    return;
  }

  // TODO pick random location that still has tokens available

  const locTxid = refTxids[1].tx_hash;
  const fresh = revealTxid === locTxid;
  const locTx = fresh ? revealTx : await fetchTx(locTxid);
  const locParams = fresh ? revealParams : await parseContractTx(locTx, refLe);
  if (!locParams) {
    return;
  }
  const currentParams =
    locParams.state === "burn"
      ? {
          ...revealParams.params,
          height: revealParams.params.maxHeight,
          message: locParams.params.message,
        }
      : locParams.params;

  // Find token script in the reveal tx
  const tokenRefBE = swapEndianness(currentParams.tokenRef);
  const refTxId = tokenRefBE.substring(8);
  const refVout = parseInt(tokenRefBE.substring(0, 8), 10);
  const revealIndex = revealTx.inputs.findIndex(
    (input) =>
      input.prevTxId.toString("hex") === refTxId &&
      input.outputIndex === refVout
  );
  const script = revealIndex >= 0 && revealTx.inputs[revealIndex].script;

  if (!script) {
    console.debug("Glyph script not found");
    return;
  }

  const glyph = decodeGlyph(script);

  if (!glyph) {
    console.debug("Invalid glyph script");
    return;
  }

  return { glyph, contract: currentParams };
}

async function claimTokens(contract: Contract, work: Work, nonce: string) {
  if (!wallet.value) return false;

  const newHeight = contract.height + 1n;
  const lastMint = newHeight === contract.maxHeight;
  const inputScriptHash = bytesToHex(sha256(sha256(work.inputScript)));
  const outputScriptHash = bytesToHex(sha256(sha256(work.outputScript)));

  const scriptSig = Script.fromASM(
    `${nonce} ${inputScriptHash} ${outputScriptHash} 0`
  );

  const tx = new Transaction();
  tx.feePerKb(FEE_PER_KB);
  const p2pkh = Script.fromAddress(wallet.value.address).toHex();
  const msg = mintMessageScript().toHex();
  const ft = `${Script.fromAddress(mineToAddress.value).toHex()}bdd0${
    contract.tokenRef
  }dec0e9aa76e378e4a269e69d`;
  const privKey = wallet.value.privKey;
  const reward = Number(contract.reward);

  tx.addInput(
    new Transaction.Input({
      prevTxId: contract.location,
      outputIndex: contract.outputIndex,
      script: new Script(),
      output: new Transaction.Output({
        script: contract.script,
        satoshis: 1,
      }),
    })
  );

  // @ts-expect-error ...
  tx.setInputScript(0, () => scriptSig);

  // Consolidate all UTXOs
  utxos.value.forEach((utxo) => {
    tx.from({
      txId: utxo.tx_hash,
      outputIndex: utxo.tx_pos,
      script: p2pkh,
      satoshis: utxo.value,
    });
  });

  if (lastMint) {
    const burn = burnScript(contract.contractRef);
    tx.addOutput(
      new Transaction.Output({
        satoshis: 0,
        script: burn,
      })
    );
  } else {
    const dmint = dMintScript({
      ...contract,
      height: contract.height + 1n,
    });
    tx.addOutput(
      new Transaction.Output({
        satoshis: 1,
        script: dmint,
      })
    );
  }

  tx.addOutput(
    new Transaction.Output({
      satoshis: reward,
      script: ft,
    })
  );
  tx.addOutput(
    new Transaction.Output({
      satoshis: 0,
      script: msg,
    })
  );
  tx.change(wallet.value.address);
  tx.sign(privKey);
  tx.seal();
  const hex = tx.toString();
  try {
    console.debug("Broadcasting", hex);
    const txid = (await broadcast(hex)) as string;

    // Update UTXOs so if there's a mint before subscription updates it can be funded
    const changeOutputIndex = tx.outputs.length - 1;
    utxos.value = [
      {
        tx_hash: txid,
        tx_pos: changeOutputIndex,
        value: tx.outputs[changeOutputIndex].satoshis,
      },
    ];

    // Also update balance so low balance message can be shown if needed
    balance.value = utxos.value.reduce((a, { value }) => a + value, 0);

    return txid;
  } catch (error) {
    console.debug("Broadcast failed", error);
    return false;
  }
}

const updateUnspent = async (sh: string) => {
  const response = (await client.request(
    "blockchain.scripthash.listunspent",
    sh
  )) as Utxo[];
  if (response) {
    balance.value = response.reduce((a, { value }) => a + value, 0);
    utxos.value = response;
  }
};

function subscribeToAddress() {
  console.debug("Subscribing to address");
  const address = wallet.value?.address;
  if (!address) {
    return;
  }

  const p2pkh = base58AddressToLockingBytecode(address);
  if (typeof p2pkh !== "string") {
    console.debug(`Address set to ${address}`);

    const sh = scriptHash(p2pkh.bytecode);
    let subscriptionStatus = "";
    client.subscribe(
      "blockchain.scripthash",
      (_, newStatus: unknown) => {
        if (newStatus !== subscriptionStatus) {
          console.debug(`Status received ${newStatus}`);
          updateUnspent(sh);
          subscriptionStatus = newStatus as string;
        }
      },
      sh
    );
  }
}

export async function sweepWallet() {
  if (!wallet.value || !mineToAddress.value) return;
  console.debug(`Sweeping ${wallet.value.address} to ${mineToAddress.value}`);

  const tx = new Transaction();
  tx.feePerKb(FEE_PER_KB);
  const from = Script.buildPublicKeyHashOut(wallet.value.address).toHex();
  const privKey = wallet.value.privKey;

  utxos.value.forEach((utxo) => {
    tx.from({
      txId: utxo.tx_hash,
      outputIndex: utxo.tx_pos,
      script: from,
      satoshis: utxo.value,
    });
  });
  tx.change(mineToAddress.value);
  tx.sign(privKey);
  const hex = tx.toString();
  await broadcast(hex);
}

// Temporary replacement for fetchContractUtxos
async function fetchCuratedContracts() {
  try {
    const response = await fetch(contractsUrl.value);
    if (!response.ok) {
      return [];
    }
    return (await response.json()) as string[];
  } catch {
    return [];
  }
}

// Needs improvement to remove spam
/*
async function fetchContractUtxos() {
  const cache = await localforage.getItem("unspent");
  if (cache) {
    return cache as Utxo[];
  }

  const unspent = (
    (await client.request(
      "blockchain.codescripthash.listunspent",
      "9b817b282e21cce79e6a627ed9ba27f06899ca1f3dfa727c47706ba731f9e61e" // SHA-256 of mining contract
    )) as Utxo[]
  ).filter(
    (u) => u.refs?.length === 2 && u.refs[0].type === "single" && u.refs[1].type
  );

  localforage.setItem("unspent", unspent);
  return unspent;
}
*/

async function fetchTx(txid: string) {
  const hex = await client.request("blockchain.transaction.get", txid);
  return new Transaction(hex);
}

async function broadcast(hex: string) {
  return await client.request("blockchain.transaction.broadcast", hex);
}

async function fetchRef(ref: string) {
  const ids = (await client.request("blockchain.ref.get", ref)) as {
    tx_hash: string;
  }[];
  if (ids.length) {
    return [ids[0], ids[ids.length - 1]];
  }
  return [];
}

const RESULTS_PER_PAGE = 20;
export async function fetchDeployments(
  page = 0,
  refresh = false
): Promise<{ tokens: Token[]; pages: number }> {
  if (refresh) {
    await localforage.clear();
  }

  const allKey = "tokens";
  const cacheKey = `tokens-${page}`;
  const pageCache = await localforage.getItem(cacheKey);
  if (pageCache) {
    const contractAddresses = await localforage.getItem<string[]>(allKey);
    if (contractAddresses?.length) {
      const pages = Math.ceil(contractAddresses.length / RESULTS_PER_PAGE);
      return { tokens: pageCache as Token[], pages };
    }
  }

  // TODO implement pagination in ElectrumX
  const all =
    (await localforage.getItem<string[]>(allKey)) ||
    (await fetchCuratedContracts());
  const contracts = all.slice(
    page * RESULTS_PER_PAGE,
    (page + 1) * RESULTS_PER_PAGE
  );

  const tokens = [];
  for (const singleton of contracts) {
    const txid = singleton.slice(0, 64);
    const vout = parseInt(singleton.slice(65), 16);

    // Convert short format to big endian hex
    const buf = Buffer.alloc(36);
    buf.write(txid, 0, 32, "hex");
    buf.writeUInt32BE(vout, 32);
    const ref = buf.toString("hex");
    const cachedToken = await localforage.getItem<Token>(ref);
    const token = cachedToken || (await fetchToken(ref));
    if (token) {
      tokens.push(token);
      localforage.setItem(ref, token);
    }
  }

  localforage.setItem(cacheKey, tokens);
  const pages = Math.ceil(all.length / RESULTS_PER_PAGE);
  return { tokens, pages };
}

function parseDmintScript(script: string): string {
  const pattern =
    /^(.*)bd5175c0c855797ea8597959797ea87e5a7a7eaabc01147f77587f040000000088817600a269a269577ae500a069567ae600a06901d053797e0cdec0e9aa76e378e4a269e69d7eaa76e47b9d547a818b76537a9c537ade789181547ae6939d635279cd01d853797e016a7e886778de519d547854807ec0eb557f777e5379ec78885379eac0e9885379cc519d75686d7551$/;
  const [, stateScript] = script.match(pattern) || [];
  return stateScript;
}

function parseBurnScript(script: string): string {
  const pattern = /^d8([0-9a-f]{64}[0-9]{8})6a$/;
  const [, ref] = script.match(pattern) || [];
  return ref;
}

function parseMessageScript(script: string): string {
  const pattern = /^6a036d7367(.*)$/;
  const [, msg] = script.match(pattern) || [];
  if (!msg) return "";

  const chunks = new Script(msg).chunks as {
    opcodenum: number;
    buf?: Uint8Array;
  }[];

  if (chunks.length === 0 || !chunks[0].buf || chunks[0].buf.byteLength === 0) {
    return "";
  }

  return new TextDecoder().decode(chunks[0].buf);
}

function opcodeToNum(n: string) {
  if (n.startsWith("OP_")) {
    const num = pushNumberOpcodeToNumber(Opcodes[n as keyof typeof Opcodes]);
    if (num === false) return false;
    return BigInt(num);
  }

  const num = vmNumberToBigInt(hexToBytes(n), {
    requireMinimalEncoding: false,
  });

  if (typeof num === "bigint") {
    return num;
  }

  return false;
}

function dMintScript({
  height,
  contractRef,
  tokenRef,
  maxHeight,
  reward,
  target,
}: Contract) {
  return `${push4bytes(
    Number(height)
  )}d8${contractRef}d0${tokenRef}${pushMinimal(maxHeight)}${pushMinimal(
    reward
  )}${pushMinimal(
    target
  )}bd5175c0c855797ea8597959797ea87e5a7a7eaabc01147f77587f040000000088817600a269a269577ae500a069567ae600a06901d053797e0cdec0e9aa76e378e4a269e69d7eaa76e47b9d547a818b76537a9c537ade789181547ae6939d635279cd01d853797e016a7e886778de519d547854807ec0eb557f777e5379ec78885379eac0e9885379cc519d75686d7551`;
}

function burnScript(ref: string) {
  return `d8${ref}6a`;
}

// Push a positive number as a 4 bytes little endian
function push4bytes(n: number) {
  return bytesToHex(encodeDataPush(numberToBinUint32LEClamped(n)));
}

// Push a number with minimal encoding
function pushMinimal(n: bigint | number) {
  return bytesToHex(encodeDataPush(bigIntToVmNumber(BigInt(n))));
}

export class Blockchain {
  nonces: string[] = [];
  ready: boolean = true;
  subscriptionStatus?: string;

  found(values: string[]) {
    this.nonces.push(...values);

    if (this.ready) {
      this.submit();
    }
  }

  newWork() {
    this.nonces = [];
  }

  async submit() {
    console.debug("Submitting");
    const nonce = this.nonces.pop();

    if (!contract.value || !work.value || !nonce) {
      return;
    }

    this.ready = false;

    const txid = await claimTokens(contract.value, work.value, nonce);
    if (txid) {
      accepted.value++;
      this.nonces = [];
      this.ready = true;
      addMessage({
        type: "accept",
        nonce,
        msg: mintMessage.value || "",
        txid,
      });

      // Set the new location now instead of waiting for the subscription
      const height = contract.value.height + 1n;
      if (height === contract.value.maxHeight) {
        // Stop mining. The "minted out" message will be sent after subscription is received
        miningStatus.value = "stop";
      } else {
        console.debug(`Changed location to ${txid}`);
        contract.value = {
          ...contract.value,
          height,
          location: txid,
          outputIndex: 0,
        };
        miningStatus.value = "change";
      }

      if (balance.value < 0.0001) {
        addMessage({ type: "general", msg: "Balance is low" });
        miner.stop();
        addMessage({ type: "stop" });
      }
    } else {
      addMessage({
        type: "reject",
        nonce,
      });

      rejected.value++;
      if (this.nonces.length) {
        // Failed, try next nonce if there is one
        this.submit();
      } else {
        this.ready = true;
      }
    }
  }

  async changeToken(ref: string) {
    const token = await fetchToken(ref);
    if (!token) {
      addMessage({ type: "not-found", ref });
      return;
    }

    contract.value = token.contract;
    glyph.value = token.glyph;

    if (token.contract.height === token.contract.maxHeight) {
      addMessage({ type: "minted-out", ref, msg: token.contract.message });
      return;
    }

    addMessage({ type: "loaded", ref, msg: token.contract.message });

    if (balance.value < 0.0001) {
      addMessage({ type: "general", msg: "Balance is low" });
    }

    // TODO unsubscribe from existing subscriptions

    // Subscribe to the singleton so we know when the contract moves
    // Change ref to little-endian
    const refLe = reverseRef(ref);
    const sh = scriptHash(hexToBytes(refLe));
    client.subscribe(
      "blockchain.scripthash",
      async (_, status) => {
        if (status !== this.subscriptionStatus) {
          const ids = await fetchRef(ref);
          const location = ids[1]?.tx_hash;
          if (contract.value && location !== contract.value?.location) {
            console.debug(`New contract location ${location}`);
            //contract.value.location = location;
            const locTx = await fetchTx(location);
            const parsed = await parseContractTx(locTx, refLe);

            if (parsed?.state && parsed.params.message) {
              addMessage({
                type: "new-location",
                txid: location,
                msg: parsed.params.message,
              });
            }

            if (parsed?.state === "active") {
              contract.value = parsed.params;
              if (miningStatus.value === "mining") {
                miningStatus.value = "change";
              }
            } else if (parsed?.state === "burn") {
              miningStatus.value = "stop";
              addMessage({
                type: "minted-out",
                ref: reverseRef(contract.value.contractRef),
              });

              // No contract data exists in burn output so use existing data and set height to max
              contract.value = {
                ...contract.value,
                height: contract.value.maxHeight,
              };
            }
          }
          this.subscriptionStatus = status as string;
        }
      },
      sh
    );

    return { contract, glyph };
  }
}

export const blockchain = new Blockchain();
