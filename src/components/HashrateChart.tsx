import { useEffect, useId, useRef, useState } from "react";
import { Box } from "@chakra-ui/react";
import { useSignals } from "@preact/signals-react/runtime";
import { hashrate } from "../signals";

type HashrateChartProps = {
  width?: number;
  height?: number;
  /** Number of samples retained in the ring buffer. */
  points?: number;
  /** Sampling cadence in ms. */
  intervalMs?: number;
};

/**
 * Dependency-free inline-SVG sparkline of recent hashrate. Uses a LOCAL ring
 * buffer sampled on an interval (cleaned up on unmount) rather than a signal —
 * this decouples the chart cadence from the GPU-batch write cadence of
 * `hashrate.value` and avoids re-rendering every useSignals() consumer.
 */
export default function HashrateChart({
  width = 200,
  height = 44,
  points = 60,
  intervalMs = 1000,
}: HashrateChartProps) {
  useSignals();
  const gradId = useId();
  const [buf, setBuf] = useState<number[]>([]);
  // Keep the latest value reachable inside the interval without re-subscribing.
  const latest = useRef(0);
  latest.current = hashrate.value;

  useEffect(() => {
    const id = setInterval(() => {
      setBuf((prev) => [...prev.slice(-(points - 1)), latest.current]);
    }, intervalMs);
    return () => clearInterval(id);
  }, [points, intervalMs]);

  const hasData = buf.length >= 2 && buf.some((v) => v > 0);
  const max = Math.max(...buf, 1);

  // Map the buffer to an SVG polyline; baseline-flat until we have data.
  const stepX = buf.length > 1 ? width / (buf.length - 1) : width;
  const pad = 3;
  const toY = (v: number) =>
    height - pad - (v / max) * (height - pad * 2);

  const linePoints = hasData
    ? buf.map((v, i) => `${i * stepX},${toY(v)}`).join(" ")
    : `0,${height - pad} ${width},${height - pad}`;

  const areaPath = hasData
    ? `M0,${height} L${buf
        .map((v, i) => `${i * stepX},${toY(v)}`)
        .join(" L")} L${width},${height} Z`
    : "";

  return (
    <Box opacity={hasData ? 1 : 0.45}>
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="Recent hashrate"
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop
              offset="0%"
              stopColor="var(--chakra-colors-accent-400)"
              stopOpacity="0.35"
            />
            <stop
              offset="100%"
              stopColor="var(--chakra-colors-accent-400)"
              stopOpacity="0"
            />
          </linearGradient>
        </defs>
        {hasData && <path d={areaPath} fill={`url(#${gradId})`} />}
        <polyline
          points={linePoints}
          fill="none"
          stroke="var(--chakra-colors-accent-400)"
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </Box>
  );
}
