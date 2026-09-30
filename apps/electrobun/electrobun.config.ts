import type { ElectrobunConfig } from "electrobun";

/**
 * Chromium/CEF flags required for the game's WebGPU renderer.
 *
 * Vello (Rust/WASM) creates the `GPUDevice` and renders vector assets into
 * `GPUTexture`s; PixiJS shares that same device and reads the textures via
 * `ExternalSource`. Without WebGPU the canvas stays black — only the React
 * HUD is drawn. Electrobun adds `--disable-gpu` to CEF by default, which
 * disables WebGPU entirely, so we remove it and enable the WebGPU feature
 * flags (plus a SwiftShader Vulkan fallback for machines without a driver).
 */
const WEBGPU_CHROMIUM_FLAGS: Record<string, string | boolean> = {
	// Electrobun sets --disable-gpu by default; `false` REMOVES it. This is
	// the single flag that makes WebGPU unavailable inside the desktop app.
	"disable-gpu": false,
	"enable-unsafe-webgpu": true,
	"enable-features": "Vulkan,WebGPU",
	"ignore-gpu-blocklist": true,
	// ANGLE/Vulkan backend so WebGPU has a usable adapter on Linux/Windows.
	"use-angle": "vulkan",
};

export default {
	app: {
		name: "react-tailwind-vite",
		identifier: "reacttailwindvite.electrobun.dev",
		version: "0.0.1",
	},
	build: {
		bun: {
			entrypoint: "src/window/bun/index.ts",
		},
		copy: {
			"src/dist/index.html": "views/mainview/index.html",
			"src/dist/assets": "views/mainview/assets",
		},
		// The game renderer (Vello WASM + PixiJS) REQUIRES WebGPU: Vello
		// renders into GPUTextures that Pixi reads via ExternalSource. If
		// WebGPU is unavailable, Pixi silently falls back to WebGL, every
		// tile/sprite draw yields nothing and the player only sees the HUD
		// over a black canvas. The flags above disable Electrobun's default
		// `--disable-gpu` and opt into the WebGPU/Vulkan stack.
		mac: {
			bundleCEF: true,
			// DAWN (WebGPU) shared library MUST be shipped with the app:
			// without it the native wrapper's dlopen("libwebgpu_dawn.*")
			// fails, navigator.gpu is unavailable, Pixi silently falls
			// back to WebGL and every Vello-owned GPUTexture draw yields
			// nothing → black canvas behind the HUD. `bundleWGPU` is
			// @default false, so it has to be opted into explicitly.
			bundleWGPU: true,
			chromiumFlags: WEBGPU_CHROMIUM_FLAGS,
		},
		linux: {
			bundleCEF: true,
			bundleWGPU: true,
			chromiumFlags: WEBGPU_CHROMIUM_FLAGS,
		},
		win: {
			bundleCEF: true,
			bundleWGPU: true,
			chromiumFlags: WEBGPU_CHROMIUM_FLAGS,
		},
	},
} satisfies ElectrobunConfig;
