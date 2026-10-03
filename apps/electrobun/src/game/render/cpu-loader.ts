/**
 * CPU `.dofasset` rasterizer integration for Pixi.js — the WebGPU-free
 * fallback counterpart of `vello-loader.ts`.
 *
 * Unlike Vello (GPUTexture + Pixi `ExternalSource`, zero-copy but WebGPU-only),
 * this path renders through `vello_cpu` entirely in WASM linear memory and
 * hands back a plain RGBA buffer — consumed via Pixi's regular
 * `BufferImageSource` texture upload, which works on both the WebGL and
 * WebGPU Pixi renderers.
 *
 * Usage:
 *   const cpu = await initCpuRenderer();
 *   // No `gpu` option for Pixi — just `app.init({ preference: "webgl" })`.
 */

import wasmInit, { CpuRenderer } from "vello-wasm";

let renderer: CpuRenderer | null = null;

/**
 * Initialize the CPU `.dofasset` renderer. Safe to call even when
 * `navigator.gpu` is absent — this path never touches WebGPU.
 */
export async function initCpuRenderer(wasmUrl?: string): Promise<CpuRenderer> {
  if (wasmUrl) {
    await wasmInit(wasmUrl);
  } else {
    await wasmInit();
  }

  renderer = new CpuRenderer();
  return renderer;
}

export function getCpuRenderer(): CpuRenderer | null {
  return renderer;
}
