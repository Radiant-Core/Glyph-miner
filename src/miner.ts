import { sha256 as jsSha256, Hasher } from "js-sha256";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { sha256 } from "@noble/hashes/sha2";
import shader from "./pow.wgsl?raw";
import { swapEndianness } from "@bitauth/libauth";
import { Work } from "./types";
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

function signedToHex(number: number) {
  let value = Math.max(-2147483648, Math.min(2147483647, number));
  if (value < 0) {
    value += 4294967296;
  }
  return value.toString(16).padStart(8, "0");
}

export function updateWork() {
  if (!contract.value || !wallet.value?.address) {
    workSignal.value = undefined;
    return;
  }
  workSignal.value = createWork(
    contract.value,
    wallet.value.address,
    mintMessage.value
  );
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
  let midstate = powMidstate(work);
  miningStatus.value = "mining";

  const adapter = await navigator.gpu?.requestAdapter({
    powerPreference: "high-performance",
  });
  const device = await adapter?.requestDevice();
  if (!device) {
    throw new Error("No GPU device found.");
  }

  device.pushErrorScope("validation");
  device.pushErrorScope("internal");

  const module = device.createShaderModule({
    label: "pow module",
    code: shader,
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

  const midstateBuffer = device.createBuffer({
    label: "midstate buffer",
    size: 32,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });

  const resultBufferSize = 4;

  const resultBuffer = device.createBuffer({
    label: "pow result",
    size: resultBufferSize,
    usage:
      GPUBufferUsage.STORAGE |
      GPUBufferUsage.COPY_SRC |
      GPUBufferUsage.COPY_DST,
  });

  const nonceBuffer = device.createBuffer({
    label: "nonce buffer",
    size: 8,
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
      nonceBuffer,
      0,
      new Uint32Array([nonce1, nonceStart])
    );

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

    await gpuReadBuffer.mapAsync(GPUMapMode.READ);
    const range = new Uint8Array(gpuReadBuffer.getMappedRange());
    const result = bytesToHex(range.slice(0, 4));
    if (result !== "00000000") {
      const nonce = `${nonce1.toString(16).padStart(8, "0")}${swapEndianness(
        result
      )}`;
      if (verify(work.target, midstate.preimage, nonce)) {
        console.log("Verified", nonce);
        foundNonce(nonce);
        addMessage({
          type: "found",
          nonce,
        });
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
      if (!workSignal.value) {
        console.debug("Invalid work");
        break;
      }
      midstate = powMidstate(workSignal.value);
      device.queue.writeBuffer(midstateBuffer, 0, midstate.hash);
      miningStatus.value = "mining";
    }
  }

  hashrate.value = 0;
  miningStatus.value = "ready";
  console.log("State ready");
};

export default { start, stop };
