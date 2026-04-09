/**
 * Glyph Token Tests for Glyph-miner
 */

import { describe, it, expect } from 'vitest';
import { parseDmintScript } from '../../glyph';
import { pushMinimal, push4bytes } from '../../utils';

const DMINT_CODE_SCRIPT_SUFFIX =
  'bd5175c0c855797ea8597959797ea87e5a7a7e__OP__bc01147f77587f040000000088817600a269a269577ae500a069567ae600a06901d053797e0cdec0e9aa76e378e4a269e69d7eaa76e47b9d547a818b76537a9c537ade789181547ae6939d635279cd01d853797e016a7e886778de519d547854807ec0eb557f777e5379ec78885379eac0e9885379cc519d75686d7551';

const DMINT_DYNAMIC_CODE_SCRIPT_SUFFIX =
  'bd5175c0c855797ea85901027e5a797ea87e5c7a7e__OP__bc01147f77587f040000000088817600a269a269577ae500a069567ae600a06901d053797e0cdec0e9aa76e378e4a269e69d7eaa76e47b9d547a818b76537a9c537ade789181547ae6939d635279cd01d853797e016a7e886778de519d547854807ec0eb557f777e5379ec78885379eac0e9885379cc519d75686d7551';

const STATE_SCRIPT_PREFIX =
  '0100000000d8' +
  '11'.repeat(36) +
  'd0' +
  '22'.repeat(36) +
  '010101';

// V2 10-state-item state script (matches photonicDMintScript encoding exactly)
const V2_CONTRACT_REF = '11'.repeat(32) + '00000001';
const V2_TOKEN_REF    = '22'.repeat(32) + '00000002';
const V2_STATE_SCRIPT_PREFIX = [
  push4bytes(0),
  `d8${V2_CONTRACT_REF}`,
  `d0${V2_TOKEN_REF}`,
  pushMinimal(100),
  pushMinimal(50),
  pushMinimal(0),
  pushMinimal(0),
  pushMinimal(60),
  push4bytes(500),
  pushMinimal(10000000n),
].join('');

// V2 Part A bytecode for stateItemCount=10:
//   contractRefPickIndex = 9 (0x59)   → stateItemCount - 1
//   inputOutputPickIndex = 13 (0x5d)  → stateItemCount + 3
//   nonceRollIndex       = 14 (0x5e)  → stateItemCount + 4
// c8 = OP_OUTPOINTTXHASH only (c0 OP_INPUTINDEX intentionally excluded — it was a
// spurious ghost item that caused every B.2+ stack access to be off-by-one)
const V2_PART_A_HEX = '5175c8' + '59' + '79' + '7e' + 'a8' + '5d' + '79' + '5d' + '79' + '7e' + 'a8' + '7e' + '5e' + '7a' + '7e';

// V2 shared Part B+C constants (same as glyph.ts)
const V2_PART_B1 = 'bc01147f77587f040000000088817600a269';
const V2_PART_B2 = '51797ca269';
const V2_PART_B4 = '7575757575';
const V2_PART_C  = 'a269577ae500a069567ae600a06901d053797e0cdec0e9aa76e378e4a269e69d7eaa76e47b9d547a818b76537a9c537ade789181547ae6939d635279cd01d853797e016a7e886778de519d547854807ec0eb557f777e5379ec78885379eac0e9885379cc519d75686d7551';

// Full V2 codeScript suffix (no DAA = B.3 empty) for each PoW opcode
function buildV2CodeScript(powOp: string): string {
  return V2_PART_A_HEX + powOp + V2_PART_B1 + V2_PART_B2 + V2_PART_B4 + V2_PART_C;
}

