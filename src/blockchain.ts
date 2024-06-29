import { base58AddressToLockingBytecode } from "@bitauth/libauth";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { Script, Transaction } from "@radiantblockchain/radiantjs";
import { burnScript, dMintScript, fetchToken, parseContractTx } from "./glyph";
import {
  accepted,
  balance,
  contract,
  glyph,
  loadingContract,
  mineToAddress,
  miningEnabled,
  miningStatus,
  mintMessage,
  rejected,
  utxos,
  wallet,
  work,
} from "./signals";
import { addMessage } from "./message";
import miner, { updateWork } from "./miner";
import { reverseRef, scriptHash } from "./utils";
import { broadcast, client, fetchRef, fetchTx } from "./client";
import { Contract, Work, Utxo } from "./types";
import { FEE_PER_KB } from "./constants";

// Subscription statuses
let addressSubscriptionStatus = "";
let contractSubscriptionStatus = "";

// Timer to ensure address subscription is received after mint
let subscriptionCheckTimer: ReturnType<typeof setTimeout>;

// Timer to periodically update the contract in case of subscription failure
let contractCheckTimer: ReturnType<typeof setTimeout>;

let nonces: string[] = [];

// Ready will be true when there is no pending token claim
let ready: boolean = true;

// Sometimes subscriptions arrive late after another nonce is found so keep track of previous locations
let acceptedLocations: string[] = [];

// Keep track of consecutive mempool conflicts
let mempoolConflictCounter = 0;

enum ClaimError {
  MEMPOOL_CONFLICT,
  CONTRACT_FAIL,
  MISSING_INPUTS,
  LOW_FEE,
}

async function claimTokens(
  contract: Contract,
  work: Work,
  nonce: string
): Promise<
  { success: true; txid: string } | { success: false; error?: ClaimError }
> {
  if (!wallet.value) return { success: false };

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

  // Output script is message
  tx.addOutput(
    new Transaction.Output({
      satoshis: 0,
      script: bytesToHex(work.outputScript),
    })
  );
  tx.change(wallet.value.address);
  tx.sign(privKey);
  tx.seal();
  const hex = tx.toString();
  try {
    console.debug("Broadcasting", hex);
    const txid = (await broadcast(hex)) as string;
    console.debug(`txid ${txid}`);

    // Update UTXOs so if there's a mint before subscription updates it can be funded
    // Set a timer that will refresh wallet in case tx was replaced and no subscription received
    startSubscriptionCheckTimer();
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

    return { success: true, txid };
  } catch (exception) {
    console.debug("Broadcast failed", exception);

    const msg = ((exception as Error).message || "").toLowerCase();
    let error = undefined;

    if (msg.includes("missing inputs")) {
      error = ClaimError.MISSING_INPUTS;
    }

    if (
      msg.includes("min relay fee not met") ||
      msg.includes("bad-txns-in-belowout")
    ) {
      error = ClaimError.LOW_FEE;
    }
    if (msg.includes("txn-mempool-conflict")) {
      error = ClaimError.MEMPOOL_CONFLICT;
    }
    if (msg.includes("mandatory-script-verify-flag-failed")) {
      error = ClaimError.CONTRACT_FAIL;
    }

    return { success: false, error };
  }
}

// Sometimes a tx might not get mined and no subscription status is received
// Set a timer to update unspent. This timer will be cleared when a subscription is received.
function startSubscriptionCheckTimer() {
  clearTimeout(subscriptionCheckTimer);
  subscriptionCheckTimer = setTimeout(() => {
    console.debug("No subscription received. Updating unspent.");
    updateUnspent();
  }, 10000);
}

// If no subscription has been received in the last minute then force an update
// This timer is cleared and recreated every time a subscription is received
// The timeout is shorter after a mempool conflict
function startContractCheckTimer(duration = 60000, fullRecovery = false) {
  clearTimeout(contractCheckTimer);
  contractCheckTimer = setTimeout(() => {
    try {
      if (fullRecovery) {
        // Pause mining and update unspent and contract
        recoverFromError();
      } else if (contract.value) {
        // Only refresh contract
        updateContract();
      }
    } catch (error) {
      console.debug("Contract check error", error);
    }
    startContractCheckTimer();
  }, duration);
}

const updateUnspent = async () => {
  if (wallet.value) {
    const p2pkh = base58AddressToLockingBytecode(wallet.value?.address);
    if (typeof p2pkh !== "string") {
      const sh = scriptHash(p2pkh.bytecode);

      console.debug("updateUnspent", sh);
      const response = (await client.request(
        "blockchain.scripthash.listunspent",
        sh
      )) as Utxo[];
      if (response) {
        balance.value = response.reduce((a, { value }) => a + value, 0);
        utxos.value = response;
      }
    }
  }
};

async function recoverFromError() {
  if (!contract.value?.contractRef) {
    return;
  }

  addMessage({
    type: "general",
    msg: "Updating wallet and resubscribing to contract",
  });

  loadingContract.value = true;
  try {
    const refBE = reverseRef(contract.value.contractRef);
    // Stop miner and wait for UTXOs to update
    miner.stop();
    await updateUnspent();
    // Refetch token and resubscribe to contract
    await changeToken(refBE);
    if (miningEnabled.value) {
      miner.start();
      addMessage({ type: "start" });
    }
    loadingContract.value = false;
  } catch {
    loadingContract.value = false;
    addMessage({
      type: "general",
      msg: "Waiting for contract",
    });
    if (miningEnabled.value) {
      miner.start();
    }
  }
}

