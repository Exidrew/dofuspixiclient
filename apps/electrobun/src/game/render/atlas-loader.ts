import type { Renderer, Texture } from "pixi.js";
import type { CpuRenderer, VelloRenderer } from "vello-wasm";
import { readTileExtras, type TileExtras } from "@dofus/dofasset-format";

import type { TileManifest } from "@/game/types";
import { createLogger } from "@/utils/logger";

import type { VelloAnimationMeta } from "./vello-loader";
import {
  AtlasCache,
  type AtlasManifest,
  type CachedTileData,
  type SpritesheetManifest,
} from "./atlas-cache";
import { getLoadProgress } from "./load-progress";
import { TileCpuRenderer } from "./tile-cpu-renderer";
import { convertToTileManifest } from "./tile-manifest-converter";
import { TileVelloRenderer } from "./tile-vello-renderer";

/**
 * Common surface both tile backends satisfy structurally — lets
 * `AtlasLoader` stay agnostic to which one is actually rendering.
 * `TileVelloRenderer` (GPU, `ExternalSource`/zero-copy) and
 * `TileCpuRenderer` (CPU, `vello_cpu` + plain buffer upload) both implement
 * this shape without declaring it explicitly.
 */
interface TileRasterizer {
  hasAsset(tileKey: string): boolean;
  getAssetBytes(tileKey: string): Uint8Array | undefined;
  getAnimationMeta(tileKey: string): VelloAnimationMeta | null;
  loadAsset(tileKey: string): Promise<boolean>;
  renderFrame(
    tileKey: string,
    frameIndex: number,
    zoom: number,
    cacheKey: string
  ): Texture | null;
}

const log = createLogger("AtlasLoader");

export class AtlasLoader {
  private readonly cache = new AtlasCache();
  private readonly pendingTileDataLoads = new Map<
    string,
    Promise<CachedTileData | null>
  >();
  private currentZoom = 1;
  private readonly tileRasterizer: TileRasterizer;

  /**
   * `backend` picks which `.dofasset` rasterizer tiles go through:
   * "gpu" (default) = Vello WASM + WebGPU zero-copy `ExternalSource`;
   * "cpu" = `vello_cpu`, no WebGPU anywhere — the fallback for devices
   * `diagnoseWebGPU()` flags as unusable (see battlefield/bootstrap.ts).
   */
  constructor(
    renderer: Renderer,
    basePath = "/assets/spritesheets",
    backend: "gpu" | "cpu" = "gpu"
  ) {
    this.tileRasterizer =
      backend === "cpu"
        ? new TileCpuRenderer(basePath)
        : new TileVelloRenderer(renderer, basePath);
  }

  /** Set the Vello renderer (call after vello init, before prefetch). No-op on the CPU backend. */
  setVelloRenderer(vello: VelloRenderer): void {
    if (this.tileRasterizer instanceof TileVelloRenderer) {
      this.tileRasterizer.setVelloRenderer(vello);
    }
  }

  /** Set the CPU renderer (call after cpu-loader init, before prefetch). No-op on the GPU backend. */
  setCpuRenderer(cpu: CpuRenderer): void {
    if (this.tileRasterizer instanceof TileCpuRenderer) {
      this.tileRasterizer.setCpuRenderer(cpu);
    }
  }

  /** Current zoom determines render resolution. */
  setZoom(zoom: number): void {
    this.currentZoom = zoom;
  }

  getZoom(): number {
    return this.currentZoom;
  }

  /**
   * Load tile data (manifest + atlas). Deduplicates concurrent fetches for
   * the same tile via a pending-promise map.
   */
  private async loadTileData(tileKey: string): Promise<CachedTileData | null> {
    const cached = this.cache.getTileData(tileKey);

    if (cached) {
      return cached;
    }

    const pending = this.pendingTileDataLoads.get(tileKey);

    if (pending) {
      return pending;
    }

    const promise = this.doLoadTileData(tileKey);
    this.pendingTileDataLoads.set(tileKey, promise);

    try {
      return await promise;
    } finally {
      this.pendingTileDataLoads.delete(tileKey);
    }
  }

