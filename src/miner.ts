import { sha256 as jsSha256, Hasher } from "js-sha256";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { sha256 } from "@noble/hashes/sha2";
import { swapEndianness } from "@bitauth/libauth";
import { Work, AlgorithmId } from "./types";
import {
  contract,
  found,
  hashrate,
  miningStatus,
  mintMessage,
  wallet,
  work as workSignal,
} from "./signals";
import { addMessage } from "./message";
import { createWork, powPreimage } from "./pow";
import { foundNonce } from "./blockchain";
import { getAlgorithmConfig, isAlgorithmSupported } from "./algorithms";
import { ALGORITHMS, calcTimeToMine } from "./algorithms/types";

// Import shaders as raw text
import sha256dShaderText from "./shaders/sha256d.wgsl?raw";
import blake3ShaderText from "./shaders/blake3.wgsl?raw";
import k12ShaderText from "./shaders/k12.wgsl?raw";
import argon2lightShaderText from "./shaders/argon2light.wgsl?raw";

function signedToHex(number: number) {
  let value = Math.max(-2147483648, Math.min(2147483647, number));
  if (value < 0) {
    value += 4294967296;
  }
  return value.toString(16).padStart(8, "0");
}

// Parse algorithm from contract script
function parseAlgorithmFromContract(script: string): AlgorithmId {
  // Look for algorithm byte after target in enhanced contracts
  // Legacy contracts (no algorithm byte) default to sha256d
  try {
    // Simple heuristic: look for algorithm pattern
    // In production, this would parse the actual script structure
    if (script.includes('0x01')) return 'blake3';
    if (script.includes('0x02')) return 'k12';
    if (script.includes('0x03')) return 'argon2light';
    return 'sha256d'; // Default
  } catch {
    return 'sha256d'; // Fallback
  }
}

// Get shader code for algorithm
function getShaderCode(algorithm: AlgorithmId): string {
  switch (algorithm) {
    case 'sha256d':
      return sha256dShaderText;
    case 'blake3':
      return blake3ShaderText;
    case 'k12':
      return k12ShaderText;
    case 'argon2light':
      return argon2lightShaderText;
    default:
      throw new Error(`Unsupported algorithm: ${algorithm}`);
  }
}

export function updateWork() {
  if (!contract.value || !wallet.value?.address) {
    workSignal.value = undefined;
    return;
  }
  
  // Parse algorithm from contract
  const algorithm = parseAlgorithmFromContract(contract.value.script);
  
  // Check if algorithm is supported
  if (!isAlgorithmSupported(algorithm)) {
    addMessage(`Unsupported algorithm: ${algorithm}`, "error");
    miningStatus.value = "error";
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
  addMessage(`Using ${algoInfo.name} algorithm`, "info");
  
  // Show collision warning if applicable
  const timeToMine = calcTimeToMine(Number(contract.value.target), algorithm);
  if (timeToMine < 30) {
    addMessage(`Warning: Fast expected solve time (${timeToMine}s) may cause collisions`, "warning");
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
  
  // Get algorithm from work
  const algorithm = (work as any).algorithm || 'sha256d';
  
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

  // Get shader code for algorithm
  const shaderCode = getShaderCode(algorithm);
  
  const module = device.createShaderModule({
    label: `${algorithm} module`,
    code: shaderCode,
  });

  const pipeline = device.createComputePipeline({
    label: "pow pipeline",
    layout: "auto",
    compute: {
      module,
      entryPoint: "main",
    },
  });

  const numWorkgroups = device.limits.maxComputeWorkgroupsPerDimension;
  //const workgroupSize = device.limits.maxComputeWorkgroupSizeX;
  const workgroupSize = 256;
  const numInvocations = numWorkgroups * workgroupSize;

  // Get algorithm config for buffer requirements
  const algoConfig = getAlgorithmConfig(algorithm);
  if (!algoConfig) {
    throw new Error(`No configuration for algorithm: ${algorithm}`);
  }

  // Create buffers based on algorithm requirements
  const midstateBuffer = device.createBuffer({
    label: "midstate buffer",
    size: algoConfig.bufferRequirements.midstate * 4, // u32s to bytes
    usage: (GPUBufferUsage as any).STORAGE | (GPUBufferUsage as any).COPY_DST,
  });

  const targetBuffer = device.createBuffer({
    label: "target buffer",
    size: algoConfig.bufferRequirements.target * 4, // u32s to bytes
    usage: (GPUBufferUsage as any).STORAGE | (GPUBufferUsage as any).COPY_DST,
  });

  const resultBufferSize = algoConfig.bufferRequirements.results * 16; // vec4<u32> to bytes

  const resultBuffer = device.createBuffer({
    label: "pow result",
    size: resultBufferSize,
    usage:
      (GPUBufferUsage as any).STORAGE |
      (GPUBufferUsage as any).COPY_SRC |
      (GPUBufferUsage as any).COPY_DST,
  });

  const bindGroup = device.createBindGroup({
    label: `${algorithm} bindGroup`,
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: midstateBuffer } },
      { binding: 1, resource: { buffer: targetBuffer } },
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
    // Write target buffer (convert bigint to u32 array)
    const targetU32Array = new Uint32Array(8);
    let targetBig = work.target;
    for (let i = 7; i >= 0; i--) {
      targetU32Array[i] = Number(targetBig & 0xffffffffn);
      targetBig = targetBig >> 32n;
    }
    device.queue.writeBuffer(targetBuffer, 0, targetU32Array);

    const encoder = device.createCommandEncoder({
      label: "pow encoder",
    });
    const pass = encoder.beginComputePass({
      label: "pow compute pass",
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(numWorkgroups);
    pass.end();

    encoder.copyBufferToBuffer(
      resultBuffer,
      0,
      gpuReadBuffer,
      0,
      resultBufferSize
    );

    const commandBuffer = encoder.finish();
    device.queue.submit([commandBuffer]);

    await gpuReadBuffer.mapAsync((GPUMapMode as any).READ);
    const range = new Uint8Array(gpuReadBuffer.getMappedRange());
    
    // Check for solution in results buffer
    for (let i = 0; i < algoConfig.bufferRequirements.results; i++) {
      const offset = i * 16; // vec4<u32> = 16 bytes
      const resultBytes = range.slice(offset, offset + 16);
      
      // Check if this entry has a solution (atomic store flag)
      const flag = new DataView(resultBytes.buffer).getUint32(12, true);
      if (flag === 1) {
        const nonce = new DataView(resultBytes.buffer).getUint32(0, true);
        const hash = new Uint8Array(resultBytes.slice(4, 12));
        
        // Verify the solution
        if (verify(work.target, midstate.preimage, nonce.toString(16))) {
          console.log(`Found solution with ${algorithm}`, nonce.toString(16));
          foundNonce(nonce.toString(16));
          addMessage({
            type: "found",
            nonce: nonce.toString(16),
            algorithm,
          });
          break;
        }
      }
    }
    found.value++;
  }

    device.queue.writeBuffer(resultBuffer, 0, new Uint32Array([0]));

    gpuReadBuffer.unmap();
    resultBuffer.unmap();
    nonceStart += numInvocations;

    // Note: TypeScript error expected here
    if (miningStatus.value === "change") {
      updateWork();
      console.debug("Changing work");
      if (!workSignal.value) {
        console.debug("Invalid work");
        return;
      }
      midstate = powMidstate(workSignal.value);
      device.queue.writeBuffer(midstateBuffer, 0, midstate.hash);
      miningStatus.value = "mining";
    }

  hashrate.value = 0;
  miningStatus.value = "ready";
  console.log("State ready");
};

export default { start, stop };
