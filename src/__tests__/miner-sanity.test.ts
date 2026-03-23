import { describe, it, expect } from 'vitest';
import { extractCodeScriptHashOp, mapHashOpToAlgorithm } from '../miner';

describe('Miner hash-op sanity helpers', () => {
  it('extracts sha256d hash opcode aa from codeScript', () => {
    const codeScript = '0011227ea87e5a7a7eaabc01147f3344';
    expect(extractCodeScriptHashOp(codeScript)).toBe('aa');
  });

  it('extracts blake3 hash opcode ee from codeScript', () => {
    const codeScript = 'deadbeef7ea87e5a7a7eeebc01147f00';
    expect(extractCodeScriptHashOp(codeScript)).toBe('ee');
  });

  it('extracts k12 hash opcode ef from codeScript', () => {
    const codeScript = 'cafebabe7ea87e5a7a7eefbc01147f';
    expect(extractCodeScriptHashOp(codeScript)).toBe('ef');
  });

  it('returns undefined for unmatched codeScript', () => {
    const codeScript = '001122334455';
    expect(extractCodeScriptHashOp(codeScript)).toBeUndefined();
  });

  it('maps hash opcodes to mining algorithms', () => {
    expect(mapHashOpToAlgorithm('aa')).toBe('sha256d');
    expect(mapHashOpToAlgorithm('ee')).toBe('blake3');
    expect(mapHashOpToAlgorithm('ef')).toBe('k12');
  });

  it('returns undefined for unknown hash opcode', () => {
    expect(mapHashOpToAlgorithm(undefined)).toBeUndefined();
  });
});
