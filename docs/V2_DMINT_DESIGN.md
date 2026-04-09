# Glyph v2 dMint Design Specification

**Version:** 3.0  
**Date:** April 2026  
**Status:** Active — Complete V2 bytecode specification with on-chain DAA  

---

## 1. Overview

This document defines the exact byte layout, CBOR metadata format, contract bytecodes,
on-chain DAA algorithms, and miner integration for Glyph v2 decentralized minting (dMint).

### 1.1 Design Constraints

1. **v1 backward compatibility**: Existing v1 dMint tokens MUST continue to work unchanged
2. **ALL new contracts are V2**: Even sha256d+fixed uses V2 format for forward compatibility
3. **Fully on-chain PoW**: `OP_BLAKE3` (0xee) and `OP_K12` (0xef) opcodes validate all algorithms
4. **On-chain DAA**: `OP_LSHIFT`/`OP_RSHIFT` + `OP_MUL`/`OP_DIV` compute difficulty adjustment in-script
5. **nLockTime required**: DAA contracts read `OP_TXLOCKTIME` (0xc5) for timestamp
6. **Nonce format**: 8 bytes (2×u32) — proven in v1 implementation
7. **Trustless**: No indexer dependency for PoW validation or DAA — indexer is analytics only
8. **No griefing**: On-chain PoW prevents state consumption without valid work

### 1.2 Contract Variants

| Variant | PoW On-Chain | Algorithms | DAA | Use Case |
|---------|-------------|------------|-----|----------|
| **v1 contract** | SHA256d (OP_HASH256) | SHA256d only | Fixed | Legacy v1 tokens only |
| **v2-sha256d** | SHA256d (OP_HASH256) | SHA256d | On-chain | ALL new SHA256d tokens |
| **v2-blake3** | Blake3 (OP_BLAKE3) | Blake3 | On-chain | Blake3 tokens |
| **v2-k12** | K12 (OP_K12) | KangarooTwelve | On-chain | K12 tokens |

> **Note:** V1 contracts are no longer generated. All new contracts use V2 format.

---

## 2. v1 dMint On-Chain Layout (Reference)

### 2.1 Contract Output Script

```
┌─────────────────────── State Data ───────────────────────┐
│ <height:4B>                                              │
│ OP_PUSHINPUTREFSINGLETON(d8) <contractRef:36B>           │
│ OP_PUSHINPUTREF(d0) <tokenRef:36B>                       │
│ <maxHeight:minimal>                                      │
│ <reward:minimal>                                         │
│ <target:minimal>                                         │
├─────────────────────── Separator ────────────────────────┤
│ OP_STATESEPARATOR(bd)                                    │
├─────────────────────── Bytecode ─────────────────────────┤
│ <v1_contract_bytecode> (fixed, validates SHA256d PoW     │
│  + state transitions + token rewards)                    │
└──────────────────────────────────────────────────────────┘
```

### 2.2 v1 Contract Bytecode (Hex)

```
5175c0c855797ea8597959797ea87e5a7a7eaabc01147f77587f
040000000088817600a269a269577ae500a069567ae600a06901
d053797e0cdec0e9aa76e378e4a269e69d7eaa76e47b9d547a81
8b76537a9c537ade789181547ae6939d635279cd01d853797e01
6a7e886778de519d547854807ec0eb557f777e5379ec78885379
eac0e9885379cc519d75686d7551
```

### 2.3 v1 Contract Bytecode Validation

The bytecode enforces:
1. **SHA256d PoW**: `hash = SHA256d(preimage + nonce)`, first 4 bytes must be `00000000`,
   remaining bytes checked against `target`
2. **Height increment**: `new_height = old_height + 1`
3. **Singleton preservation**: contractRef singleton maintained across spend
4. **Token distribution**: tokenRef output created with correct reward value
5. **Script continuity**: output script matches input script (except height)

### 2.4 v1 State Data Parsing

```typescript
// From glyph.ts:parseContractTx
const opcodes = Script.fromHex(stateScript).toASM().split(" ");
const [op1, contractRef] = opcodes.splice(1, 2); // OP_PUSHINPUTREFSINGLETON, ref
const [op2, tokenRef] = opcodes.splice(1, 2);    // OP_PUSHINPUTREF, ref
const [height, maxHeight, reward, target] = opcodes.map(opcodeToNum);
```

### 2.5 v1 Mining Preimage

```
preimage = SHA256(txid || contractRef) || SHA256(SHA256d(inputScript) || SHA256d(outputScript))
```

64 bytes total. Midstate = SHA256 partial hash of first 512-bit block (preimage).

### 2.6 v1 Nonce Format

```
nonce = nonce1(4B random) || nonce2(4B thread-varying)
```

8 bytes total. GPU shader increments `nonce2` per thread (`nonce[1] + id.x`).

### 2.7 v1 Solution Check

```
hash = SHA256d(preimage || nonce)
valid = (hash[0..3] == 0x00000000) AND (hash[4..11] < target)
```

---

## 3. v2 dMint CBOR Metadata Format

