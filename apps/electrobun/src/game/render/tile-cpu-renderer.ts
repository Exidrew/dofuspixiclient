import type { CpuRenderer } from "vello-wasm";
import { BufferImageSource, Texture } from "pixi.js";

import { createLogger } from "@/utils/logger";

import type { VelloAnimationMeta } from "./vello-loader";

const log = createLogger("TileCpu");

/**
 * CPU-only counterpart of `TileVelloRenderer` — renders tile frames through
 * `vello_cpu` (no `wgpu`/WebGPU/`GPUDevice` anywhere) and wraps the resulting
 * RGBA buffer as a plain Pixi `BufferImageSource`, instead of an
 * `ExternalSource` around a `GPUTexture`. Works identically whether Pixi
 * itself ends up on the WebGL or WebGPU renderer — the texture is just
 * bytes, there's no zero-copy GPU sharing to set up.
 *
 * Mirrors `TileVelloRenderer`'s public surface 1:1 so `AtlasLoader` can pick
 * either backend behind the same calls.
 */
export class TileCpuRenderer {
  private cpu: CpuRenderer | null = null;
  private nextAssetId = 1;

  private readonly assetIds = new Map<string, number>();
  private readonly pendingLoads = new Map<string, Promise<boolean>>();
  private readonly assetBytes = new Map<string, Uint8Array>();

  constructor(private readonly basePath: string) {}

  setCpuRenderer(cpu: CpuRenderer): void {
    this.cpu = cpu;
  }

  hasAsset(tileKey: string): boolean {
    return this.assetIds.has(tileKey);
  }

  /** Raw dofasset bytes for a loaded tile, used to parse the Extras section. */
  getAssetBytes(tileKey: string): Uint8Array | undefined {
    return this.assetBytes.get(tileKey);
  }

  getAnimationMeta(tileKey: string): VelloAnimationMeta | null {
    const cpu = this.cpu;
    const assetId = this.assetIds.get(tileKey);
    if (!cpu || assetId === undefined) return null;
    return cpu.getAnimationMeta(
      assetId,
      "tile",
      1.0
    ) as VelloAnimationMeta | null;
  }

  async loadAsset(tileKey: string): Promise<boolean> {
    if (this.assetIds.has(tileKey)) {
      return true;
    }

    const pending = this.pendingLoads.get(tileKey);
    if (pending) {
      return pending;
    }

    const promise = this.doLoadAsset(tileKey);
    this.pendingLoads.set(tileKey, promise);

    try {
      return await promise;
    } finally {
      this.pendingLoads.delete(tileKey);
    }
  }

  /**
   * Render a single frame via `vello_cpu` + wrap the resulting RGBA buffer
   * as a Pixi Texture. Returns null if the CPU renderer isn't set or the
   * tile asset isn't loaded. `cacheKey` is accepted (unused) only to keep
   * the same call signature as `TileVelloRenderer.renderFrame` — there's no
   * GPU texture id to track for a manual `freeTexture` here, Pixi's normal
   * texture GC handles a `BufferImageSource` on its own.
   */
  renderFrame(
    tileKey: string,
    frameIndex: number,
    zoom: number,
    _cacheKey: string
  ): Texture | null {
    const cpu = this.cpu;
    const assetId = this.assetIds.get(tileKey);

    if (!cpu || assetId === undefined) {
      return null;
    }

    const result = cpu.renderFrame(
      assetId,
      "tile",
      frameIndex,
      zoom,
      new Uint32Array()
    ) as {
      rgba: Uint8Array;
      width: number;
      height: number;
    } | null;

    if (!result) {
      return null;
    }

    const source = new BufferImageSource({
      resource: result.rgba,
      width: result.width,
      height: result.height,
      label: `cpu:${tileKey}:${frameIndex}`,
      // `scene_builder_cpu::build_frame_pixmap_cpu` returns straight
      // (non-premultiplied) alpha via `Pixmap::take_unpremultiplied` — same
      // convention as Vello's GPU output, so Pixi's blend state handles it
      // the same way (see TileVelloRenderer's identical setting).
      alphaMode: "no-premultiply-alpha",
      scaleMode: "nearest",
      format: "rgba8unorm",
      resolution: zoom,
    });

    return new Texture({ source });
  }

  private async doLoadAsset(tileKey: string): Promise<boolean> {
    const cpu = this.cpu;

    if (!cpu) {
      return false;
    }

    const underscore = tileKey.indexOf("_");
    const type = underscore === -1 ? tileKey : tileKey.slice(0, underscore);
    const idStr = underscore === -1 ? "" : tileKey.slice(underscore + 1);
    const url =
      type === "tactic" || type === "cell"
        ? `${this.basePath}/${type}/${idStr}.dofasset`
        : `${this.basePath}/tiles/${type}/${idStr}.dofasset`;

    try {
      const res = await fetch(url);

      if (!res.ok) {
        return false;
      }

      const data = new Uint8Array(await res.arrayBuffer());
      const id = this.nextAssetId++;
      cpu.loadAsset(id, data);
      this.assetIds.set(tileKey, id);
      this.assetBytes.set(tileKey, data);
      return true;
    } catch (e) {
      log.warn(`Failed to load dofasset for ${tileKey}:`, e);
      return false;
    }
  }
}
