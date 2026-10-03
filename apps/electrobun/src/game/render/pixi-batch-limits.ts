import {
  Batcher,
  GlLimitsSystem,
  GpuLimitsSystem,
  type Renderer,
} from "pixi.js";

/**
 * WebGPU guarantees 16 samplers and 16 sampled textures per shader stage on
 * every device, and Pixi's batch shader binds one texture + one sampler per
 * slot.
 */
export const MAX_BATCH_TEXTURES = 16;

/**
 * Pixi caches its batch `DefaultShader` in a module-level singleton shared by
 * every renderer in the page, sized by whichever batcher is created first.
 * On Intel/Mesa (Linux) WebGL reports 32 texture units, so a WebGL app or a
 * batcher built without `maxTextures` (which probes a WebGL test context)
 * produces a 32-texture shader that the shared WebGPU device (16 samplers)
 * rejects -> invalid pipelines, black canvas.
 *
 * Clamp at the source: every limits system and the batcher fallback are
 * capped before any renderer is initialised (this runs at import time).
 */
type LimitsProto = {
  contextChange: (...args: unknown[]) => void;
  maxBatchableTextures: number;
};

function patchLimits(proto: LimitsProto): void {
  const original = proto.contextChange;
  proto.contextChange = function (this: LimitsProto, ...args: unknown[]) {
    original.apply(this, args);
    this.maxBatchableTextures = Math.min(
      this.maxBatchableTextures,
      MAX_BATCH_TEXTURES
    );
  };
}

patchLimits(GlLimitsSystem.prototype as unknown as LimitsProto);
patchLimits(GpuLimitsSystem.prototype as unknown as LimitsProto);
Batcher.defaultOptions.maxTextures = MAX_BATCH_TEXTURES;

/** Belt-and-braces clamp on an already-initialised renderer. */
export function clampBatchTextures(renderer: Renderer): void {
  const limits = renderer.limits as { maxBatchableTextures: number };
  limits.maxBatchableTextures = Math.min(
    limits.maxBatchableTextures,
    MAX_BATCH_TEXTURES
  );
}