### 3.1 Deploy Metadata (Reveal Transaction)

v2 dMint tokens include a `dmint` object in the CBOR payload:

```json
{
  "v": 2,
  "p": [1, 4],
  "name": "Mineable Token",
  "ticker": "MINE",
  "dmint": {
    "algo": 0,
    "maxHeight": 10000,
    "reward": 100,
    "premine": 0,
    "diff": 10,
    "daa": {
      "mode": 0,
      "params": {}
    }
  }
}
```

### 3.2 `dmint` Field Specification

| Field | CBOR Key | Type | Required | Description |
|-------|----------|------|----------|-------------|
| Algorithm | `algo` | uint | Yes | Algorithm ID (see 3.3) |
| Max Height | `maxHeight` | uint | Yes | Maximum mint count |
| Reward | `reward` | uint | Yes | Photons per mint |
| Premine | `premine` | uint | No | Creator premine amount (default 0) |
| Base Difficulty | `diff` | uint | Yes | Initial difficulty (target divisor) |
| DAA Config | `daa` | map | No | Dynamic difficulty adjustment (default: fixed) |

### 3.3 Algorithm IDs

| ID | Name | GPU Shader | On-Chain PoW | Status |
|----|------|-----------|-------------|--------|
| `0x00` | SHA256d | `sha256d.wgsl` | Yes (v1 contract) | Active |
| `0x01` | Blake3 | `blake3.wgsl` | No (v2 contract) | Phase 3 |
| `0x02` | KangarooTwelve | `k12.wgsl` | No (v2 contract) | Phase 3 |
| `0x03` | Argon2id-Light | `argon2light.wgsl` | No (v2 contract) | Phase 3 |
| `0x04` | RandomX-Light | CPU only | No (v2 contract) | Deferred |

### 3.4 DAA Mode IDs

| ID | Mode | Description | `params` Fields |
|----|------|-------------|-----------------|
| `0x00` | Fixed | Static difficulty | *(none)* |
| `0x01` | Epoch | Bitcoin-style periodic | `epochLength`, `maxAdjustment` |
| `0x02` | ASERT | Exponential moving average | `targetTime`, `halfLife` |
| `0x03` | LWMA | Linear weighted MA | `targetTime`, `windowSize` |
| `0x04` | Schedule | Predetermined curve | `schedule: [{h, d}, ...]` |

### 3.5 DAA `params` Field Specification

#### Fixed (mode 0x00)
No params. Target never changes.

#### Epoch (mode 0x01)
```json
{
  "mode": 1,
  "params": {
    "epochLength": 2016,
    "maxAdjustment": 4.0
  }
}
```
| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `epochLength` | uint | 2016 | Mints per adjustment epoch |
| `maxAdjustment` | float | 4.0 | Max adjustment factor per epoch |

#### ASERT (mode 0x02) — Recommended Default
```json
{
  "mode": 2,
  "params": {
    "targetTime": 60,
    "halfLife": 3600
  }
}
```
| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `targetTime` | uint | 60 | Target seconds between mints |
| `halfLife` | uint | 3600 | Half-life in seconds |

**ASERT Formula** (computed on-chain via OP_LSHIFT/OP_RSHIFT):
```
new_target = anchor_target * 2^((time_delta - ideal_time_delta) / halfLife)
```

#### LWMA (mode 0x03)
```json
{
  "mode": 3,
  "params": {
    "targetTime": 60,
    "windowSize": 45
  }
}
```
| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `targetTime` | uint | 60 | Target seconds between mints |
| `windowSize` | uint | 45 | Number of recent mints to average |

#### Schedule (mode 0x04)
```json
{
  "mode": 4,
  "params": {
    "schedule": [
      { "h": 0, "d": 10 },
      { "h": 5000, "d": 100 },
      { "h": 8000, "d": 1000 }
    ]
  }
}
```
| Field | Type | Description |
|-------|------|-------------|
| `schedule` | array | Ordered list of `{h: height, d: difficulty}` breakpoints |

Difficulty interpolates linearly between breakpoints.

---

## 4. v2 Contract Specification (Fully On-Chain — Hard Fork)

> **Architecture change:** The Radiant V2 hard fork adds `OP_BLAKE3` (0xee) and
> `OP_K12` (0xef) opcodes plus enables `OP_LSHIFT`/`OP_RSHIFT`. ALL algorithms are
> validated on-chain. ALL new contracts use the V2 format.

### 4.1 Decision Matrix

| Token Config | Contract Format | PoW Opcode | DAA |
|-------------|----------------|-----------|-----|
| v1 token (no `dmint` in CBOR) | **v1** (legacy) | OP_HASH256 | Fixed (on-chain) |
| v2 + algo=SHA256d + daa=fixed | **v2** | OP_HASH256 | Fixed (on-chain) |
| v2 + algo=SHA256d + daa=asert | **v2** | OP_HASH256 | ASERT (on-chain) |
| v2 + algo=blake3 + any daa | **v2** | **OP_BLAKE3** | On-chain DAA |
| v2 + algo=k12 + any daa | **v2** | **OP_K12** | On-chain DAA |

