# Glyph-miner v3.0.0

**The first tagged stable release** — aligned with Radiant Core v3.0.0 and the V2-launch dMint mainnet activation. This release covers everything since the v2.0.0 internal milestone (43 commits).

> ⚠️ **Mining requires a Radiant Core v3.0.0+ node** in the network to reliably confirm V2-launch dMint mint transactions into blocks. Older versions may relay these txs but won't select them for block templates.

---

## Highlights

### V2-launch dMint mainnet readiness
Four correctness fixes against the post-2026-05-26 V2-launch contract format. Without these, every blake3/K12/ASERT mint would have been rejected on chain.

- **`fix(daa)`** Extract deploy-time DAA parameters (halfLife, epochLength, maxAdjustment, …) directly from the on-chain codescript bytecode. The miner now mirrors the *exact* DAA computation the contract will execute — previously fell back to library defaults (halfLife=3600) and emitted divergent newTarget pushes.
- **`fix(blockchain)`** Always set `nLockTime` for V2-launch mints regardless of DAA mode. PartC's ELSE_BRANCH always reconstructs the next-state `lastTime` slot via `OP_TXLOCKTIME`, so fixed-DAA contracts also need it.
- **`fix(blockchain)`** Use `contract.algoId` (the parsed bigint) instead of `contract.algorithm` (the unset string field) for the middle-literal `algoId` byte. Pre-fix, blake3 and K12 V2 mints emitted `algoId=0` (sha256d) and failed EQUALVERIFY on chain.
- **`feat`** Miner parity for the v2-launch contract shape: parser recognizes `6b75757575` PartB4 + MINIMAL_PUSH primitive signature, `buildNextContractState` rebuilds the middle from `Contract.*` fields via `pushMinimal`.
- New `v2-launch-roundtrip.test.ts` (193 tests) covering parse → reconstruct → byte-diff across all 6 (algo × DAA) combinations and 5 height boundaries × 6 target boundaries.

### Multi-algorithm mining with GPU acceleration
- **BLAKE3** and **K12** GPU shaders with 8-byte nonce support.
- **SHA256d** 64-bit nonce mode with batch verification and atomic result storage.
- Per-algorithm hashrate calculation in the mining loop.
- CPU verification of GPU-found solutions (catches shader race conditions before broadcast).
- Forensic test suite for BLAKE3/K12 preimage construction and cross-implementation validation.

### Adaptive DAA support
- Timed-mode contracts with **ASERT** difficulty adjustment.
- **EPOCH** and **SCHEDULE** target prediction aligned with on-chain bytecode (post 2026-05-25 OP_2MUL/2DIV unroll fix).
- LWMA window-based prediction.
- Verified contract counting.

### Radiant Core v3.0.0 alignment
- **`wallet`** New wallets created with BIP44 SLIP-0044 derivation path `m/44'/512'/0'/0/k` (coin type 512). Legacy wallets continue on the previous path; both load transparently.
- `MIN_FEE_PER_KB = 10,500,000` photons/byte to clear the post-V2-fork mainnet relay floor.
- `@radiant-core/radiantjs` bumped to ^2.0.3.

### Broadcast resilience
- **`fix(broadcast)`** Surface all rejection reasons across the 7-server fan-out — no more silent failures when only some servers reject.
- **`fix(broadcast)`** Install `process`/`Buffer` shims so radiantjs serialization works in the browser.
- Server fan-out with Radiant-Core nodes pinned first.
- Default Electrum endpoints updated to use `:50011` and prioritize `electrumx.radiantcore.org`.

### Contract discovery
- REST API contract discovery via `glyph-miner.com/api` with Electrum fallback.
- Progressive contract count enrichment + filter for burned/fully-mined contracts.
- Separate API check intervals for success vs failure responses (avoids hammering broken endpoints).
- Static contracts fallback when the API is unreachable.

### Stability + robustness
- **`fix(parser)`** Accept the `c0c8` Part A prefix from post-4060ac1 wallets.
- **`fix(parser)`** Accept fixed V2 PartC bytecode (no leading `a269`).
- **`fix(spend)`** Preserve `lastTime` and `target` in the V2 next-state script when DAA leaves them unchanged.
- Real fee-headroom pre-check before nonce search begins (previous code wasted hashpower on contracts the wallet couldn't afford to spend).
- Guards in `normalizeRef`, `reverseRef`, and contract filtering against undefined/null refs.
- Disable 64-bit nonce mining on contracts whose preimage stack layout doesn't support it (warns but still allows legacy SHA256d).

---

## Upgrade notes

- **Mining nodes**: ensure at least one Radiant Core v3.0.0+ node is mining blocks on the network, otherwise V2-launch dMint mints will accumulate in mempool without confirming.
- **Legacy wallets**: the BIP44 path change only affects *new* wallets. Existing wallets are loaded from the previous derivation path and continue working unchanged.
- **Browser support**: requires a WebGPU-capable browser for blake3/K12 GPU mining. SHA256d falls back to CPU when WebGPU is unavailable.

---

## Test coverage

- **366 tests pass / 118 skipped** across 13 test files.
- New `v2-launch-roundtrip.test.ts` (193 tests) is the primary regression for the V2-launch fixes — it implements byte-equal reconstruction against `buildNextContractState` for the full (algo × DAA × height × target) matrix and includes a fault-injection test that reverts the `daaParams` extractor and asserts the test catches the regression.

---

## Acknowledgements

V2-launch correctness fixes co-developed in pair with Claude — full byte-level analysis sessions documented in commit messages of `741f972`, `0ea85d2`, `fc90e85`, `a416854`.
