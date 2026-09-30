/**
 * WebGPU / Vello → Pixi diagnostics.
 *
 * The map renderer is WebGPU-only: Vello (Rust/WASM) allocates GPUTextures
 * that Pixi consumes through `ExternalSource`. When any link in that chain
 * is missing the canvas stays black behind the HUD with no obvious error.
 * This module produces a human-readable report of every link so the cause
 * is never a guess again.
 *
 * It is intentionally dependency-light (no Pixi import) so it can run before
 * the engine exists and be reused from any bootstrap step.
 */

/**
 * Structural subset of the WebGPU adapter we actually use. Typed locally so
 * the module doesn't fight the two global `GPUAdapter` declarations
 * (`@webgpu/types` uses a nominal `__brand`, the DOM lib does not).
 */
interface WebGPUAdapterLike {
  features: ReadonlySet<string>;
  info?: {
    vendor?: string;
    architecture?: string;
    description?: string;
  };
  requestDevice(): Promise<WebGPUDeviceLike>;
}

interface WebGPUDeviceLike {
  features: ReadonlySet<string>;
  limits: { maxTextureDimension2D: number };
  destroy(): void;
}

interface WebGPUContextLike {
  requestAdapter(options?: {
    powerPreference?: "low-power" | "high-performance";
  }): Promise<WebGPUAdapterLike | null>;
}

export interface WebGPUDiagnosticReport {
  /** navigator.gpu exists (secure context, browser flag, CEF/WGPU bundle). */
  hasNavigatorGpu: boolean;
  /** `requestAdapter()` resolved an adapter (separate probe from Vello). */
  hasAdapter: boolean;
  /** Adapter info when available (vendor/architecture/description). */
  adapterInfo: string;
  /** A `requestDevice()` probe succeeded. */
  hasDevice: boolean;
  /** Features advertised by the probe device (bc/astc/etc2 matter to Pixi). */
  deviceFeatures: string[];
  /** Max 2D texture dimension (Vello atlas sizing). */
  maxTextureDimension2D: number;
  /** Lines describing what is wrong, empty when everything is fine. */
  problems: string[];
}

function describeAdapterInfo(adapter: WebGPUAdapterLike): string {
  const info = adapter.info;
  if (!info) {
    return "unknown";
  }
  const parts = [info.vendor, info.architecture, info.description].filter(
    Boolean
  );
  return parts.length > 0 ? parts.join(" / ") : "unknown";
}

/**
 * Probe the WebGPU stack without touching Vello or Pixi. Safe to call from a
 * non-WebGPU browser: every failure is captured into `problems` and never
 * thrown, so callers can render the report instead of crashing.
 */
export async function diagnoseWebGPU(): Promise<WebGPUDiagnosticReport> {
  const problems: string[] = [];
  const report: WebGPUDiagnosticReport = {
    hasNavigatorGpu: false,
    hasAdapter: false,
    adapterInfo: "n/a",
    hasDevice: false,
    deviceFeatures: [],
    maxTextureDimension2D: 0,
    problems,
  };

  if (typeof navigator === "undefined" || !("gpu" in navigator)) {
    problems.push(
      "navigator.gpu is missing — WebGPU unavailable. In Chrome enable " +
        "chrome://flags/#enable-unsafe-webgpu (and #enable-features=Vulkan " +
        "on Linux); in the desktop build check the WebGPU chromiumFlags + " +
        "bundleWGPU in electrobun.config.ts."
    );
    return report;
  }
  report.hasNavigatorGpu = true;

  const gpu = (navigator as Navigator & { gpu?: WebGPUContextLike }).gpu;
  if (!gpu) {
    problems.push("navigator.gpu is undefined after the presence check.");
    return report;
  }

  let adapter: WebGPUAdapterLike | null = null;

  try {
    // `high-performance` first so we don't accidentally land on a software
    // adapter; fall back to the default proposal if the hint is unsupported.
    adapter =
      (await gpu.requestAdapter({
        powerPreference: "high-performance",
      })) ??
      (await gpu.requestAdapter()) ??
      null;
  } catch (e) {
    problems.push(
      `requestAdapter() threw: ${e instanceof Error ? e.message : String(e)}`
    );
  }

  if (!adapter) {
    problems.push(
      "requestAdapter() returned null — no compatible GPU adapter. On Linux " +
        "this usually means Chrome/CEF has no Vulkan device: verify the " +
        "GPU is exposed (--ignore-gpu-blocklist, use-angle=vulkan) or that " +
        "libwebgpu_dawn is bundled next to the executable."
    );
    return report;
  }

  report.hasAdapter = true;
  report.adapterInfo = describeAdapterInfo(adapter);

  // PixiJS requests these texture-compression features when it creates the
  // device itself. When we hand it a device created elsewhere (Vello), the
  // features must already be present or compressed-texture paths break.
  const wanted = [
    "texture-compression-bc",
    "texture-compression-astc",
    "texture-compression-etc2",
  ];
  const present = wanted.filter((f) => adapter.features.has(f));
  if (adapter.features.has("texture-compression-bc") === false) {
    // Not fatal for the tile/sprite ExternalSource path (rgba8unorm), but
    // surfaced because any compressed asset would silently fail.
    problems.push(
      `adapter is missing texture-compression-bc (present: ${present.join(", ") || "none"}) — compressed textures will not load.`
    );
  }

  try {
    const device = await adapter.requestDevice();
    report.hasDevice = true;
    report.deviceFeatures = [...device.features].filter((f) =>
      wanted.includes(f)
    );
    report.maxTextureDimension2D = device.limits.maxTextureDimension2D;
    if (report.maxTextureDimension2D < 4096) {
      problems.push(
        `maxTextureDimension2D=${report.maxTextureDimension2D} is small — Vello atlases may exceed it.`
      );
    }
    // Release the probe device so it doesn't hold GPU resources.
    device.destroy();
  } catch (e) {
    problems.push(
      `requestDevice() threw: ${e instanceof Error ? e.message : String(e)}`
    );
  }

  return report;
}

/** Format a report as a multi-line string for an on-screen overlay / log. */
export function formatWebGPUDiagnostic(report: WebGPUDiagnosticReport): string {
  const lines = [
    `navigator.gpu: ${report.hasNavigatorGpu ? "yes" : "NO"}`,
    `adapter: ${report.hasAdapter ? "yes" : "NO"} (${report.adapterInfo})`,
    `device: ${report.hasDevice ? "yes" : "NO"}`,
    `maxTexture2D: ${report.maxTextureDimension2D || "n/a"}`,
    `compression features: ${report.deviceFeatures.join(", ") || "none"}`,
  ];
  if (report.problems.length > 0) {
    lines.push("", ...report.problems.map((p) => `• ${p}`));
  }
  return lines.join("\n");
}
