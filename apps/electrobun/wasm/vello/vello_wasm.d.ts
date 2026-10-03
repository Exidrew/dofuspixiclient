/* tslint:disable */
/* eslint-disable */

/**
 * Chroma subsampling format
 */
export enum ChromaSampling {
    /**
     * Both vertically and horizontally subsampled.
     */
    Cs420 = 0,
    /**
     * Horizontally subsampled.
     */
    Cs422 = 1,
    /**
     * Not subsampled.
     */
    Cs444 = 2,
    /**
     * Monochrome.
     */
    Cs400 = 3,
}

/**
 * CPU-only `.dofasset` rasterizer — no `wgpu`/WebGPU/`GPUDevice` anywhere in
 * this struct. Exists as the fallback path for devices where WebGPU is
 * unavailable or unreliable (see `webgpu-diagnostics.ts` on the client).
 * Deliberately independent from `VelloRenderer` (no shared state) so this
 * increment doesn't risk the existing GPU pipeline. Scope matches
 * `scene_builder_cpu`: body-part frames + base/delta z-order, no
 * accessories yet.
 */
export class CpuRenderer {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Mirrors `VelloRenderer::free_asset`.
     */
    freeAsset(id: number): void;
    /**
     * Mirrors `VelloRenderer::get_animation_meta` (no accessories — out of
     * scope for the CPU path for now). Returns `{ width, height, anchorX,
     * anchorY }`, or `null` if the asset/animation isn't found.
     */
    getAnimationMeta(asset_id: number, animation: string, resolution: number): any;
    getAnimationNames(asset_id: number): string[];
    /**
     * Decode a `.dofasset` into `id`. Mirrors `VelloRenderer::load_asset`
     * (caller-assigned id, magic-byte validation) so the two renderers can
     * share the same asset-id bookkeeping on the TS side.
     */
    loadAsset(id: number, bytes: Uint8Array): boolean;
    constructor();
    /**
     * Rasterize one frame entirely on the CPU. `colors` is an optional
     * 3-element `[r, g, b]` (packed 0xRRGGBB) player-color array, or an
     * empty array for "no replacement". Returns `{ rgba, width, height }`
     * (straight-alpha RGBA8, row-major) — upload directly via
     * `Texture.fromBuffer` on the JS side, no `ExternalSource` involved.
     */
    renderFrame(asset_id: number, animation: string, frame_index: number, resolution: number, colors: Uint32Array): any;
}

