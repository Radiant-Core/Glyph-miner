import { gpu } from "./signals";

// Get GPU info and store in gpu signal
const adapter = await navigator.gpu?.requestAdapter({
  powerPreference: "high-performance",
});
// Browsers with an old webgpu version will not have adapter.info
if (!adapter || !adapter.info) {
  gpu.value = undefined;
}
const info = adapter?.info;
gpu.value = info?.description || info?.vendor || info?.device;