> **V1 is read-only.** Photonic Wallet and Glyph Miner still parse and mine V1 contracts
> for backward compatibility, but all newly created contracts use V2 format.

### 4.2 V2 State Layout (Reordered)

The V2 state layout places **mutable DAA fields at the end** (top of stack) so the
PoW comparison and DAA computation work with natural stack access:

```
┌─────────────────────── State Data (10 items) ────────────┐
│  1. <height:4B>           (mutable: incremented each mint)│
│  2. d8 <contractRef:36B>  (immutable: singleton ref)      │
│  3. d0 <tokenRef:36B>     (immutable: token ref)          │
│  4. <maxHeight:minimal>   (immutable: max mint count)     │
│  5. <reward:minimal>      (immutable: photons per mint)   │
│  6. <algoId:minimal>      (immutable: 0=sha256d/1=b3/2=k12)│
│  7. <daaMode:minimal>     (immutable: 0=fixed/1=epoch/2=asert/3=lwma)│
│  8. <targetTime:minimal>  (immutable: target secs between mints)│
│  9. <lastTime:4B>         (mutable: timestamp of last mint)│
│ 10. <target:minimal>      (mutable: current PoW target)   │
├─────────────────────── Separator ────────────────────────┤
│ OP_STATESEPARATOR (bd)                                    │
├─────────────────────── Bytecode (immutable) ─────────────┤
│ Part A: Preimage construction + <powHashOp>               │
│ Part B: PoW check + DAA computation + stack cleanup       │
│ Part C: Output validation (code script continuity +       │
│         token reward + height/maxHeight checks)           │
└──────────────────────────────────────────────────────────┘
```

**Key design decisions:**
- **`target` at end (position 0)**: Directly below PoW `value` on stack — PoW comparison is natural
- **`lastTime` at position 1**: DAA reads it with `OP_1 PICK` after txlocktime push
- **`targetTime` at position 2**: DAA reads it with `OP_PICK` at correct depth
- **`daaMode` in state**: For indexer/parser identification (bytecode encodes it implicitly too)
- **`halfLife`, `asymptote` in bytecode**: Immutable constants pushed in code section, NOT state items
- **`lastTime` initialized to creation block timestamp**: Prevents extreme drift on first mint

**Comparison with v1:**

| Field | V1 Position | V2 Position | Notes |
|-------|------------|------------|-------|
| height | 0 (bottom) | 0 (bottom) | Same |
| contractRef | 1 | 1 | Same |
| tokenRef | 2 | 2 | Same |
| maxHeight | 3 | 3 | Same |
| reward | 4 | 4 | Same |
| target | 5 (top) | **9 (top)** | Moved to end |
| algoId | — | 5 | New in V2 |
| daaMode | — | 6 | New in V2 |
| targetTime | — | 7 | New in V2 |
| lastTime | — | 8 | New in V2 |

### 4.3 V2 Bytecode Structure

The V2 bytecode is composed of three parts, with the DAA section varying by mode:

```
┌─── Part A: Preimage Construction ─────────────────────────┐
│ OP_1 OP_DROP                     // padding (v1 compat)    │
│ OP_OUTPOINTTXHASH                // push txHash (0xc8)     │
│ <contractRefPickIndex> OP_PICK   // copy contractRef       │
│ OP_CAT OP_SHA256                 // sha256(txHash||cRef)   │
│ <ioPickIndex> OP_PICK            // copy inputHash         │
│ <ioPickIndex> OP_PICK            // copy outputHash        │
│ OP_CAT OP_SHA256                 // sha256(iH||oH)         │
│ OP_CAT                           // concat both halves     │
│ <nonceRollIndex> OP_ROLL         // move nonce to top      │
│ OP_CAT                           // full preimage          │
│ <powHashOp>                      // OP_HASH256/BLAKE3/K12  │
├─── Part B: PoW Check + DAA ───────────────────────────────┤
│ B.1: Hash extraction (reverse, split, zeros check)         │
│ B.2: Target comparison (preserve target for DAA)           │
│ B.3: DAA computation (mode-specific, see §4.4–4.6)        │
│ B.4: Stack cleanup (drop V2 extras to 8-item V1 base)     │
├─── Part C: Output Validation ─────────────────────────────┤
│ (Same as V1: code script continuity, token reward,         │
│  height/maxHeight, singleton preservation)                 │
└───────────────────────────────────────────────────────────┘
```

**Part A indices** for `stateItemCount = 10`:

> **Note:** Only `OP_OUTPOINTTXHASH` (0xc8) is pushed in Part A. The previously-present
> `OP_INPUTINDEX` (0xc0) was a spurious opcode — its value was never consumed, leaving a
> ghost item on the stack that caused B.2's `OP_1 PICK` to read `inputIndex` instead of
> `target`. Contracts starting with `5175c8` (no `c0`) are correct; old `5175c0c8`
> contracts will fail to mine and must be redeployed.