  private async doLoadTileData(
    tileKey: string
  ): Promise<CachedTileData | null> {
    // Ensure the .dofasset is in Vello (triggers the single fetch that also
    // gives us the Extras section — no more sidecar manifest.json fetch).
    await this.tileRasterizer.loadAsset(tileKey);
    const bytes = this.tileRasterizer.getAssetBytes(tileKey);
    if (!bytes) {
      return null;
    }

    const extras = readTileExtras(bytes);
    if (!extras) {
      log.warn(`Tile ${tileKey} .dofasset missing Extras section`);
      return null;
    }

    const manifest = spritesheetManifestFromExtras(extras);
    const animName = Object.keys(manifest.animations)[0];
    if (!animName) {
      return null;
    }
    const atlas = manifest.animations[animName] as AtlasManifest;

    // Single Vello path-walk per tile, cached forever. Anchor + canvas scale
    // linearly with zoom, so no re-query on zoom changes.
    const meta = this.tileRasterizer.getAnimationMeta(tileKey);
    if (!meta) {
      log.warn(`Tile ${tileKey} Vello animation meta unavailable`);
      return null;
    }

    const data: CachedTileData = {
      manifest,
      atlas,
      renderMeta: {
        width: meta.width,
        height: meta.height,
        anchorX: meta.anchorX,
        anchorY: meta.anchorY,
      },
      baseTextures: new Map(),
    };

    this.cache.setTileData(tileKey, data);
    return data;
  }

  /** Rounded zoom key for cache bucketing (avoids excessive cache entries). */
  private zoomKey(): number {
    return Math.round(this.currentZoom * 100) / 100;
  }

  private frameCacheKey(tileKey: string, frameIndex: number): string {
    return `${tileKey}:${this.zoomKey()}:${frameIndex}`;
  }

  async loadTileManifest(tileKey: string): Promise<TileManifest | null> {
    const cached = this.cache.getTileManifest(tileKey);

    if (cached) {
      return cached;
    }

    const data = await this.loadTileData(tileKey);

    if (!data) {
      return null;
    }

    const [type] = tileKey.split("_");
    const tileManifest = convertToTileManifest(
      data,
      type as "ground" | "objects" | "tactic" | "cell"
    );
    this.cache.setTileManifest(tileKey, tileManifest);
    return tileManifest;
  }

  async loadFrame(
    tileKey: string,
    frameIndex: number,
    _scale: number
  ): Promise<Texture | null> {
    const cacheKey = this.frameCacheKey(tileKey, frameIndex);
    const cachedTexture = this.cache.getFromFrameCache(cacheKey);

    if (cachedTexture) {
      return cachedTexture;
    }

    if (!this.tileRasterizer.hasAsset(tileKey)) {
      await this.tileRasterizer.loadAsset(tileKey);
    }

    const texture = this.tileRasterizer.renderFrame(
      tileKey,
      frameIndex,
      this.currentZoom,
      cacheKey
    );

    if (!texture) {
      return null;
    }

    this.cache.addToFrameCache(cacheKey, texture);
    return texture;
  }

  async loadAnimationFrames(
    tileKey: string,
    scale: number
  ): Promise<Texture[]> {
    const tile = await this.loadTileManifest(tileKey);

    if (!tile) {
      return [];
    }

    const frames = await Promise.all(
      Array.from({ length: tile.frameCount }, (_, i) =>
        this.loadFrame(tileKey, i, scale)
      )
    );

    return frames.filter((t): t is Texture => t !== null);
  }

  getTileManifest(tileKey: string): TileManifest | undefined {
    return this.cache.getTileManifest(tileKey);
  }