export function subscribeToAddress() {
  console.debug("Subscribing to address");
  const address = wallet.value?.address;
  if (!address) {
    return;
  }

  const p2pkh = base58AddressToLockingBytecode(address);
  if (typeof p2pkh !== "string") {
    console.debug(`Address set to ${address}`);

    const sh = scriptHash(p2pkh.bytecode);
    client.subscribe(
      "blockchain.scripthash",
      (_, newStatus: unknown) => {
        clearTimeout(subscriptionCheckTimer);
        if (newStatus !== addressSubscriptionStatus) {
          addressSubscriptionStatus = newStatus as string;
          console.debug(`Status received ${newStatus}`);
          updateUnspent();
        }
      },
      sh
    );
  }
}

function mintedOut(location: string) {
  if (!contract.value) return;

  miningEnabled.value = false;
  miner.stop();
  addMessage({
    type: "minted-out",
    ref: reverseRef(contract.value.contractRef),
  });

  // No contract data exists in burn output so use existing data and set height to max
  contract.value = {
    ...contract.value,
    location,
    height: contract.value.maxHeight,
  };
}

export function foundNonce(nonce: string) {
  nonces.push(nonce);

  if (ready) {
    submit();
  }
}

async function submit() {
  console.debug("Submitting");
  const nonce = nonces.pop();

  // TODO handle multiple nonces, if one fails try the next
  nonces = [];

  if (!contract.value || !work.value || !nonce) {
    return;
  }

  ready = false;

  const result = await claimTokens(contract.value, work.value, nonce);
  if (result.success) {
    const { txid } = result;
    accepted.value++;
    mempoolConflictCounter = 0;
    ready = true;
    addMessage({
      type: "accept",
      nonce,
      msg: mintMessage.value || "",
      txid,
    });

    // Keep track of the last 20 accepted locations
    acceptedLocations.push(txid);
    acceptedLocations = acceptedLocations.slice(-20);

    // Set the new location now instead of waiting for the subscription
    const height = contract.value.height + 1n;
    if (height === contract.value.maxHeight) {
      mintedOut(txid);
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

    if (balance.value < 0.0001 + Number(contract.value.reward) / 100000000) {
      addMessage({ type: "general", msg: "Balance is low" });
      miner.stop();
      miningEnabled.value = false;
      addMessage({ type: "stop" });
    }
  } else {
    const rejectMessage = (reason: string) =>
      addMessage({
        type: "reject",
        nonce,
        reason,
      });

    if (
      result.error === ClaimError.MISSING_INPUTS ||
      result.error === ClaimError.CONTRACT_FAIL
    ) {
      clearTimeout(subscriptionCheckTimer);

      if (result.error === ClaimError.MISSING_INPUTS) {
        // This should be caught by subscription and subscriptionCheckTimer, but handle here in case
        rejectMessage("missing inputs");
      } else {
        rejectMessage("contract execution failed");
      }

      recoverFromError();
    } else if (result.error == ClaimError.LOW_FEE) {
      // Stop mining if fees can't be paid
      rejectMessage("fee not met");
      miner.stop();
      miningEnabled.value = false;
      addMessage({ type: "stop" });
    } else if (result.error == ClaimError.MEMPOOL_CONFLICT) {
      rejectMessage("mempool conflict");
      mempoolConflictCounter++;

      // If there are consecutive mempool conflicts, then refetch and resubscribe to everything again
      if (mempoolConflictCounter === 3) {
        recoverFromError();
      } else {
        // If no subscription is received within the next 10 seconds, refetch
        // This timer will be cleared when contract subscription is received
        startContractCheckTimer(10000, true);
      }
    }

    rejected.value++;
    ready = true;
  }
}

// Change token. Ref is big-endian.
export async function changeToken(ref: string) {
  loadingContract.value = true;
  acceptedLocations = [];
  // Unsubscribe from current subscription
  if (work.value?.contractRef) {
    console.debug(
      `Unsubscribing from current contract ${bytesToHex(
        work.value?.contractRef
      )}`
    );
    const sh = scriptHash(work.value?.contractRef);
    // This will cause an error "unsubscribe is unknown method" but seems to work anyway
    client.unsubscribe("blockchain.scripthash", sh);
  }

  const token = await fetchToken(ref);
  loadingContract.value = false;

  if (!token) {
    addMessage({ type: "not-found", ref });
    return;
  }

  contract.value = token.contract;
  glyph.value = token.glyph;
  updateWork();

  if (token.contract.height === token.contract.maxHeight) {
    addMessage({ type: "minted-out", ref, msg: token.contract.message });
    return;
  }

  addMessage({ type: "loaded", ref, msg: token.contract.message });

  if (balance.value < 0.01) {
    addMessage({
      type: "general",
      msg: "Balance is low. Please fund wallet to start mining.",
    });
  }

  if (miningStatus.value === "mining") {
    miningStatus.value = "change";
  }

  // Subscribe to the singleton so we know when the contract moves
  // Change ref to little-endian
  const refLe = reverseRef(ref);
  const sh = scriptHash(hexToBytes(refLe));
  client.subscribe(
    "blockchain.scripthash",
    async (_, status) => {
      startContractCheckTimer();

      if (status !== contractSubscriptionStatus) {
        updateContract();
      }

      contractSubscriptionStatus = status as string;
    },
    sh
  );

  return { contract, glyph };
}

async function updateContract() {
  const ref = contract.value?.contractRef;
  if (!ref) return;

  const ids = await fetchRef(reverseRef(ref));
  const location = ids[1]?.tx_hash;
  if (
    contract.value &&
    location !== contract.value?.location &&
    !acceptedLocations.includes(location)
  ) {
    console.debug(`New contract location ${location}`);
    const locTx = await fetchTx(location, true);
    const parsed = await parseContractTx(locTx, ref);

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
      mintedOut(location);
    }
  } else if (acceptedLocations.includes(location)) {
    console.debug(`Old location received ${location}`);
  }
}