export class VelloRenderer {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Batch-copy multiple textures into a destination texture. ONE queue.submit for all copies.
     * `copies` is a flat array: [src_id, dst_x, dst_y, src_id, dst_x, dst_y, ...]
     * All copies go to the same destination texture (the atlas).
     */
    batchCopy(dst_texture_id: number, copies: Float64Array): boolean;
    /**
     * Create an atlas texture for packing multiple character frames.
     * Returns { texture: GPUTexture, textureId: number, width, height }.
     * All characters' frames are copied into this single texture via renderFrameToAtlas.
     */
    createAtlas(width: number, height: number): any;
    /**
     * Render all queued frames in a composite grid, then batch-copy to atlas.
     * 1 Vello render + 1 batch copy = 2 GPU submits total.
     */
    flushFrames(atlas_texture_id: number): void;
    /**
     * Free all cached textures.
     */
    freeAllTextures(): void;
    /**
     * Free a loaded asset.
     */
    freeAsset(id: number): void;
    /**
     * Free a rendered texture by its ID (returned from renderFrame).
     * The wgpu::Texture is removed from our HashMap and dropped, releasing
     * the reference to the underlying GPUTexture. We do NOT call tex.destroy()
     * because Pixi.js may still have pending GPU commands referencing it.
     * The browser's GC will collect the GPUTexture once all references are gone.
     */
    freeTexture(texture_id: number): void;
    /**
     * Get animation info. Returns { fps, frameCount, offsetX, offsetY, trimX, trimY, ... } or null.
     * `offsetX/Y` is derived from the first frame's net offset (where Flash (0,0) actually
     * lands in the rendered texture). This avoids sub-pixel discrepancies between the SWF
     * metadata and the actual SVG content positioning that cause jitter between animations.
     */
    getAnimationInfo(asset_id: number, animation: string): any;
    /**
     * Get per-animation uniform canvas size + anchor.
     * Returns { width, height, anchorX, anchorY } or null.
     * All frames render at this size — eliminates jitter from per-frame size variation.
     * The game engine draws the canvas at (screenX - anchorX, screenY - anchorY).
     */
    getAnimationMeta(asset_id: number, animation: string, resolution: number, acc_info?: Uint32Array | null): any;
    /**
     * List animation names for an asset.
     */
    getAnimationNames(asset_id: number): string[];
    /**
     * Compute pixel dimensions for a frame at a given resolution.
     * Returns the **uniform** canvas size for the entire animation (not per-frame).
     * This ensures all frames of the same animation render at the same size,
     * eliminating jitter from per-frame size variation.
     * Returns [width, height].
     */
    getFrameSize(asset_id: number, animation: string, _frame_index: number, resolution: number): Uint32Array;
    /**
     * Initialize the renderer. Returns a JS object `{ renderer, adapter, device }`
     * so JS can pass `{ adapter, device }` to Pixi.js.
     */
    static init(): Promise<any>;
    /**
     * Load a .dofasset binary. Returns true on success, false if data is invalid.
     * Never panics — invalid data is handled gracefully to avoid poisoning
     * the wasm-bindgen RefCell (which would break ALL subsequent calls).
     */
    loadAsset(id: number, data: Uint8Array): boolean;
    /**
     * Load a SWF bundle by name (e.g. "g1", "o3", "player10"). Returns true on
     * success.
     */
    loadSwfBundle(name: string, bytes: Uint8Array): boolean;
    /**
     * Queue a frame for batch rendering. Builds the Vello scene (CPU work) and stores it.
     * Returns { width, height } of the frame, or null on failure.
     * Call flushFrames() to render all queued frames in ONE GPU dispatch + copy.
     */
    queueFrame(asset_id: number, animation: string, frame_index: number, resolution: number, colors: Uint32Array | null | undefined, acc_info: Uint32Array | null | undefined, dst_x: number, dst_y: number): any;
    /**
     * Render ALL frames of an animation into a single horizontal strip texture.
     * Returns { texture, textureId, width, height, frameWidth, frameHeight, frameCount }.
     * JS extracts sub-rectangles: frame i is at (i * frameWidth, 0, frameWidth, frameHeight).
     * One GPU dispatch for all frames — much faster than rendering frames individually.
     * Supports accessories: pass acc_info as flat [asset_id, slot_id, ...] pairs.
     */
    renderAnimationStrip(asset_id: number, animation: string, resolution: number, colors?: Uint32Array | null, acc_info?: Uint32Array | null): any;
    /**
     * Render a frame and copy it into a slot of an atlas texture.
     * Returns { width, height } of the rendered frame, or null on failure.
     * dst_x/dst_y are pixel coordinates in the atlas.
     */
    renderFrameToAtlas(atlas_texture_id: number, dst_x: number, dst_y: number, asset_id: number, animation: string, frame_index: number, resolution: number, colors?: Uint32Array | null, acc_info?: Uint32Array | null, slot_w?: number | null, slot_h?: number | null): any;
    /**
     * Render a frame and return the raw `GPUTexture` as a JsValue.
     * Render a frame with optional player colors [color1, color2, color3] as 0xRRGGBB.
     * Pass null/undefined for no color replacement.
     * Optional acc_info is a flat array of pairs: [asset_id, slot_id, asset_id, slot_id, ...]
     * Each accessory must be loaded via loadAsset() first. They render using the same
     * animation name and frame index as the character.
     */
    renderFrame(asset_id: number, animation: string, frame_index: number, resolution: number, colors?: Uint32Array | null, acc_info?: Uint32Array | null): any;
    /**
     * Render an exported symbol from a loaded SWF bundle to a fresh GPUTexture.
     * `bundle` is the name passed to `loadSwfBundle`. `export` is the SWF
     * export name (e.g. "168" for tile id 168, or "walkR"/"staticR" for the
     * player). `frame` selects which timeline frame to render (0 for tiles).
     * `resolution` is the output pixels-per-twip multiplier (≈ zoom).
     *
     * Returns `{ texture: GPUTexture, textureId, width, height, anchorX,
     * anchorY }` — `anchorX/Y` is the position of the SWF (0,0) origin
     * inside the rendered texture, so the caller can place the sprite at
     * `(cellCenterX - anchorX, cellCenterY - anchorY)`.
     */
    renderSwfFrame(bundle: string, _export: string, frame: number, resolution: number): any;
    /**
     * Render a single zone mask frame. Returns { texture, textureId, width, height }.
     * Optional acc_info: flat array of pairs [asset_id, slot_id, ...] for accessory occluders.
     */
    renderZoneMaskFrame(asset_id: number, animation: string, frame_index: number, resolution: number, acc_info?: Uint32Array | null): any;
    /**
     * Render a zone mask strip: same layout as renderAnimationStrip but with
     * zone marker colors (R=zone1, G=zone2, B=zone3) and opaque black for non-zone.
     * Used alongside the base strip for GPU color replacement without item bleed.
     * Optional acc_info: flat array of pairs [asset_id, slot_id, ...] for accessory occluders.
     */
    renderZoneMaskStrip(asset_id: number, animation: string, resolution: number, acc_info?: Uint32Array | null): any;
    /**
     * Set the player's three zone colours used by the SWF render path.
     * Each value is `0xRRGGBB`; pass `0` to leave that zone untinted.
     * Mirrors what the dofasset path does via `build_color_replacements`
     * — but applied at render time directly to the SWF, with no bake.
     * Call before `renderSwfFrame` for player/character sprites.
     */
    setSwfPlayerColors(c1: number, c2: number, c3: number): void;
    /**
     * this export — `walkR` is a 1-frame wrapper around the real animation,
     * so JS needs the inner count to drive the ticker.
     */
    swfAnimFrameCount(bundle: string, _export: string): number;
    /**
     * Frames-per-second from the SWF header. Bundles vary: g1/g2 = 12,
     * o1/o2/o4/o5/o6/o7/o10/o12 = 60, o3/o8/o9/o11 = 40. The JS tile
     * ticker reads this per-bundle so an o1 building animates at the
     * 60 fps it was authored for instead of a hardcoded 24 fps that
     * runs everything at 0.4× speed.
     */
    swfBundleFrameRate(bundle: string): number;
    /**
     * Returns the number of frames in the deepest animation reachable through
     * Classify a multi-frame tile sprite as "animated" or "random".
     *
     * Dofus 1.29 multi-frame tile sprites split into two visual kinds:
     *   * **animated** — plays through every frame in a loop (water,
     *     fire, windmill blades). Caller cycles `currentFrame` over time.
     *   * **random**   — a frame-1 `DoAction` reads the sprite's
     *     `_totalframes`, calls `RandomNumber` then `GotoFrame2` with
     *     `set_playing=false`, picking one variant and freezing on it
     *     (grass tile stamps, dirt patches). Caller MUST NOT animate
     *     these — pick one frame at load and hold it, otherwise the
     *     ground crawls.
     *
     * Classify a multi-frame tile sprite into Dofus 1.29's three kinds:
     *   * `"animated"` — no frame-1 script (or none of `random`/`stop`).
     *     Flash plays naturally; caller cycles frames at FPS.
     *   * `"random"` — `random(N) → gotoAndStop(...)` on frame 1.
     *     Self-randomizing; caller picks ONE stable random frame per
     *     cell.
     *   * `"slope"` — `Stop()` on frame 1 with variants on frames 2..N.
     *     The engine externally calls `gotoAndStop(cell.groundSlope)`
     *     (MapHandler.as:226). Caller must use the cell's groundSlope
     *     property to pick the frame.
     *   * empty string for static (1-frame top + 1-frame children) or
     *     unknown bundles.
     *
     * Important: a sprite is "animated" if EITHER the top sprite is
     * multi-frame OR any of its (recursively-traversed) children is
     * multi-frame. Map 35's tile 343 (the wooden building) is a
     * 1-frame top sprite that contains a 210-frame child (1361) —
     * without recursing, we'd label it static and freeze the building.
     */
    swfTileAnimKind(bundle: string, _export: string): string;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_cpurenderer_free: (a: number, b: number) => void;
    readonly __wbg_vellorenderer_free: (a: number, b: number) => void;
    readonly cpurenderer_freeAsset: (a: number, b: number) => void;
    readonly cpurenderer_getAnimationMeta: (a: number, b: number, c: number, d: number, e: number) => any;
    readonly cpurenderer_getAnimationNames: (a: number, b: number) => [number, number];
    readonly cpurenderer_loadAsset: (a: number, b: number, c: number, d: number) => number;
    readonly cpurenderer_new: () => number;
    readonly cpurenderer_renderFrame: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => any;
    readonly vellorenderer_batchCopy: (a: number, b: number, c: number, d: number) => number;
    readonly vellorenderer_createAtlas: (a: number, b: number, c: number) => any;
    readonly vellorenderer_flushFrames: (a: number, b: number) => void;
    readonly vellorenderer_freeAllTextures: (a: number) => void;
    readonly vellorenderer_freeAsset: (a: number, b: number) => void;
    readonly vellorenderer_freeTexture: (a: number, b: number) => void;
    readonly vellorenderer_getAnimationInfo: (a: number, b: number, c: number, d: number) => any;
    readonly vellorenderer_getAnimationMeta: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => any;
    readonly vellorenderer_getAnimationNames: (a: number, b: number) => [number, number];
    readonly vellorenderer_getFrameSize: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly vellorenderer_init: () => any;
    readonly vellorenderer_loadAsset: (a: number, b: number, c: number, d: number) => number;
    readonly vellorenderer_loadSwfBundle: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly vellorenderer_queueFrame: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number) => any;
    readonly vellorenderer_renderAnimationStrip: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => any;
    readonly vellorenderer_renderFrame: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => any;
    readonly vellorenderer_renderFrameToAtlas: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number) => any;
    readonly vellorenderer_renderSwfFrame: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => any;
    readonly vellorenderer_renderZoneMaskFrame: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => any;
    readonly vellorenderer_renderZoneMaskStrip: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => any;
    readonly vellorenderer_setSwfPlayerColors: (a: number, b: number, c: number, d: number) => void;
    readonly vellorenderer_swfAnimFrameCount: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly vellorenderer_swfBundleFrameRate: (a: number, b: number, c: number) => number;
    readonly vellorenderer_swfTileAnimKind: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly wasm_bindgen_f1f22d1002885764___convert__closures_____invoke___js_sys_f0cfdae76522e648___Function_fn_wasm_bindgen_f1f22d1002885764___JsValue_____wasm_bindgen_f1f22d1002885764___sys__Undefined___js_sys_f0cfdae76522e648___Function_fn_wasm_bindgen_f1f22d1002885764___JsValue_____wasm_bindgen_f1f22d1002885764___sys__Undefined_______true_: (a: number, b: number, c: any, d: any) => void;
    readonly wasm_bindgen_f1f22d1002885764___convert__closures_____invoke___wasm_bindgen_f1f22d1002885764___JsValue__core_ed718c3d60ebd546___result__Result_____wasm_bindgen_f1f22d1002885764___JsError___true_: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen_f1f22d1002885764___convert__closures_____invoke___wasm_bindgen_f1f22d1002885764___JsValue______true_: (a: number, b: number, c: any) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_destroy_closure: (a: number, b: number) => void;
    readonly __externref_drop_slice: (a: number, b: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
