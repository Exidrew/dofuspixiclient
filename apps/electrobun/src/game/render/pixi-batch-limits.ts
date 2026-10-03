import type { Renderer } from "pixi.js";

/**
 * WebGPU guarantees 16 samplers and 16 sampled textures per shader stage on
 * every device, and Pixi's batch shader binds one texture + one sampler per
 * slot.
 */
export const MAX_BATCH_TEXTURES = 16;

/**
 * Clamp a renderer's batch texture count so every Pixi app in the page agrees.
 *
 * Pixi caches its batch `DefaultShader` in a module-level singleton, sized by
 * whichever renderer batches first. A WebGL app (e.g. the minimap) can report
 * 32 texture units on Intel/Mesa, and the shared WebGPU renderer would then
 * reuse a 32-texture shader that exceeds the device's 16-sampler limit.
 * Must run right after `app.init()`, before the first render.
 */
export function clampBatchTextures(renderer: Renderer): void {
  const limits = renderer.limits as { maxBatchableTextures: number };
  limits.maxBatchableTextures = Math.min(
    limits.maxBatchableTextures,
    MAX_BATCH_TEXTURES
  );
}
