import { type Application, Container, Ticker } from "pixi.js";

import type { CharacterSpriteLoader } from "@/game/assets/character-sprite";
import type { Engine } from "@/game/render/engine";
import type { RendererRegistry } from "@/game/render/renderer-registry";
import type { Scene } from "@/game/scene/scene";
import { AdjacentMapCache } from "@/game/assets/adjacent-map-cache";
import { InteractionHandler } from "@/game/input/interaction-handler";
import { AtlasLoader } from "@/game/render/atlas-loader";
import { PickingSystem } from "@/game/render/picking-system";
import { SpellVelloRenderer } from "@/game/render/spell-vello-renderer";
import {
  diagnoseWebGPU,
  formatWebGPUDiagnostic,
} from "@/game/render/webgpu-diagnostics";
import { MapTransition } from "@/game/scene/map/transition";
import { DebugOverlay } from "@/game/scene/overlays/debug";
import { GridOverlay } from "@/game/scene/overlays/grid";
import { createLogger } from "@/utils/logger";

import type { BattlefieldPicking } from "./picking";
import type { BattlefieldWorldActors } from "./world-actors";
import type { BattlefieldZoom } from "./zoom";

const log = createLogger("BattlefieldBootstrap");

/**
 * State container Battlefield hands to the bootstrap functions so they can
 * wire up the Pixi engine, Vello renderer, picking, atlas loader, interaction
 * handlers, and overlays without reaching into private fields from outside
 * the class. Fields are typed as nullable since they're populated in order.
 */
export interface BattlefieldBootstrapContext {
  engine: Engine;
  scene: Scene;
  rendererRegistry: RendererRegistry;
  characterSpriteLoader: CharacterSpriteLoader;

  picking: BattlefieldPicking;
  worldActors: BattlefieldWorldActors;
  zoom: BattlefieldZoom;

  app: Application | null;
  mapContainer: Container | null;
  mapTransition: MapTransition | null;
  pickingSystem: PickingSystem | null;
  atlasLoader: AtlasLoader | null;
  adjacentMapCache: AdjacentMapCache | null;
  interactionHandler: InteractionHandler | null;
  debugOverlay: DebugOverlay | null;
  gridOverlay: GridOverlay | null;
  sceneTickerCallback: (() => void) | null;
  /**
   * Shared Vello renderer for spell .dofasset files. Instantiated in
   * `initPickingAndAtlas` and bound to the Vello WASM renderer in
   * `wireVelloLoaders`; FightUI reads it when creating SpellRenderer
   * so cast animations render through the same GPU pipeline as tiles
   * and character sprites.
   */
  spellVelloRenderer: SpellVelloRenderer | null;

  handleGroundClick(mapX: number, mapY: number): void;
  handleGroundHover(mapX: number, mapY: number): void;
}

/**
 * Init Pixi engine + shared Vello GPU device. Must complete before anything
 * renders — Vello needs the GPUDevice attached before `engine.init()` so the
 * WebGPU pipeline uses the shared device (enables zero-copy texture sharing).
 */
