import { swapEndianness } from "@bitauth/libauth";

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