| Index | Formula | V2 (10 items) |
|-------|---------|---------------|
| contractRefPickIndex | stateItemCount - 1 | **9** |
| inputOutputPickIndex | stateItemCount + 3 | **13** |
| nonceRollIndex | stateItemCount + 4 | **14** |

**Stack after Part A + powHashOp** (14 items):
```
pos 0:  hash_result (32 bytes)
pos 1:  target              ← V2 top state item
pos 2:  lastTime
pos 3:  targetTime
pos 4:  daaMode
pos 5:  algoId
pos 6:  reward
pos 7:  maxHeight
pos 8:  tokenRef
pos 9:  contractRef
pos 10: height
pos 11: outputIndex         ← scriptSig items
pos 12: outputHash
pos 13: inputHash
```
(nonce was consumed by OP_ROLL + OP_CAT)

### 4.3.1 Part B.1: PoW Hash Extraction (shared, all modes)

Same as V1. Extracts the numeric PoW value from the hash:

```
Hex:  bc 01 14 7f 77 58 7f 04 00000000 88 81 76 00 a2 69
ASM:  OP_REVERSEBYTES
      OP_PUSH(0x14)          // push 20
      OP_SPLIT               // split reversed hash at byte 20
      OP_NIP                 // keep right part (12 bytes = hash[0..11] reversed)
      OP_8                   // push 8
      OP_SPLIT               // split: left=value(8B), right=firstFourBytes(4B)
      OP_PUSH(0x00000000)    // push 4 zero bytes
      OP_EQUALVERIFY         // require first 4 bytes are zero
      OP_BIN2NUM             // convert 8-byte value to script number
      OP_DUP                 // duplicate value
      OP_0                   // push 0
      OP_GREATERTHANOREQUAL  // value >= 0
      OP_VERIFY              // require non-negative
```

**Stack after B.1:** `[..., target, value]` (value at pos 0, target at pos 1)

### 4.3.2 Part B.2: Target Comparison with Preservation (V2)

V2 preserves `target` on the stack for DAA computation:

```
Hex:  51 79 7c a2 69
ASM:  OP_1 OP_PICK       // copy target (pos 1) → [target_copy, value, target, ...]
      OP_SWAP             // → [value, target_copy, target, ...]
      OP_GREATERTHANOREQUAL  // target_copy >= value (= value <= target)
      OP_VERIFY           // require PoW is valid
```

**Stack after B.2:** `[target, lastTime, targetTime, daaMode, algoId, reward, maxHeight, tokenRef, contractRef, height, outputIndex, outputHash, inputHash]` (13 items)

### 4.3.3 Part B.4: Stack Cleanup (shared, all modes)

After DAA computation (or no-op for fixed mode), drop the 5 V2 extras to
normalize the stack to the V1 8-item base for Part C:

```
Hex:  75 75 75 75 75
ASM:  OP_DROP OP_DROP OP_DROP OP_DROP OP_DROP
```

Items dropped: `new_target` (or unchanged target), `lastTime`, `targetTime`, `daaMode`, `algoId`

**Stack after cleanup:** `[reward, maxHeight, tokenRef, contractRef, height, outputIndex, outputHash, inputHash]` (8 items — same as V1)

### 4.4 DAA Mode: Fixed (daaMode = 0x00)

No DAA computation. Target never changes.

**Part B.3 bytecode:** *(empty — 0 bytes)*

The full Part B for fixed mode:
```
B.1 (extraction):  bc01147f77587f040000000088817600a269
B.2 (comparison):  51797ca269
B.3 (DAA):         (empty)
B.4 (cleanup):     7575757575
```

### 4.5 DAA Mode: ASERT-Lite (daaMode = 0x02) — Recommended Default

On-chain ASERT-lite uses `OP_LSHIFT`/`OP_RSHIFT` for power-of-2 adjustments.
`halfLife` is embedded as a bytecode constant (not a state item).

**Part B.3 ASERT bytecode** (entry stack: `[target, lastTime, targetTime, daaMode, ...]`):

