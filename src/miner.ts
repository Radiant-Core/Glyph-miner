import { sha256 as jsSha256, Hasher } from "js-sha256";
import { hexToBytes, bytesToHex } from "@noble/hashes/utils";
import { sha256 } from "@noble/hashes/sha2";
import { swapEndianness } from "@bitauth/libauth";
import { Work, AlgorithmId } from "./types";
import {
  contract,
  found,
  glyph,
  hashrate,
  miningStatus,
  mintMessage,
  wallet,
  work as workSignal,
} from "./signals";
import { addMessage } from "./message";
import { createWork, powPreimage } from "./pow";
import { foundNonce } from "./blockchain";
import { isAlgorithmSupported } from "./algorithms";
import { ALGORITHMS, calcTimeToMine } from "./algorithms/types";

// Import shaders as raw text
import sha256dShaderText from "./shaders/sha256d.wgsl?raw";
import blake3ShaderText from "./shaders/blake3.wgsl?raw";
import k12ShaderText from "./shaders/k12.wgsl?raw";

function signedToHex(number: number) {
  let value = Math.max(-2147483648, Math.min(2147483647, number));
  if (value < 0) {
    value += 4294967296;
  }
  return value.toString(16).padStart(8, "0");
}

// Map algorithm ID number to AlgorithmId string
function mapAlgorithmId(algoId: number): AlgorithmId {
  switch (algoId) {
    case 0x00: return 'sha256d';
    case 0x01: return 'blake3';
    case 0x02: return 'k12';
    case 0x03: return 'argon2light';
    case 0x04: return 'randomx-light';
    default: return 'sha256d';
  }
}

// Get algorithm - checks v2 glyph payload first, then falls back to contract (from API)
function getAlgorithm(): AlgorithmId {
  // First check v2 glyph payload for dmint.algo
  const payload = glyph.value?.payload;
  if (payload) {
    // Check for v2 version field
    const isV2 = payload.v === 2;
    
    // Check for dmint field with algorithm
    const dmint = payload.dmint as { algo?: number } | undefined;
    if (dmint && typeof dmint.algo === 'number') {
      const algo = mapAlgorithmId(dmint.algo);
      console.log(`Using algorithm from v2 glyph payload: ${dmint.algo} -> ${algo}`);
      return algo;
    }
    
    if (isV2) {
      console.log("v2 glyph without dmint.algo, checking contract");
    }
  }
  
  // Fall back to contract algorithm (set by blockchain.ts from dmint API)
  const algo = contract.value?.algorithm;
  if (algo) {
    console.log("Using algorithm from contract/API:", algo);
    return algo;
  }
  
  console.log("No algorithm found, defaulting to sha256d");
  return 'sha256d';
}

// Get shader code for algorithm
function getShaderCode(algorithm: AlgorithmId): string {
  switch (algorithm) {
    case 'blake3': return blake3ShaderText;
    case 'k12': return k12ShaderText;
    default: return sha256dShaderText;
  }
}

// Check if algorithm uses the v2 4-binding shader layout
// (midstate/target/results/nonce_offset) vs v1 3-binding (midstate/nonce/result)
function isV2ShaderLayout(algorithm: AlgorithmId): boolean {
  return algorithm === 'blake3' || algorithm === 'k12';
}

export function updateWork() {
  if (!contract.value || !wallet.value?.address) {
    workSignal.value = undefined;
    return;
  }
  
  // Get algorithm from v2 glyph payload or contract/API
  const algorithm = getAlgorithm();
  
  // Check if algorithm is supported
  if (!isAlgorithmSupported(algorithm)) {
    addMessage({ type: "general", msg: `Unsupported algorithm: ${algorithm}` });
    miningStatus.value = "stop";
    return;
  }
  
  // Create work with algorithm info
  const work = createWork(
    contract.value,
    wallet.value.address,
    mintMessage.value
  );
  
  // Add algorithm to work object
  (work as any).algorithm = algorithm;
  
  workSignal.value = work;
  
  // Log algorithm info
  const algoInfo = ALGORITHMS[algorithm];
  addMessage({ type: "general", msg: `Using ${algoInfo.name} algorithm` });
  
  // Show collision warning if applicable
  const timeToMine = calcTimeToMine(Number(contract.value.target), algorithm);
  if (timeToMine < 30) {
    addMessage({ type: "general", msg: `Warning: Fast expected solve time (${timeToMine}s) may cause collisions` });
  }
}

// Use js-sha256 to get the midstate after hashing the first 512 bit block
function partialHash(data: Uint8Array) {
  const hash = jsSha256.create();
  hash.update(data);
  // Make h properties accessible without an error
  const withH = hash as Hasher & {
    h0: number;
    h1: number;
    h2: number;
    h3: number;
    h4: number;
    h5: number;
    h6: number;
    h7: number;
  };
  return swapEndianness(
    [
      withH.h0,
      withH.h1,
      withH.h2,
      withH.h3,
      withH.h4,
      withH.h5,
      withH.h6,
      withH.h7,
    ]
      .map(signedToHex)
      .join("")
  );
}

