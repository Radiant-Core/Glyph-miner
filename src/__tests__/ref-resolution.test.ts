import { describe, expect, it } from "vitest";
import {
  deriveSubContractRef,
  deriveSubContractRefCandidates,
  normalizeRef,
} from "../utils";

describe("Reference resolution", () => {
  const txid = "a".repeat(64);

  it("normalizes compact refs to full 72-char refs", () => {
    expect(normalizeRef(`${txid}1`)).toBe(`${txid}00000001`);
    expect(normalizeRef(`${txid}0000000f`)).toBe(`${txid}0000000f`);
  });

  it("derives sub-contract refs from token vout+1 by default", () => {
    expect(deriveSubContractRef(`${txid}1`, 0)).toBe(`${txid}00000002`);
    expect(deriveSubContractRef(`${txid}1`, 3)).toBe(`${txid}00000005`);
  });

  it("derives candidate refs for both token-ref layouts", () => {
    expect(deriveSubContractRefCandidates(`${txid}1`, 0)).toEqual([
      `${txid}00000001`,
      `${txid}00000002`,
    ]);

    expect(deriveSubContractRefCandidates(`${txid}0000000a`, 2)).toEqual([
      `${txid}0000000c`,
      `${txid}0000000d`,
    ]);
  });
});