```
// ── Step 1: Read current timestamp ──────────────────────
c5                   // OP_TXLOCKTIME → push currentTime from nLockTime
                     // Stack: [currentTime, target, lastTime, targetTime, ...]

// ── Step 2: time_delta = currentTime - lastTime ─────────
52 79                // OP_2 PICK: copy lastTime (pos 2)
94                   // OP_SUB: currentTime - lastTime = time_delta
                     // Stack: [time_delta, target, lastTime, targetTime, ...]

// ── Step 3: excess = time_delta - targetTime ────────────
53 79                // OP_3 PICK: copy targetTime (pos 3)
94                   // OP_SUB: time_delta - targetTime = excess
                     // Stack: [excess, target, lastTime, targetTime, ...]

// ── Step 4: drift = excess / halfLife ───────────────────
<pushMinimal(halfLife)>  // bytecode constant (e.g. 02 1027 for 10000)
96                   // OP_DIV: excess / halfLife = drift
                     // Stack: [drift, target, lastTime, targetTime, ...]

// ── Step 5: Clamp drift to [-4, +4] ────────────────────
76 54 a0             // DUP, OP_4, GT: drift > 4?
63                   // IF
  75 54              //   DROP drift, push 4 (clamp to +4)
68                   // ENDIF
76 54 81 9f          // DUP, OP_4, NEGATE, LT: drift < -4?
63                   // IF
  75 54 81           //   DROP drift, push -4 (clamp to -4)
68                   // ENDIF
                     // Stack: [clamped_drift, target, lastTime, targetTime, ...]

// ── Step 6: Apply shift to target ───────────────────────
//   OP_LSHIFT: (x n -- x<<n), OP_RSHIFT: (x n -- x>>n)
//   drift > 0 → easier (target increases)
//   drift < 0 → harder (target decreases)
//   drift = 0 → unchanged
76 00 a0             // DUP drift, push 0, GT: drift > 0?
63                   // IF (drift > 0)
  98                 //   OP_LSHIFT: target << drift → new_target
67                   // ELSE
  76 00 9f           //   DUP drift, push 0, LT: drift < 0?
  63                 //   IF (drift < 0)
    81 99            //     NEGATE → |drift|, OP_RSHIFT: target >> |drift|
  67                 //   ELSE (drift == 0)
    75               //     DROP drift, target unchanged
  68                 //   ENDIF
68                   // ENDIF
                     // Stack: [new_target, lastTime, targetTime, daaMode, ...]

// ── Step 7: Clamp target to minimum 1 ──────────────────
76 51 9f             // DUP, OP_1, LT: new_target < 1?
63                   // IF
  75 51              //   DROP, push 1
68                   // ENDIF
                     // Stack: [clamped_new_target, lastTime, targetTime, daaMode, ...]
```

**ASERT opcode budget:** ~50 bytes + halfLife push. Well within limits.

### 4.6 DAA Mode: Linear (daaMode = 0x03)

Simpler alternative using `OP_MUL`/`OP_DIV`:

```
new_target = old_target * time_delta / targetTime
```

**Part B.3 Linear bytecode** (entry stack: `[target, lastTime, targetTime, daaMode, ...]`):

```
c5                   // OP_TXLOCKTIME → currentTime
52 79                // OP_2 PICK lastTime
94                   // OP_SUB → time_delta
                     // Stack: [time_delta, target, lastTime, targetTime, ...]
7c                   // OP_SWAP → [target, time_delta, lastTime, targetTime, ...]
95                   // OP_MUL → [target * time_delta, lastTime, targetTime, ...]
53 79                // OP_3 PICK targetTime (shifted by consumed items)
96                   // OP_DIV → [new_target, lastTime, targetTime, ...]
// Clamp to minimum 1
76 51 9f 63 75 51 68
```

**Linear opcode budget:** ~20 bytes.

### 4.7 Security Properties

| Property | v1 Contract | v2 Contract |
|----------|------------|------------|
| PoW validated on-chain | ✅ SHA256d | ✅ SHA256d/Blake3/K12 |
| Griefing prevention | ✅ PoW required | ✅ PoW required |
| Trustless verification | ✅ | ✅ |
| SPV-provable mints | ✅ | ✅ |
| DAA manipulation | N/A (fixed) | Bounded by clamp (±4 shift/mint) |
| Timestamp gaming | N/A | ≤2hr window (consensus MTP bounded) |
| State continuity | Code script hash | Code script hash |

### 4.8 Radiant Opcodes Used by V2 Contracts

| Opcode | Hex | Purpose |
|--------|-----|---------|
| OP_TXLOCKTIME | 0xc5 | Read nLockTime (DAA timestamp source) |
| OP_OUTPOINTTXHASH | 0xc8 | Get txid from input outpoint (Part A preimage) |
| OP_ACTIVEBYTECODE | 0xc1 | Read current input's full script |
| OP_OUTPUTBYTECODE | 0xcd | Read output script by index |
| OP_STATESCRIPTBYTECODE_OUTPUT | 0xec | Read output state script by index |
| OP_CODESCRIPTHASHOUTPUTCOUNT_UTXOS | 0xe5 | Count inputs by code script hash |
| OP_CODESCRIPTHASHOUTPUTCOUNT_OUTPUTS | 0xe6 | Count outputs by code script hash |
| OP_HASH256 | 0xaa | SHA256d hash (PoW + integrity) |
| OP_BLAKE3 | 0xee | Blake3 hash (PoW) |
| OP_K12 | 0xef | KangarooTwelve hash (PoW) |
| OP_LSHIFT | 0x98 | Left shift (ASERT target increase) |
| OP_RSHIFT | 0x99 | Right shift (ASERT target decrease) |
| OP_STATESEPARATOR | 0xbd | State/code boundary |

---

## 5. Indexer Role (Simplified — Analytics Only)

> **Key change:** With fully on-chain PoW and DAA, the indexer (RXinDexer) no longer
> validates PoW or computes DAA targets. It becomes a **convenience/analytics layer**.
> All trust-critical validation happens in consensus.