  /** Sync manifest lookup; returns null if not cached (call prefetchTiles first). */
  getTileManifestSync(tileKey: string): TileManifest | null {
    const cached = this.cache.getTileManifest(tileKey);

    if (cached) {
      return cached;
    }

    const data = this.cache.getTileData(tileKey);

    if (!data) {
      return null;
    }

    const [type] = tileKey.split("_");
    const tileManifest = convertToTileManifest(
      data,
      type as "ground" | "objects" | "tactic" | "cell"
    );

    this.cache.setTileManifest(tileKey, tileManifest);
    return tileManifest;
  }

  /** Sync frame lookup; returns null if base texture not cached. */
  loadFrameSync(
    tileKey: string,
    frameIndex: number,
    _scale: number
  ): Texture | null {
    const cacheKey = this.frameCacheKey(tileKey, frameIndex);
    const cached = this.cache.getFromFrameCache(cacheKey);

    if (cached) {
      return cached;
    }

    if (!this.tileRasterizer.hasAsset(tileKey)) {
      return null;
    }

    const texture = this.tileRasterizer.renderFrame(
      tileKey,
      frameIndex,
      this.currentZoom,
      cacheKey
    );

    if (texture) {
      this.cache.addToFrameCache(cacheKey, texture);
      return texture;
    }

    return null;
  }

  /** Sync animation frames; returns empty array if not cached. */
  loadAnimationFramesSync(tileKey: string, _scale: number): Texture[] {
    const manifest = this.getTileManifestSync(tileKey);

    if (!manifest) {
      return [];
    }

    const textures: Texture[] = [];

    for (let i = 0; i < manifest.frameCount; i++) {
      const texture = this.loadFrameSync(tileKey, i, 1);

      if (texture) {
        textures.push(texture);
      }
    }

    return textures;
  }

  /**
   * Prefetch tile data + Vello asset in parallel.
   * After prefetch, sync methods (loadFrameSync, getTileManifestSync) are
   * zero-cost.
   */
  async prefetchTiles(tileKeys: string[], _scale: number): Promise<void> {
    const progress = getLoadProgress();
    const total = tileKeys.length;
    let loaded = 0;

    await Promise.all(
      tileKeys.map(async (key) => {
        await this.loadTileData(key);
        this.getTileManifestSync(key);
        await this.tileRasterizer.loadAsset(key);

        loaded++;
        progress.report("map-tiles", loaded, total);
      })
    );
  }

  clearFrameCache(): void {
    this.cache.clearFrameCache();
  }

  getFrameCacheMemoryBytes(): number {
    return this.cache.getFrameCacheMemoryBytes();
  }

  getFrameCacheEntryCount(): number {
    return this.cache.getFrameCacheEntryCount();
  }

  clearCache(): void {
    this.cache.clearAll();
  }

  /**
   * Clear only textures for a specific zoom level. Does NOT destroy textures —
   * lets GC handle cleanup to avoid GPU conflicts with in-flight draws.
   */
  clearZoomCache(zoom: number): void {
    this.cache.clearZoomLevel(zoom);
  }
}

/**
 * Rebuild the legacy SpritesheetManifest shape from the Extras section that
 * replaces manifest.json. Existing downstream code (convertToTileManifest,
 * tile-vello-renderer) keeps working unchanged.
 */
function spritesheetManifestFromExtras(
  extras: TileExtras
): SpritesheetManifest {
  const animations: SpritesheetManifest["animations"] = {};
  for (const [name, a] of Object.entries(extras.animations ?? {})) {
    animations[name] = {
      file: `${name}/atlas.svg`,
      version: extras.version ?? 1,
      animation: name,
      width: a.width,
      height: a.height,
      offsetX: a.offsetX,
      offsetY: a.offsetY,
      frames: a.frames ?? [],
      frameOrder: a.frameOrder ?? [],
      duplicates: a.duplicates ?? {},
      fps: a.fps,
      baseFrame: a.baseFrame,
      baseZOrder: a.baseZOrder,
      pages: a.pages,
    };
  }
  return {
    version: extras.version ?? 1,
    spriteId: extras.spriteId,
    behavior: extras.behavior,
    fps_hint: extras.fpsHint,
    autoplay: extras.autoplay,
    loop: extras.loop,
    animations,
  };
}
