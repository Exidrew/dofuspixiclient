import { DOMAdapter, GpuTextureSystem, type Texture } from "pixi.js";

/**
 * Pixi's WebGPU `generateCanvas` (used by `extract.canvas` / `extract.pixels`)
 * copies the source texture into a canvas configured with
 * `navigator.gpu.getPreferredCanvasFormat()`. Render textures default to
 * `bgra8unorm`, but on some devices (e.g. Intel/Mesa on Linux) the preferred
 * format is `rgba8unorm`, and `copyTextureToTexture` rejects mismatched
 * formats -> extracted canvases (fighter portraits, spell icons) stay blank.
 *
 * Configure the canvas with the source texture's own format instead. Both
 * `rgba8unorm` and `bgra8unorm` are valid WebGPU canvas formats everywhere.
 */
const CANVAS_FORMATS = new Set<string>(["rgba8unorm", "bgra8unorm"]);

type GpuTextureSystemInternal = {
  _renderer: {
    gpu: { device: GPUDevice };
    texture: { getGpuSource: (source: Texture["source"]) => GPUTexture };
  };
};

GpuTextureSystem.prototype.generateCanvas = function (
  this: GpuTextureSystemInternal,
  texture: Texture
) {
  const renderer = this._renderer;
  const device = renderer.gpu.device;
  const gpuTexture = renderer.texture.getGpuSource(texture.source);
  const canvas = DOMAdapter.get().createCanvas() as HTMLCanvasElement;
  canvas.width = texture.source.pixelWidth;
  canvas.height = texture.source.pixelHeight;

  const format = CANVAS_FORMATS.has(gpuTexture.format)
    ? gpuTexture.format
    : (navigator.gpu?.getPreferredCanvasFormat() ?? "bgra8unorm");
  const context = canvas.getContext("webgpu") as GPUCanvasContext;
  context.configure({
    device,
    usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
    format,
    alphaMode: "premultiplied",
  });

  const commandEncoder = device.createCommandEncoder();
  commandEncoder.copyTextureToTexture(
    { texture: gpuTexture, origin: { x: 0, y: 0 } },
    { texture: context.getCurrentTexture() },
    { width: canvas.width, height: canvas.height }
  );
  device.queue.submit([commandEncoder.finish()]);
  return canvas;
} as unknown as GpuTextureSystem["generateCanvas"];
