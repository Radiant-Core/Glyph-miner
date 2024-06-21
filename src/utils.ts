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
