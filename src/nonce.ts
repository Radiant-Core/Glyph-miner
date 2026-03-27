import { bytesToHex, hexToBytes } from "@noble/hashes/utils";

export const NONCE_BYTES_V1 = 4;
export const NONCE_BYTES_V2 = 8;

export function nonceBytesForContracts(nonceU32: number): Uint8Array {
  const buf = new Uint8Array(NONCE_BYTES_V2);
  const view = new DataView(buf.buffer);
  view.setUint32(0, nonceU32 >>> 0, true);
  view.setUint32(4, 0, true);
  return buf;
}

export function nonceHexForContracts(nonceU32: number): string {
  return bytesToHex(nonceBytesForContracts(nonceU32));
}

export function normalizeNonceHexForScriptSig(
  nonceHex: string,
  nonceBytes: 4 | 8,
): string {
  const normalized = nonceHex.trim().toLowerCase();
  const requiredHexLength = nonceBytes * 2;

  if (nonceBytes === NONCE_BYTES_V2 && normalized.length === 8) {
    return `${normalized}00000000`;
  }
  if (normalized.length === requiredHexLength) {
    return normalized;
  }
  if (normalized.length > requiredHexLength) {
    return normalized.substring(0, requiredHexLength);
  }
  return normalized.padStart(requiredHexLength, "0");
}

export function nonceU32FromLEHex(nonceHex: string): number {
  const normalized = normalizeNonceHexForScriptSig(nonceHex, NONCE_BYTES_V1);
  const bytes = hexToBytes(normalized);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getUint32(0, true);
}
