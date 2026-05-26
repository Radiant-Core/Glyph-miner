/**
 * `process` / `Buffer` globals shim for radiantjs.
 *
 * `@radiant-core/radiantjs@2.x` was authored for Node and reads `process`
 * (and friends) without a browser guard at several sites — notably
 * `lib/crypto/random.js`'s `getRandomBuffer`, which throws
 * `ReferenceError: process is not defined` mid-signing in the browser.
 *
 * Mirrors the Photonic-Wallet shim (packages/app/src/processShim.ts). Kept
 * as a typed TS module imported first by `main.tsx` so the same shim works
 * if/when Glyph-Miner adopts a strict CSP that forbids inline scripts.
 *
 * If/when radiantjs gains proper browser guards, this module can be deleted.
 */
import { Buffer } from "buffer";

interface RadiantjsProcessShim {
  browser: boolean;
  env: Record<string, string>;
  version: string;
  // `versions` is the property `bufferUtil.js` checks; leave it unset so the
  // `process.versions && process.versions.node` branch is falsy in the browser.
  versions?: undefined;
}

interface WithShimmedGlobals {
  Buffer?: typeof Buffer;
  process?: RadiantjsProcessShim;
}

const g = globalThis as unknown as WithShimmedGlobals;

if (!g.Buffer) {
  g.Buffer = Buffer;
}

if (!g.process) {
  g.process = {
    browser: true,
    env: {},
    version: "",
  };
}
