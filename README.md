# Glyph Miner

Glyph Miner is a web based miner used to mine tokens that follow the Glyphs Protocol, using a layer 1 mining contract.

Requires a browser that supports WebGPU.

A temporary wallet will be created that must be funded to pay transaction fees. Minted tokens can be sent to any address.

## Roadmap

- Replace temporary wallet with browser extension
- Difficulty adjustments

## Getting Started

### Install

```bash
pnpm install
```

### Run development server

```bash
pnpm dev
```

### Build

```bash
pnpm build
```

Build will be in `dist`. App can be served as a static site.

## Protocol

Glyphs are encoded in an unlocking script, identified by the string "gly" followed by a CBOR encoded token payload:

```
OP_PUSH "gly"
OP_PUSH <CBOR Payload>
```

Example CBOR payload:

```
{
    p: [1, 4],
    name: "My token",
    ticker: "XYZ",
    main: {
        t: "image/jpeg",
        b: <bytes>
    }
}
```

The `p` property contains an array of protocols used by the token. Current protocol identifiers are as follows:

| ID | Protocol           |
|----|--------------------|
| 1  | Fungible token     |
| 2  | Non-Fungible token |
| 3  | Data storage       |
| 4  | Decentralized mint |
| 5  | Mutable            |

For a mineable token, a `p` value of `[1, 4]` must be used, indicating the token implements the FT and dmint contracts.

The mint transaction must contain outputs for standard FT and dmint contracts.

### PoW algorithm

Mineable Glyphs use the follow proof-of-work algorithm:

```
hash = sha256(sha256(
    sha256(currentLocationTxid + contractRef) +
    sha256(anyInputHash + anyOutputHash) +
    nonce
))
```

Resulting hash must be below the target.

`anyInputHash` and `anyOutputHash` must be the hash of any input or output in the transaction. This allows work to be bound to the miner's address and prevents nonces being stolen. This will typically be a pay-to-public-key-hash but any script can be used. The contract will verify these scripts exist.

### Parallel contracts

Multiple mining contracts can be created for token. This can be used to reduce congestion for low difficulty contracts.

### Contract

Dmint contract is compiled from RadiantScript. See [contract.rad](src/contract.rad).

## License

MIT. See [LICENSE](LICENSE).