### 5.1 What the Indexer Does NOT Do Anymore

- ~~Validate PoW hashes for non-SHA256d algorithms~~ → On-chain via OP_BLAKE3/OP_K12
- ~~Compute DAA targets~~ → On-chain via OP_LSHIFT/OP_RSHIFT + OP_MUL/OP_DIV
- ~~Reject invalid mints~~ → Consensus rejects them (invalid script)

### 5.2 What the Indexer Still Does

1. **Token discovery**: Detect new dMint contracts and index metadata
2. **State tracking**: Read current height, target, reward from on-chain UTXOs
3. **Analytics**: Mint history, hashrate estimation, profitability ranking
4. **API for miners**: Provide contract list and current state (convenience — miner
   could also read on-chain directly, but API is faster)

### 5.3 Indexer API Endpoints (Unchanged)

```
GET /dmint/contracts                     — List mineable contracts
GET /dmint/contract/:ref                 — Contract details + current on-chain state
GET /dmint/contract/:ref/history         — Mint history for analytics
```

**Contract details response:**
```json
{
  "ref": "abc123...00000000",
  "version": 2,
  "algorithm": "blake3",
  "algorithm_id": 1,
  "daa": "asert-lite",
  "height": 5000,
  "max_height": 10000,
  "reward": 100,
  "current_target": "0000000003a2f8c1...",
  "last_mint_time": 1707500000,
  "target_time": 60,
  "estimated_hashrate": "1.2 GH/s"
}
```

**Note:** All values in this response are read directly from the on-chain UTXO state.
The indexer adds only derived analytics (hashrate estimate, profitability score).

---

## 6. Miner Integration

### 6.1 Algorithm Selection Flow

```
1. Fetch contract UTXO (on-chain state)
2. Parse state data: height, target, algoId, lastTime, targetTime
3. Read CBOR metadata from reveal tx for display info (name, ticker)
4. Determine algorithm from algoId in state data:
   a. 0x00 → sha256d (v1 compatible)
   b. 0x01 → blake3
   c. 0x02 → k12
5. Target is read directly from on-chain state (no indexer needed)
6. Load appropriate GPU shader
7. Configure buffer layout per algorithm
8. Start mining loop
```

### 6.2 Buffer Layouts Per Algorithm

#### SHA256d (algo 0x00) — v1 compatible
```
Binding 0: midstate    — 32 bytes (8 × u32), SHA256 partial hash
Binding 1: nonce       — 8 bytes (2 × u32), [nonce1, nonce2]
Binding 2: results     — 4 bytes (1 × u32), found nonce2
```

#### Blake3 (algo 0x01)
```
Binding 0: midstate    — 64 bytes (16 × u32), blake3 state after first block
Binding 1: nonce       — 8 bytes (2 × u32), [nonce1, nonce2]
Binding 2: target      — 32 bytes (8 × u32), full target for comparison
Binding 3: results     — 4 bytes (1 × u32), found nonce2
```

#### KangarooTwelve (algo 0x02)
```
Binding 0: midstate    — 200 bytes (50 × u32), keccak state
Binding 1: nonce       — 8 bytes (2 × u32), [nonce1, nonce2]
Binding 2: target      — 32 bytes (8 × u32), full target
Binding 3: results     — 4 bytes (1 × u32), found nonce2
```

#### Argon2id-Light (algo 0x03) — DEFERRED (no on-chain opcode yet)
```
Binding 0: midstate    — 64 bytes (16 × u32), preimage data
Binding 1: nonce       — 8 bytes (2 × u32), [nonce1, nonce2]
Binding 2: target      — 32 bytes (8 × u32), full target
Binding 3: memory      — 64 MB, argon2 memory blocks
Binding 4: results     — 4 bytes (1 × u32), found nonce2
```
> Argon2id-Light is deferred pending further analysis of memory-hardness DoS risks
> for an on-chain opcode. May be added in a future hard fork.

### 6.3 CPU Verification Per Algorithm

```typescript
function verify(algorithm: AlgorithmId, target: bigint, 
                preimage: Uint8Array, nonce: string): boolean {
  const fullPreimage = concat(preimage, hexToBytes(nonce)); // 72 bytes
  
  let hash: Uint8Array;
  switch (algorithm) {
    case 'sha256d':
      hash = sha256(sha256(fullPreimage));
      // First 4 bytes must be zero
      if (hash[0] || hash[1] || hash[2] || hash[3]) return false;
      // Next 8 bytes < target
      return readBigUint64BE(hash, 4) < target;
      
    case 'blake3':
      hash = blake3(fullPreimage, { dkLen: 32 });
      return readBigUint256BE(hash) < target;
      
    case 'k12':
      hash = k12(fullPreimage, { dkLen: 32 });
      return readBigUint256BE(hash) < target;
      
    // case 'argon2light': DEFERRED — no on-chain opcode yet
    //   hash = argon2id(fullPreimage, salt, { t: 3, m: 64, p: 1, dkLen: 32 });
    //   return readBigUint256BE(hash) < target;
  }
}
```