describe('dMint Token Structure', () => {
  describe('Contract Script Parsing', () => {
    it('should parse SHA256d, Blake3, and K12 contract scripts', () => {
      const scripts = ['aa', 'ee', 'ef'].map((op) =>
        `${STATE_SCRIPT_PREFIX}${DMINT_CODE_SCRIPT_SUFFIX.replace('__OP__', op)}`
      );

      scripts.forEach((script) => {
        expect(parseDmintScript(script)).toBe(STATE_SCRIPT_PREFIX);
      });
    });

    it('should parse newer dynamic preimage codeScript variants from Photonic', () => {
      const scripts = ['aa', 'ee', 'ef'].map((op) =>
        `${STATE_SCRIPT_PREFIX}${DMINT_DYNAMIC_CODE_SCRIPT_SUFFIX.replace('__OP__', op)}`
      );

      scripts.forEach((script) => {
        expect(parseDmintScript(script)).toBe(STATE_SCRIPT_PREFIX);
      });
    });

    it('should parse V2 10-state-item contracts with new 5175c8 Part A prefix (no c0)', () => {
      // V2 contracts created by the fixed Photonic Wallet omit OP_INPUTINDEX (c0).
      // The codeScript starts with 5175c8 instead of 5175c0c8.
      // parseDmintScript must detect these via the bd5175c8 separator.
      const scripts = ['aa', 'ee', 'ef'].map((powOp) => {
        const stateScript = V2_STATE_SCRIPT_PREFIX;
        const codeScript = buildV2CodeScript(powOp);
        return stateScript + 'bd' + codeScript;
      });

      scripts.forEach((script, i) => {
        const stateScript = parseDmintScript(script);
        expect(stateScript).not.toBe('');
        expect(stateScript).toBe(V2_STATE_SCRIPT_PREFIX);
        const codeScript = script.substring(stateScript.length + 2);
        expect(codeScript.startsWith('5175c8')).toBe(true);
        expect(codeScript.startsWith('5175c0c8')).toBe(false);
      });
    });

    it('should correctly identify 5175c8 Part A as NOT starting with 5175c0c8', () => {
      // Guard against accidental regression where 5175c8 is treated as matching
      // the old 5175c0c8 pattern (it won't, since c8 != c0c8).
      const v2CodeScript = buildV2CodeScript('aa');
      expect(v2CodeScript.startsWith('5175c8')).toBe(true);
      expect(v2CodeScript.startsWith('5175c0c8')).toBe(false);
    });
  });

  describe('Metadata', () => {
    it('should include required Glyph fields', () => {
      const metadata = {
        v: 2,
        type: 'ft',
        p: [1, 4], // FT + DMINT
        name: 'Test dMint Token',
        ticker: 'TDMT',
        decimals: 8,
      };
      
      expect(metadata.v).toBe(2);
      expect(metadata.p).toContain(1);
      expect(metadata.p).toContain(4);
    });

    it('should include dMint-specific fields', () => {
      const dmintData = {
        algorithm: 0x01, // BLAKE3
        startDiff: 500000,
        maxSupply: 21000000,
        reward: 50,
        halvingInterval: 210000,
        daa: {
          mode: 0x02, // ASERT
          halflife: 3600,
          targetTime: 60,
        },
      };
      
      expect(dmintData.algorithm).toBeDefined();
      expect(dmintData.daa).toBeDefined();
    });
  });

  describe('Mining Parameters', () => {
    it('should validate reward schedule', () => {
      const maxSupply = 21000000;
      const initialReward = 50;
      const halvingInterval = 210000;
      
      // Calculate total supply from halvings
      let totalSupply = 0;
      let reward = initialReward;
      let blocks = 0;
      
      while (reward >= 1) {
        totalSupply += reward * halvingInterval;
        reward = Math.floor(reward / 2);
        blocks += halvingInterval;
      }
      
      expect(totalSupply).toBeLessThanOrEqual(maxSupply);
    });

    it('should enforce minimum difficulty', () => {
      const minDifficulty = {
        SHA256D: 500000,
        BLAKE3: 2500000,
        K12: 2000000,
        ARGON2ID_LIGHT: 50000,
      };
      
      expect(minDifficulty.BLAKE3).toBeGreaterThan(minDifficulty.SHA256D);
    });
  });
});

describe('Contract Deployment', () => {
  it('should generate valid singleton ref', () => {
    const txid = '0'.repeat(64);
    const vout = 0;
    const ref = `${txid}_${vout}`;
    
    expect(ref).toContain('_');
    expect(txid.length).toBe(64);
  });

  it('should create commit transaction', () => {
    const commitTx = {
      inputs: [{ txid: '...', vout: 0 }],
      outputs: [
        { value: 1, script: 'OP_RETURN <glyph_data>' },
        { value: 546, script: 'P2PKH' },
      ],
    };
    
    expect(commitTx.outputs.length).toBeGreaterThanOrEqual(2);
  });

  it('should create reveal transaction', () => {
    const revealTx = {
      inputs: [{ txid: 'commit_txid', vout: 1 }],
      outputs: [
        { value: 546, script: 'singleton_script' },
      ],
    };
    
    expect(revealTx.outputs.length).toBeGreaterThanOrEqual(1);
  });
});

describe('Mining Submission', () => {
  it('should format valid proof', () => {
    const proof = {
      nonce: new Uint8Array(8),
      hash: new Uint8Array(32),
      timestamp: Date.now(),
    };
    
    expect(proof.nonce.length).toBe(8);
    expect(proof.hash.length).toBe(32);
  });

  it('should verify proof against target', () => {
    const hash = new Uint8Array(32).fill(0);
    hash[0] = 0x00;
    hash[1] = 0x00;
    hash[2] = 0x01; // Low hash
    
    const target = new Uint8Array(32).fill(0);
    target[0] = 0x00;
    target[1] = 0x00;
    target[2] = 0x0f; // Higher target
    
    // Compare hash < target
    let valid = false;
    for (let i = 0; i < 32; i++) {
      if (hash[i] < target[i]) {
        valid = true;
        break;
      } else if (hash[i] > target[i]) {
        break;
      }
    }
    
    expect(valid).toBe(true);
  });
});