export async function initEngineAndVello(
  ctx: BattlefieldBootstrapContext
): Promise<void> {
  // The whole renderer pipeline is WebGPU-only: Vello allocates GPUTextures
  // that Pixi consumes through `ExternalSource`. If `navigator.gpu` is
  // missing (or no adapter can be acquired), Pixi would silently fall back
  // to WebGL and every tile/sprite draw would resolve to nothing — the
  // player sees the HUD over a black canvas with no error. Detect it up
  // front and fail loudly instead, so MapRenderer's error overlay shows
  // the real cause.
  if (typeof navigator === "undefined" || !("gpu" in navigator)) {
    // Probe the whole stack so the error message carries the exact failing
    // link instead of a generic "WebGPU unavailable".
    const report = await diagnoseWebGPU();
    throw new Error(
      "WebGPU is not available in this environment. The game renderer " +
        "(Vello WASM + PixiJS) requires WebGPU. Use a WebGPU-capable browser " +
        "(Chrome/Edge 113+) or enable it via chrome://flags/#enable-unsafe-webgpu. " +
        "In the desktop (Electrobun/CEF) build, the GPU/WebGPU flags in " +
        "electrobun.config.ts must be active.\n\n" +
        "WebGPU diagnostics:\n" +
        formatWebGPUDiagnostic(report)
    );
  }

  try {
    const { initVello } = await import("@/game/render/vello-loader");
    const { gpu } = await initVello();
    ctx.engine.setGpu(gpu);
    log.info("Vello WASM renderer initialized (zero-copy GPU sharing)");
  } catch (e) {
    log.error("Vello WASM failed to initialize — rendering will not work:", e);
    // Rethrow: continuing here produces a black canvas with a working HUD,
    // which is indistinguishable from a dozen other bugs. Surface it, and
    // append the raw WebGPU probe so a WASM-level failure (e.g. "Couldn't
    // find suitable device") can be told apart from a missing adapter.
    let probe = "";
    try {
      probe = `\n\nWebGPU diagnostics:\n${formatWebGPUDiagnostic(await diagnoseWebGPU())}`;
    } catch {
      // diagnostics are best-effort; never mask the original error.
    }
    throw new Error(
      `Vello/WASM renderer failed to initialize: ${
        e instanceof Error ? e.message : String(e)
      }. The map and characters cannot be drawn without it.${probe}`
    );
  }

  await ctx.engine.init();
  ctx.app = ctx.engine.getApp();

  // Expose a one-call diagnostic usable from the browser devtools console
  // (`await window.__webgpuDiagnostics()`). In the Chrome + `bun run hmr`
  // workflow this is the fastest way to tell whether the black screen is a
  // missing adapter, a WASM failure, or simply no map loaded yet.
  if (typeof window !== "undefined") {
    (
      window as unknown as {
        __webgpuDiagnostics: () => Promise<string>;
      }
    ).__webgpuDiagnostics = async () =>
      formatWebGPUDiagnostic(await diagnoseWebGPU());
  }

  ctx.mapContainer = new Container();
  // mapContainer holds the full battlefield stack — tiles, world-actors,
  // cell-highlights, grid, damage/spell-fx. Without sortableChildren the
  // order would follow insertion (fight UI added last → on top of every
  // sprite), which is the opposite of the original Dofus 1.29 layout
  // where Zone (cell tints) sits between Object1 and Object2. Explicit
  // zIndex on each layer child keeps the ordering deterministic.
  ctx.mapContainer.sortableChildren = true;
  ctx.app.stage.addChild(ctx.mapContainer);
  ctx.mapTransition = new MapTransition(ctx.app, ctx.mapContainer);
}

export function initPickingAndAtlas(ctx: BattlefieldBootstrapContext): void {
  if (!ctx.app) {
    throw new Error("initPickingAndAtlas called before engine init");
  }

  ctx.pickingSystem = new PickingSystem(ctx.app.renderer, 16);
  ctx.pickingSystem.initializeTexture(
    ctx.app.screen.width,
    ctx.app.screen.height
  );
  ctx.atlasLoader = new AtlasLoader(ctx.app.renderer, "/assets/spritesheets");
  ctx.spellVelloRenderer = new SpellVelloRenderer(
    ctx.app.renderer,
    "/assets/spritesheets"
  );
}

/**
 * Hand the shared Vello renderer to both tile + character sprite loaders and
 * wire up the debug overlay line. No-op if Vello is unavailable.
 */
