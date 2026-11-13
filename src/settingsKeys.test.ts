import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
	DEFAULT_NOTCH_MODE,
	RETIRED_THEME_KEYS,
	SETTING_KEYS,
	SLIDER_SETTINGS,
	mirrorSetting,
	normalizeNotchMode
} from "./settingsKeys";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

function memoryStorage(initial: Record<string, string> = {}) {
	const data = new Map(Object.entries(initial));
	return {
		data,
		getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
		setItem: (k: string, v: string) => void data.set(k, String(v)),
		removeItem: (k: string) => void data.delete(k)
	};
}

describe("settings key mapping", () => {
	test("every control has its own bloom- key", () => {
		const keys = Object.values(SETTING_KEYS);
		expect(new Set(keys).size).toBe(keys.length);
		for (const k of keys) expect(k).toMatch(/^bloom-[a-z0-9-]+$/);
	});

	test("every key is documented in SETTINGS.md", () => {
		const doc = read("../SETTINGS.md");
		const missing = Object.values(SETTING_KEYS).filter((k) => !doc.includes(`\`${k}\``));
		expect(missing).toEqual([]);
	});

	test("each slider in Settings saves to a different key, the one it is meant for", () => {
		const hook = read("./settings/useSettings.ts");
		// handler name → the key its saveSetting call writes
		const handlerKey = new Map<string, string>();
		for (const m of hook.matchAll(/const (handle\w+) = (?:async )?\([^)]*\) => \{([\s\S]*?)\n\t\};/g)) {
			const save = m[2].match(/saveSetting\((?:"([^"]+)"|SETTING_KEYS\.(\w+))/);
			if (save) handlerKey.set(m[1], save[1] ?? SETTING_KEYS[save[2] as keyof typeof SETTING_KEYS]);
		}

		const sliderKeys: string[] = [];
		for (const tab of ["AppearanceTab", "NotchTab", "DockTab", "GeneralTab"]) {
			const src = read(`./settings/${tab}.tsx`);
			for (const block of src.split('type="range"').slice(1)) {
				const handler = block.match(/onChange=\{\(e\) => (handle\w+)\(/)?.[1];
				expect(handler).toBeDefined();
				const key = handlerKey.get(handler!);
				expect(key).toBeDefined();
				sliderKeys.push(key!);
				// The slider shows the value it controls.
				expect(block.slice(0, 400)).toMatch(/value=\{\w+\}/);
			}
		}
		expect(new Set(sliderKeys).size).toBe(sliderKeys.length);
		expect([...sliderKeys].sort()).toEqual(SLIDER_SETTINGS.map((s) => SETTING_KEYS[s]).sort());
	});

	test("Settings reloads every key it writes, and listens for it from other windows", () => {
		const hook = read("./settings/useSettings.ts");
		const loaded = new Set([...hook.matchAll(/getVal\("([^"]+)"\)/g)].map((m) => m[1]));
		const synced = new Set([...hook.matchAll(/^\t\t"(bloom-[^"]+)":/gm)].map((m) => m[1]));
		// Written elsewhere or not a preference on screen.
		const exempt = new Set([SETTING_KEYS.notchModeChosen, SETTING_KEYS.statusWidgets]);
		for (const key of Object.values(SETTING_KEYS)) {
			if (exempt.has(key)) continue;
			expect({ key, loaded: loaded.has(key) }).toEqual({ key, loaded: true });
			expect({ key, synced: synced.has(key) }).toEqual({ key, synced: true });
		}
	});
});

describe("dark only", () => {
	test("Settings has no theme picker or light theme", () => {
		const appearance = read("./settings/AppearanceTab.tsx");
		for (const word of ["themeMode", "Light", "Custom Color", "Adaptive", "Background Opacity"])
			expect(appearance).not.toContain(word);
		for (const file of ["./Settings.tsx", "./settings/Onboarding.tsx", "./settings/useSettings.ts"])
			expect(read(file)).not.toMatch(/bloom-theme-|themeMode|handleThemeModeChange/);
	});

	test("every window paints the dark theme and nothing else", () => {
		const theme = read("./theme.ts");
		expect(theme).toContain('root.classList.add("dark-mode", "theme-dark")');
		expect(theme).not.toMatch(/classList\.add\([^)]*light/);
		expect(theme).not.toContain("bloom-theme-");
		for (const css of ["./App.css", "./Dock.css", "./Overlay.css", "./Settings.css"])
			expect(read(css)).not.toContain(".light-mode");
	});

	test("the retired theme keys match the Rust migration", () => {
		const rust = read("../src-tauri/src/utils.rs");
		const block = rust.slice(rust.indexOf("pub const RETIRED_THEME_KEYS"), rust.indexOf("];", rust.indexOf("pub const RETIRED_THEME_KEYS")));
		const listed = [...block.matchAll(/"(bloom-[a-z-]+)"/g)].map((m) => m[1]);
		expect(listed.sort()).toEqual([...RETIRED_THEME_KEYS].sort());
		// None of them is a Settings control any more.
		for (const key of RETIRED_THEME_KEYS) expect(Object.values(SETTING_KEYS)).not.toContain(key);
	});

	test("a broadcast change reaches the mirror before a window reads it", () => {
		// The mirror still holds the old value when the event arrives.
		const storage = memoryStorage({ "bloom-island-material": "ink" });
		mirrorSetting("bloom-island-material", "glass", storage);
		expect(storage.getItem("bloom-island-material")).toBe("glass");
		mirrorSetting("bloom-notch-edge-delay", 0, storage);
		expect(storage.getItem("bloom-notch-edge-delay")).toBe("0");
	});

	test("the mirror drops cleared values and never stores coordinates", () => {
		const storage = memoryStorage({ "bloom-weather-city": "Paris" });
		mirrorSetting("bloom-weather-city", null, storage);
		mirrorSetting("bloom-weather-lat", "48.8", storage);
		mirrorSetting("not-ours", "x", storage);
		expect([...storage.data.keys()]).toEqual([]);
	});
});

describe("notch behaviour", () => {
	test("new installs and unknown values use Smart", () => {
		expect(DEFAULT_NOTCH_MODE).toBe("smart");
		expect(normalizeNotchMode(null)).toBe("smart");
		expect(normalizeNotchMode(undefined)).toBe("smart");
		expect(normalizeNotchMode("auto-hide")).toBe("smart");
		expect(normalizeNotchMode("bogus")).toBe("smart");
		for (const m of ["smart", "overlay", "peek", "fixed"]) expect(normalizeNotchMode(m)).toBe(m);
	});

	test("the default matches the Rust backend", () => {
		const rust = read("../src-tauri/src/utils.rs");
		expect(rust).toContain(`pub const DEFAULT_NOTCH_MODE: &str = "${DEFAULT_NOTCH_MODE}";`);
		expect(rust).toContain(`pub const NOTCH_MODE_CHOSEN_KEY: &str = "${SETTING_KEYS.notchModeChosen}";`);
	});

	test("no window falls back to Fixed", () => {
		for (const file of ["./App.tsx", "./settings/useSettings.ts"]) {
			expect(read(file)).not.toMatch(/notch-mode"\)?\s*(\|\||,)\s*"fixed"/);
			expect(read(file)).not.toContain('useState("fixed")');
		}
	});
});
