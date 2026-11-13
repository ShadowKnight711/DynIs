import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { LINUX_FEATURES, MAC_FEATURES, ccKindSupported, has } from "./platform";

describe("platform features", () => {
	test("the macOS list matches the Rust backend", () => {
		const rust = readFileSync(new URL("../src-tauri/src/platform/mod.rs", import.meta.url), "utf8");
		const block = rust.slice(rust.indexOf('"macos",'), rust.indexOf("// Linux (2.1)"));
		const listed = [...block.matchAll(/"([a-z-]+)"/g)].map((m) => m[1]).filter((f) => f !== "macos");
		expect(listed.sort()).toEqual([...MAC_FEATURES].sort());
	});

	test("the Linux list matches the Rust backend", () => {
		const rust = readFileSync(new URL("../src-tauri/src/platform/mod.rs", import.meta.url), "utf8");
		const block = rust.slice(rust.indexOf('"linux",'), rust.lastIndexOf("PlatformInfo { os, features }"));
		const listed = [...block.matchAll(/"([a-z-]+)"/g)].map((m) => m[1]).filter((f) => f !== "linux");
		expect(listed.sort()).toEqual([...LINUX_FEATURES].sort());
	});

	test("Linux hides Windows-only features", () => {
		for (const f of ["idm", "live-blur", "dock", "wifi", "bluetooth", "app-volume"] as const) {
			expect(has(f, false, true)).toBe(false);
			expect(has(f, false, false)).toBe(true);
		}
		for (const f of ["media", "spotify", "notifications", "brightness", "snap"] as const) expect(has(f, false, true)).toBe(true);
		expect(ccKindSupported("wifi", false, true)).toBe(false);
		expect(ccKindSupported("volume", false, true)).toBe(true);
	});

	test("Windows keeps everything; macOS hides what it can't do", () => {
		expect(has("notifications", false)).toBe(true);
		expect(has("idm", false)).toBe(true);
		expect(has("notifications", true)).toBe(false);
		expect(has("idm", true)).toBe(false);
		expect(has("live-blur", true)).toBe(false);
		expect(has("media", true)).toBe(true);
		// Spotify ships in 2.1.0.
		expect(has("spotify", false)).toBe(true);
		expect(has("spotify", true)).toBe(true);
	});

	test("Control Center drops Windows-only tiles on macOS only", () => {
		for (const k of ["wifi", "bluetooth", "brightness", "dock-mode", "notifications"]) {
			expect(ccKindSupported(k, false)).toBe(true);
			expect(ccKindSupported(k, true)).toBe(false);
		}
		expect(ccKindSupported("volume", true)).toBe(true);
		expect(ccKindSupported("now-playing", true)).toBe(true);
	});
});