function verify(target: bigint, partialPreimage: Uint8Array, nonce: string) {
  const preimage = new Uint8Array(partialPreimage.byteLength + 8);
  preimage.set(partialPreimage);
  preimage.set(hexToBytes(nonce), 64);

  const hash = sha256(sha256(preimage));

  // First four bytes must always be zero
  if (hash[0] !== 0 || hash[1] !== 0 || hash[2] !== 0 || hash[3] !== 0) {
    return false;
  }

  // Check next 8 bytes against target
  const view = new DataView(hash.slice(4, 12).buffer, 0);
  const num = view.getBigUint64(0, false);
  return num < target;
}

async function stop() {
  console.debug("miner.stop called");
  if (miningStatus.value !== "ready") {
    miningStatus.value = "stop";
    // Wait for mining to stop then return true
    return new Promise((resolve) => {
      const timer = setInterval(() => {
        if (miningStatus.value === "ready") {
          clearInterval(timer);
          resolve(true);
        }
      }, 100);
    });
  }
  return true;
}

function powMidstate(work: Work) {
  const preimage = powPreimage(work);
  const hash = hexToBytes(partialHash(preimage));
  return { preimage, hash };
}

const start = async () => {
  console.debug("miner.start called");
  const work = workSignal.value;
  if (!work) return;
  
  const algorithm: AlgorithmId = (work as any).algorithm || 'sha256d';
  const useV2Layout = isV2ShaderLayout(algorithm);
  
  let midstate = powMidstate(work);
  miningStatus.value = "mining";

  const adapter = await (navigator as any).gpu?.requestAdapter({
    powerPreference: "high-performance",
  });
  const device = await adapter?.requestDevice();
  if (!device) {
    throw new Error("No GPU device found.");
  }

  device.pushErrorScope("validation");
  device.pushErrorScope("internal");

  const shaderCode = getShaderCode(algorithm);
  const module = device.createShaderModule({
    label: `${algorithm} module`,
    code: shaderCode,
  });

  const pipeline = device.createComputePipeline({
    label: `${algorithm} pipeline`,
    layout: "auto",
    compute: {
      module,
      entryPoint: "main",
    },
  });

  const numWorkgroups = device.limits.maxComputeWorkgroupsPerDimension;
  const workgroupSize = 256;
  const numInvocations = numWorkgroups * workgroupSize;

  if (useV2Layout) {
    // V2 layout: 4 bindings (midstate/target/results/nonce_offset)
    // Blake3: midstate=64B (16 u32), K12: midstate=64B (16 u32 from preimage)
    const midstateSize = 64;
    const targetSize = 12; // 3 u32s (pad, high, low)
    const resultsSize = 256 * 16; // 256 vec4<u32>
    const nonceSize = 4; // 1 u32

    const midstateBuffer = device.createBuffer({
      label: "midstate buffer", size: midstateSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const targetBuffer = device.createBuffer({
      label: "target buffer", size: targetSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const resultsBuffer = device.createBuffer({
      label: "results buffer", size: resultsSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });
    const nonceOffsetBuffer = device.createBuffer({
      label: "nonce offset buffer", size: nonceSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    const bindGroup = device.createBindGroup({
      label: `${algorithm} bindGroup`,
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: midstateBuffer } },
        { binding: 1, resource: { buffer: targetBuffer } },
        { binding: 2, resource: { buffer: resultsBuffer } },
        { binding: 3, resource: { buffer: nonceOffsetBuffer } },
      ],
    });

    const gpuReadBuffer = device.createBuffer({
      size: 32, // Read first 2 vec4<u32> entries (result count + first result)
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    // Write midstate (first 64 bytes of preimage for Blake3/K12)
    device.queue.writeBuffer(midstateBuffer, 0, midstate.preimage.slice(0, 64));

    // Write target as 3 u32s: [0, high32, low32]
    const targetHigh = Number((work.target >> 32n) & 0xFFFFFFFFn);
    const targetLow = Number(work.target & 0xFFFFFFFFn);
    device.queue.writeBuffer(targetBuffer, 0, new Uint32Array([0, targetHigh, targetLow]));

    let nonceStart = 0;
    let startTime = Date.now();
    const maxNonce = 0xffffffff - numInvocations;

    while (miningStatus.value === "mining" || miningStatus.value === "change") {
      if (nonceStart > maxNonce) {
        hashrate.value = (nonceStart / (Date.now() - startTime)) * 1000;
        nonceStart = 0;
        startTime = Date.now();
      }

      // Clear results counter
      device.queue.writeBuffer(resultsBuffer, 0, new Uint32Array([0, 0, 0, 0]));
      // Write nonce offset
      device.queue.writeBuffer(nonceOffsetBuffer, 0, new Uint32Array([nonceStart]));

      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(numWorkgroups);
      pass.end();
      encoder.copyBufferToBuffer(resultsBuffer, 0, gpuReadBuffer, 0, 32);
      device.queue.submit([encoder.finish()]);

      await gpuReadBuffer.mapAsync(GPUMapMode.READ);
      const range = new Uint32Array(gpuReadBuffer.getMappedRange());
      const resultCount = range[0];
      if (resultCount > 0) {
        // First result at offset 4 (vec4<u32>): [nonce, hash0, hash1, flag]
        const foundNonceVal = range[4];
        const nonceHex = foundNonceVal.toString(16).padStart(8, "0") + "00000000";
        // For v2 algorithms, verify on CPU (TODO: implement CPU blake3/k12 verify)
        console.log(`${algorithm} solution found, nonce: ${nonceHex}`);
        foundNonce(nonceHex);
        addMessage({ type: "found", nonce: nonceHex });
        found.value++;
      }
      gpuReadBuffer.unmap();
      nonceStart += numInvocations;

      // @ts-expect-error doesn't matter
      if (miningStatus.value === "change") {
        updateWork();
        if (!workSignal.value) break;
        midstate = powMidstate(workSignal.value);
        device.queue.writeBuffer(midstateBuffer, 0, midstate.preimage.slice(0, 64));
        miningStatus.value = "mining";
      }
    }
  } else {
    // V1 layout: 3 bindings (midstate/nonce/result) — SHA256d
    const midstateBuffer = device.createBuffer({
      label: "midstate buffer", size: 32,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const resultBufferSize = 4;
    const resultBuffer = device.createBuffer({
      label: "pow result", size: resultBufferSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });
    const nonceBuffer = device.createBuffer({
      label: "nonce buffer", size: 8,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    const bindGroup = device.createBindGroup({
      label: "pow bindGroup",
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: midstateBuffer } },
        { binding: 1, resource: { buffer: nonceBuffer } },
        { binding: 2, resource: { buffer: resultBuffer } },
      ],
    });

    const gpuReadBuffer = device.createBuffer({
      size: resultBufferSize,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    let nonceStart = 0;
    let nonce1 = Math.round(Math.random() * 0xffffffff);
    let startTime = Date.now();
    const maxNonce = 0xffffffff - numInvocations;

    device.queue.writeBuffer(midstateBuffer, 0, midstate.hash);

    while (miningStatus.value === "mining" || miningStatus.value === "change") {
      if (nonceStart > maxNonce) {
        hashrate.value = (nonceStart / (Date.now() - startTime)) * 1000;
        nonceStart = 0;
        nonce1++;
        if (nonce1 > 0xffffffff) {
          nonce1 = 0;
        }
        startTime = Date.now();
      }
      device.queue.writeBuffer(
        nonceBuffer, 0, new Uint32Array([nonce1, nonceStart])
      );

      const encoder = device.createCommandEncoder({ label: "pow encoder" });
      const pass = encoder.beginComputePass({ label: "pow compute pass" });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(numWorkgroups);
      pass.end();
      encoder.copyBufferToBuffer(resultBuffer, 0, gpuReadBuffer, 0, resultBufferSize);
      device.queue.submit([encoder.finish()]);

      await gpuReadBuffer.mapAsync(GPUMapMode.READ);
      const range = new Uint8Array(gpuReadBuffer.getMappedRange());
      const result = bytesToHex(range.slice(0, 4));
      if (result !== "00000000") {
        const nonceHex = `${nonce1.toString(16).padStart(8, "0")}${swapEndianness(result)}`;
        if (verify(work.target, midstate.preimage, nonceHex)) {
          console.log("Verified", nonceHex);
          foundNonce(nonceHex);
          addMessage({ type: "found", nonce: nonceHex });
          found.value++;
        }
      }
      device.queue.writeBuffer(resultBuffer, 0, new Uint32Array([0]));
      resultBuffer.unmap();
      gpuReadBuffer.unmap();
      nonceStart += numInvocations;

      // @ts-expect-error doesn't matter
      if (miningStatus.value === "change") {
        updateWork();
        console.debug("Changing work");
        if (!workSignal.value) { console.debug("Invalid work"); break; }
        midstate = powMidstate(workSignal.value);
        device.queue.writeBuffer(midstateBuffer, 0, midstate.hash);
        miningStatus.value = "mining";
      }
    }
  }

  hashrate.value = 0;
  miningStatus.value = "ready";
  console.log("State ready");
};

export default { start, stop };
