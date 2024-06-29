import { Transaction, Script } from "@radiantblockchain/radiantjs";
import { broadcast } from "./client";
import { wallet, mineToAddress, utxos } from "./signals";
import { FEE_PER_KB } from "./constants";

export async function sweepWallet(): Promise<
  { success: true; txid: string } | { success: false; reason: string }
> {
  if (!wallet.value || !mineToAddress.value)
    return { success: false, reason: "" };
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
  try {
    const txid = await broadcast(hex);
    return { success: true, txid: txid as string };
  } catch (error) {
    const msg = (error as Error).message || "";
    return { success: false, reason: msg };
  }
}
