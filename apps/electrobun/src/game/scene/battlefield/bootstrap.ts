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
  /**
   * Which `.dofasset` rasterizer backend `initEngineAndVello` ended up
   * selecting — "gpu" (default, Vello WASM) or "cpu" (`vello_cpu`
   * fallback, set when WebGPU/Vello init fails). Read by
   * `initPickingAndAtlas` (which backend `AtlasLoader` renders tiles with)
   * and `wireVelloLoaders` (whether to wire the GPU-only
   * character/spell/UI renderers at all).
   */
  rendererBackend: "gpu" | "cpu";
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
 * Init Pixi engine + the `.dofasset` rasterizer backend. Must complete
 * before anything renders.
 *
 * Tries Vello WASM + WebGPU first (zero-copy GPU texture sharing — the
 * fastest path, and the only one covering characters/spells/UI panels for
 * now). If `navigator.gpu` is missing or Vello fails to acquire a GPU
 * device, falls back to the CPU rasterizer (`vello_cpu`, no WebGPU
 * anywhere) instead of failing outright — tiles still render (plain Pixi
 * buffer textures), fixing the "HUD/menus OK, map is a black canvas" failure
 * mode for devices without usable WebGPU. Characters/spells/UI panels stay
 * blank on this path until their renderers get the same CPU treatment
 * (see `wireVelloLoaders` below).
 */
export async function initEngineAndVello(
  ctx: BattlefieldBootstrapContext
): Promise<void> {
  const hasNavigatorGpu =
    typeof navigator !== "undefined" && "gpu" in navigator;

  let gpuReady = false;

  if (hasNavigatorGpu) {
    try {
      const { initVello } = await import("@/game/render/vello-loader");
      const { gpu } = await initVello();
      ctx.engine.setGpu(gpu);
      gpuReady = true;
      log.info("Vello WASM renderer initialized (zero-copy GPU sharing)");
    } catch (e) {
      log.error(
        "Vello WASM failed to initialize — falling back to the CPU rasterizer (tiles only):",
        e
      );
    }
  } else {
    log.warn(
      "navigator.gpu is unavailable — falling back to the CPU rasterizer (tiles only)."
    );
  }

  if (!gpuReady) {
    ctx.rendererBackend = "cpu";
    // Tell Pixi to use its WebGL renderer instead of attempting WebGPU on
    // its own (it has no `gpu` device to share either way since Vello never
    // created one on this path).
    ctx.engine.setPreferWebGPU(false);

    try {
      const { initCpuRenderer } = await import("@/game/render/cpu-loader");
      await initCpuRenderer();
      log.info(
        "CPU .dofasset rasterizer initialized (no WebGPU) — tiles only; " +
          "characters/spells/UI panels require WebGPU for now."
      );
    } catch (e) {
      // Both backends failed — this is the one case still worth failing
      // loudly, same reasoning as the old WebGPU-only gate: continuing
      // would produce a black canvas with a working HUD and no clear cause.
      let probe = "";
      try {
        probe = `\n\nWebGPU diagnostics:\n${formatWebGPUDiagnostic(await diagnoseWebGPU())}`;
      } catch {
        // diagnostics are best-effort; never mask the original error.
      }
      throw new Error(
        `Both the WebGPU (Vello) and CPU .dofasset renderers failed to initialize: ${
          e instanceof Error ? e.message : String(e)
        }. The map cannot be drawn.${probe}`
      );
    }
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
  ctx.atlasLoader = new AtlasLoader(
    ctx.app.renderer,
    "/assets/spritesheets",
    ctx.rendererBackend
  );
  ctx.spellVelloRenderer = new SpellVelloRenderer(
    ctx.app.renderer,
    "/assets/spritesheets"
  );
}

/**
 * Hand the active rasterizer backend to the tile + character sprite loaders
 * and wire up the debug overlay line.
 *
 * On the "cpu" backend (see `initEngineAndVello`), only the tile loader
 * gets wired — characters, spells, fighter portraits and UI panels still
 * go through `VelloRenderer`/WebGPU exclusively, so they simply stay blank
 * until those renderers get a CPU counterpart too.
 */
export async function wireVelloLoaders(
  ctx: BattlefieldBootstrapContext
): Promise<void> {
  if (ctx.rendererBackend === "cpu") {
    const { getCpuRenderer } = await import("@/game/render/cpu-loader");
    const cpu = getCpuRenderer();
    if (cpu && ctx.atlasLoader) {
      ctx.atlasLoader.setCpuRenderer(cpu);
      ctx.adjacentMapCache = new AdjacentMapCache(ctx.atlasLoader);
    }
    return;
  }

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
