import {
  Opcodes,
  bigIntToVmNumber,
  encodeDataPush,
  numberToBinUint32LEClamped,
  pushNumberOpcodeToNumber,
  swapEndianness,
  vmNumberToBigInt,
} from "@bitauth/libauth";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { sha256 } from "@noble/hashes/sha256";

export function photonsToRXD(photons: number, exact?: boolean) {
  const fixed = photons / 100000000;
  return Intl.NumberFormat(
    "en-US",
    exact ? undefined : { maximumSignificantDigits: 12 }
  ).format(fixed as unknown as number);
}

export function cat(a: Uint8Array, b: Uint8Array) {
  const arr = new Uint8Array(a.byteLength + b.byteLength);
  arr.set(a);
  arr.set(b, a.byteLength);
  return arr;
}

export function reverseRef(hex: string) {
  const ref = swapEndianness(hex.toLowerCase());
  return `${ref.substring(8)}${ref.substring(0, 8)}`;
}

export function isRef(ref: string) {
  return ref.match(/^[0-9a-f]{64}[0-9a-f]{8}$/);
}

export function shuffle(array: unknown[]) {
  let currentIndex = array.length;

  while (currentIndex != 0) {
    const randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex--;
    [array[currentIndex], array[randomIndex]] = [
      array[randomIndex],
      array[currentIndex],
    ];
  }
  return array;
}

export function arrayChunks<T = unknown>(arr: T[], chunkSize: number) {
  const chunks = [];

  for (let i = 0; i < arr.length; i += chunkSize) {
    const chunk = arr.slice(i, i + chunkSize);
    chunks.push(chunk);
  }

  return chunks;
}

export function opcodeToNum(n: string) {
  if (n.startsWith("OP_")) {
    const num = pushNumberOpcodeToNumber(Opcodes[n as keyof typeof Opcodes]);
    if (num === false) return false;
    return BigInt(num);
  }

  // Validate hex string: must have even length and contain only hex characters
  if (n.length === 0 || n.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(n)) {
    return false;
  }

  try {
    const num = vmNumberToBigInt(hexToBytes(n), {
      requireMinimalEncoding: false,
    });

    if (typeof num === "bigint") {
      return num;
    }
  } catch {
    return false;
  }

  return false;
}

export function scriptHash(bytecode: Uint8Array): string {
  return swapEndianness(bytesToHex(sha256(bytecode)));
}

// Push a positive number as a 4 bytes little endian
export function push4bytes(n: number) {
  return bytesToHex(encodeDataPush(numberToBinUint32LEClamped(n)));
}

// Push a number with minimal encoding
export function pushMinimal(n: bigint | number) {
  return bytesToHex(encodeDataPush(bigIntToVmNumber(BigInt(n))));
}