**Note:** SHA256d uses the v1 target format (4-byte-zero prefix + 8-byte comparison).
Other algorithms use full 32-byte hash comparison against a 256-bit target.

### 6.4 Target Format Differences

| Algorithm | Target Format | Comparison |
|-----------|--------------|------------|
| SHA256d | 64-bit (with implicit 32-bit zero prefix) | `hash[4..12] < target` |
| Blake3 | 256-bit | `hash[0..32] < target` |
| K12 | 256-bit | `hash[0..32] < target` |
| Argon2id-Light | 256-bit | `hash[0..32] < target` | *(deferred)* |

For v2 algorithms, the target is a full 256-bit value stored as 8 × u32 (big-endian).
Conversion between difficulty and 256-bit target:

```
target_256 = MAX_TARGET_256 / difficulty
MAX_TARGET_256 = 2^256 - 1
```

For SHA256d (v1 compatible), the target is stored as a 64-bit value with implicit
first-4-bytes-zero check:

```
target_64 = MAX_TARGET_64 / difficulty
MAX_TARGET_64 = 0x7FFFFFFFFFFFFFFF
valid = (hash[0..4] == 0) AND (hash[4..12] < target_64)
```

---

## 7. Deployment Flow

### 7.1 Deploying a v2 dMint Token

```
1. Creator builds CBOR metadata with dmint field
2. Creator chooses algorithm and DAA mode
3. System selects contract bytecode per algorithm:
   - algo=SHA256d + fixed DAA → v1 contract bytecode (backward compatible)
   - algo=SHA256d + dynamic DAA → v2-sha256d bytecode (OP_HASH256 + DAA)
   - algo=blake3 → v2-blake3 bytecode (OP_BLAKE3 + DAA)
   - algo=k12 → v2-k12 bytecode (OP_K12 + DAA)
4. Commit transaction created (hash of CBOR)
5. Reveal transaction created:
   - Input: spends commit output
   - ScriptSig: gly magic + CBOR payload
   - Output 0: dMint contract (state + bytecode) with initial target, lastTime=0
   - Output 1: token ref
6. Contract is live — miners read state directly from UTXO
7. Indexer detects and indexes for discovery/analytics (optional)
8. All PoW and DAA validation happens on-chain at consensus level
```

### 7.2 Example: Deploy Blake3 Token with ASERT DAA

```json
{
  "v": 2,
  "p": [1, 4],
  "name": "Fast Token",
  "ticker": "FAST",
  "dmint": {
    "algo": 1,
    "maxHeight": 100000,
    "reward": 50,
    "premine": 0,
    "diff": 100,
    "daa": {
      "mode": 2,
      "params": {
        "targetTime": 60,
        "halfLife": 3600
      }
    }
  }
}
```

On-chain state data:
```
<00000000>                              // height = 0
d8<contractRef:36B>                     // singleton
d0<tokenRef:36B>                        // token ref
<pushMinimal(100000)>                   // maxHeight
<pushMinimal(50)>                       // reward
<pushMinimal(target_from_diff_100)>     // initial target
<01>                                    // algoId = blake3
bd                                      // OP_STATESEPARATOR
<v2_contract_bytecode>                  // state-only validation
```

---

## 8. Migration and Compatibility

### 8.1 v1 Token Compatibility

| Aspect | Behavior |
|--------|----------|
| Existing v1 tokens | Continue working unchanged |
| v1 miner on v1 token | Works (SHA256d, fixed target) |
| v2 miner on v1 token | Works (detects no `dmint`, uses SHA256d) |
| v1 miner on v2 SHA256d token | Works (same contract bytecode) |
| v1 miner on v2 blake3 token | **Fails** (different algorithm) |

### 8.2 Indexer Compatibility

| Indexer Version | v1 Tokens | v2 SHA256d Tokens | v2 Other Tokens |
|----------------|-----------|-------------------|-----------------|
| v1 indexer | Full support | Partial (no DAA) | Not supported |
| v2 indexer | Full support | Full support | Full support |

### 8.3 Wallet Compatibility

| Wallet | Behavior |
|--------|----------|
| v1 wallet (Photonic) | Displays v2 dMint tokens as basic FT |
| v2 wallet | Full v2 dMint support with algorithm display |

---

## 9. Security Analysis

### 9.1 Threat Model

| Threat | v1 Contract | v2 Contract | Mitigation |
|--------|------------|------------|------------|
| Invalid PoW submission | Rejected by script | **Rejected by script** | On-chain OP_BLAKE3/OP_K12 |
| State griefing | Prevented by PoW | **Prevented by PoW** | All algorithms validated on-chain |
| DAA manipulation | N/A (fixed) | Bounded timestamps | Clamp ±4 shift/mint, consensus MTP |
| Algorithm downgrade | N/A | Bytecode is immutable | Contract locks to specific OP_* |
| Nonce reuse | Rejected (diff UTXO) | Rejected (diff UTXO) | Unique preimage per state |
| Integer overflow in DAA | N/A | Possible | 64-bit safeMul checks, clamp values |
| DAA formula bug | N/A | **Immutable once deployed** | Extensive testing before mainnet |

