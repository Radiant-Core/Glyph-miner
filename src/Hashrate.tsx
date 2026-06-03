import { useSignals } from "@preact/signals-react/runtime";
import { useRef, useEffect, useState } from "react";
import { hashrate, miningStatus } from "./signals";

const fixed = (n: number) => n.toFixed(2);

// Exponential moving average for smooth hashrate display
const SMOOTHING_FACTOR = 0.15; // Lower = smoother but slower to react

export default function Hashrate() {
  useSignals();
  const rawValue = hashrate.value;
  const status = miningStatus.value;
  const smoothedRef = useRef(rawValue);
  const [displayValue, setDisplayValue] = useState(rawValue);

  useEffect(() => {
    // Apply exponential moving average smoothing
    if (rawValue === 0) {
      smoothedRef.current = 0;
    } else {
      smoothedRef.current = smoothedRef.current * (1 - SMOOTHING_FACTOR) + rawValue * SMOOTHING_FACTOR;
    }
    setDisplayValue(smoothedRef.current);
  }, [rawValue]);

  const value = displayValue;

  // While mining is active but the first GPU batch hasn't yet completed (so
  // we have no measured rate), show an explicit "warming up…" instead of a
  // bare "0.00 H/s" — the latter looks like the miner is broken even though
  // it's actually dispatching work. The first batch typically takes 3–8 s.
  if ((status === "mining" || status === "change") && value === 0) {
    return "warming up…";
  }

  if (value > 1000000000) {
    return `${fixed(value / 1000000000)} Gh/s`;
  } else if (value > 1000000) {
    return `${fixed(value / 1000000)} Mh/s`;
  } else if (value > 1000) {
    return `${fixed(value / 1000)} Kh/s`;
  }
  return `${fixed(value)} H/s`;
}
