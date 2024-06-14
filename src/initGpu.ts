import { gpu } from "./signals";

// Get GPU info and store in gpu signal
const adapter = await navigator.gpu?.requestAdapter({
  powerPreference: "high-performance",
});
if (!adapter) {
  gpu.value = undefined;
}
const info = await adapter?.requestAdapterInfo();
gpu.value = info?.description || info?.vendor || info?.device;