### 9.2 Recommendations

1. **All algorithms now have on-chain PoW** — no trust trade-off between algorithms
2. **DAA mode**: ASERT-lite recommended; clamp shift to ±4 per mint
3. **Minimum difficulty**: Follow recommended minimums per algorithm (see whitepaper §11.6)
4. **Test DAA extensively**: On-chain DAA formulas cannot be patched after deployment
5. **Timestamp bounds**: Contract should enforce `lastTime < current_time < lastTime + MAX_DELTA`

---

## 10. Implementation Phases

> **Full plan:** See [Radiant V2 Hard Fork Upgrade Plan](../../../Desktop/Misc%20Ecosystem%20Documents/Radiant_V2_Hard_Fork_Upgrade_Plan.md)

### Phase 2 (Design — Complete)
- [x] Define v2 CBOR metadata format
- [x] Define on-chain contract variants (fully on-chain with new opcodes)
- [x] Define miner buffer layouts per algorithm
- [x] Define target format differences
- [x] Update `types.ts` with DAA types
- [x] Create hard fork upgrade plan document

### Hard Fork (Radiant Core)
- [ ] Implement OP_BLAKE3 in Radiant Core (crypto + opcode + tests)
- [ ] Implement OP_K12 in Radiant Core (leverage Keccak + tests)
- [ ] Enable OP_LSHIFT/OP_RSHIFT (flip disabled flag + tests)
- [ ] Activation height gating + functional tests

### Phase 3 (Miner)
- [ ] Implement blake3 GPU shader (`blake3.wgsl`)
- [ ] Implement k12 GPU shader (`k12.wgsl`)
- [ ] Multi-algorithm miner loop in `miner.ts`
- [ ] On-chain target reading (no indexer dependency)
- [ ] CPU verification for blake3 and k12

### Ecosystem Upgrades
- [ ] radiantblockchain-constants: add OP_BLAKE3, OP_K12
- [ ] radiantjs: new opcodes in interpreter
- [ ] RadiantScript: blake3(), k12() global functions
- [ ] rxdeb: mirror Core opcode changes
- [ ] RXinDexer: v2 dMint detection + analytics (simplified)
- [ ] Photonic Wallet: v2 contract bytecodes + deployment UI
- [ ] Write v2 contract bytecodes per algorithm

### Integration Testing
- [ ] End-to-end: deploy + mine v2 Blake3 token on testnet
- [ ] End-to-end: deploy + mine v2 K12 token on testnet
- [ ] Backward compatibility: v1 tokens unchanged after fork
- [ ] Cross-tool consistency: radiantjs matches Core for new opcodes

---

## Appendix A: CBOR Encoding Example

A v2 dMint token with blake3 + ASERT DAA, CBOR-encoded:

```
Key-sorted CBOR map:
{
  "daa":       {"mode": 2, "params": {"halfLife": 3600, "targetTime": 60}},
  "diff":      100,
  "dmint":     ... (nested in root),
  "maxHeight": 100000,
  "name":      "Fast Token",
  "p":         [1, 4],
  "premine":   0,
  "reward":    50,
  "ticker":    "FAST",
  "v":         2
}
```

Note: The `dmint` object is a top-level field in the CBOR payload, containing
`algo`, `maxHeight`, `reward`, `premine`, `diff`, and `daa` as sub-fields.

## Appendix B: Algorithm Preimage Formats

All algorithms use the same 64-byte preimage structure from v1:

```
preimage[0..31]  = SHA256(txid || contractRef)        // 32 bytes
preimage[32..63] = SHA256(SHA256d(inputScript) ||     // 32 bytes
                          SHA256d(outputScript))
```

The midstate optimization differs per algorithm:

| Algorithm | Midstate | Size | Description |
|-----------|----------|------|-------------|
| SHA256d | SHA256 partial hash | 32B | After hashing first 512-bit block |
| Blake3 | First block state | 64B | Blake3 state after absorbing preimage |
| K12 | Keccak state | 200B | Keccak-p state after absorbing preimage |
| Argon2id-Light | Raw preimage | 64B | No midstate; full preimage passed |

## Appendix C: Difficulty ↔ Target Conversion

### SHA256d (v1 format)
```
MAX_TARGET = 0x7FFFFFFFFFFFFFFF (63-bit)
target = MAX_TARGET / difficulty
valid = (first_4_bytes == 0) AND (next_8_bytes < target)
```

### v2 Algorithms (256-bit format)
```
MAX_TARGET = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF
target = MAX_TARGET / difficulty
valid = (full_32_byte_hash < target)
```

### Conversion between formats
```
difficulty_v1 = MAX_TARGET_64 / target_64
difficulty_v2 = MAX_TARGET_256 / target_256

# Same difficulty value means same expected hash count:
# E[hashes] = 2^32 * (MAX_TARGET_64 / target_64)  for SHA256d
# E[hashes] = MAX_TARGET_256 / target_256           for v2 algos
```