export async function wireVelloLoaders(
  ctx: BattlefieldBootstrapContext
): Promise<void> {
  const { getVelloRenderer, getMaxTextureSize } = await import(
    "@/game/render/vello-loader"
  );
  const vello = getVelloRenderer();

  if (!vello || !ctx.app || !ctx.atlasLoader) {
    return;
  }

  ctx.atlasLoader.setVelloRenderer(vello);
  ctx.characterSpriteLoader.setVelloRenderer(
    vello,
    ctx.app.renderer,
    getMaxTextureSize()
  );
  ctx.spellVelloRenderer?.setVelloRenderer(vello);
  ctx.adjacentMapCache = new AdjacentMapCache(ctx.atlasLoader);

  // HUD spell-icon renderer uses the same Vello + Pixi handles to turn
  // `/assets/dofassets/spells/icons/<sprite>.dofasset` into `<img>`-ready
  // data URLs for the banner grid. Initialized here so the hook mounted by
  // BannerReact can resolve URLs as soon as the battlefield finishes boot.
  const { getSpellIconRenderer } = await import(
    "@/game/render/spell-icon-renderer"
  );
  getSpellIconRenderer().init(vello, ctx.app.renderer);

  // StringCourse turn-change banner artwork — canonical Game.as:389
  // loads `ARTWORKS_BIG_PATH + gfxFileName + ".swf"` for the active
  // fighter; we serve those as `.dofassets` published by the asset
  // pipeline and rasterize through the same Vello + Pixi extract path
  // the spell-icon renderer uses.
  const { getFighterPortraitRenderer } = await import(
    "@/game/render/fighter-portrait-renderer"
  );
  getFighterPortraitRenderer().init(vello, ctx.app.renderer);

  // Generic UI dofasset renderer — backs the canonical loader.swf
  // panels (UI_StringCourse parchment, etc.) by path. Same Vello +
  // Pixi extract pipeline; React mounts the resulting canvas as the
  // panel background.
  const { getUiAssetRenderer } = await import(
    "@/game/render/ui-asset-renderer"
  );
  getUiAssetRenderer().init(vello, ctx.app.renderer);

  const spriteLoader = ctx.characterSpriteLoader;
  ctx.engine.debugInfo = () => {
    const atlas = spriteLoader.getAtlas();

    if (!atlas) {
      return "no atlas";
    }

    const s = atlas.stats;
    const war = ctx.worldActors.getRenderer();
    const updMs = war ? war.lastUpdateMs.toFixed(1) : "?";
    const n = war ? war.getPlayerIds().length : 0;
    return `${n}act upd:${updMs}ms | sl:${s.slots}/${s.maxSlots} r:${s.lastRenders} q:${s.lastQueueMs.toFixed(1)}ms fl:${s.lastFlushMs.toFixed(1)}ms h:${s.lastHits}`;
  };
}

export function initInteraction(ctx: BattlefieldBootstrapContext): void {
  if (!ctx.app || !ctx.mapContainer || !ctx.pickingSystem) {
    throw new Error("initInteraction called before engine/picking init");
  }

  const canvas = ctx.engine.getCanvas();

  if (!canvas) {
    throw new Error("Canvas not created");
  }

  ctx.app.stage.eventMode = "static";
  ctx.mapContainer.eventMode = "static";

  ctx.interactionHandler = new InteractionHandler({
    mapContainer: ctx.mapContainer,
    pickingSystem: ctx.pickingSystem,
    canvas,
    onZoomChange: (zoom) => ctx.zoom.request(zoom),
    onObjectClick: (result) => ctx.picking.onObjectClick(result),
    onObjectHover: (result) => ctx.picking.onObjectHover(result),
    onGroundClick: (mapX, mapY) => ctx.handleGroundClick(mapX, mapY),
    onGroundHover: (mapX, mapY) => ctx.handleGroundHover(mapX, mapY),
  });
  ctx.interactionHandler.init();
  ctx.interactionHandler.setBaseZoom(ctx.engine.getBaseZoom());

  const handler = ctx.interactionHandler;
  ctx.app.stage.on("pointerdown", (e) => handler.handlePointerDown(e));
  ctx.app.stage.on("pointermove", (e) => handler.handlePointerMove(e));
  ctx.app.stage.on("pointerup", () => handler.handlePointerUp());
  ctx.app.stage.on("pointerupoutside", () => handler.handlePointerUp());
}

export function initOverlays(ctx: BattlefieldBootstrapContext): void {
  if (!ctx.app || !ctx.mapContainer) {
    throw new Error("initOverlays called before engine init");
  }

  ctx.debugOverlay = new DebugOverlay(ctx.app.stage);
  ctx.debugOverlay.setMapContainer(ctx.mapContainer);
  ctx.debugOverlay.setScreenSize(ctx.app.screen.width, ctx.app.screen.height);
  ctx.scene.add(ctx.debugOverlay);

  // Inside mapContainer so the grid pans/zooms with the map.
  ctx.gridOverlay = new GridOverlay(ctx.mapContainer);
  ctx.scene.add(ctx.gridOverlay);

  ctx.rendererRegistry.register("debug-overlay", (e) =>
    ctx.debugOverlay?.onResize(e)
  );
  ctx.rendererRegistry.register("grid-overlay", (e) =>
    ctx.gridOverlay?.onResize(e)
  );
}

/** Single game-loop entry: scene drives per-frame work, interaction polls after. */
export function startSceneTicker(ctx: BattlefieldBootstrapContext): void {
  ctx.sceneTickerCallback = () => {
    ctx.scene.tick(Ticker.shared.deltaMS);
    ctx.interactionHandler?.tick();
  };

  Ticker.shared.add(ctx.sceneTickerCallback);
}
