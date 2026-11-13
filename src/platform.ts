/**
 * Which platform DynIs runs on, and which features it can offer there.
 * Mirrors `platform_features()` in src-tauri/src/platform/mod.rs (a test
 * keeps the two lists in sync). Unsupported features are hidden everywhere:
 * setup, Settings, Control Center and widgets.
 */

export type Feature =
	| "media"
	| "battery"
	| "headphones"
	| "notifications"
	| "downloads"
	| "idm"
	| "keep-awake"
	| "snap"
	| "clipboard"
	| "stats"
	| "volume"
	| "brightness"
	| "wifi"
	| "bluetooth"
	| "dock"
	| "live-blur"
	| "app-volume"
	| "lock"
	| "screenshot"
	| "calendar"
	| "spotify";

export const MAC_FEATURES: Feature[] = [
	"media",
	"battery",
	"headphones",
	"downloads",
	"keep-awake",
	"snap",
	"clipboard",
	"stats",
	"volume",
	"lock",
	"screenshot",
	"calendar",
	"spotify"
];

/**
 * Linux (2.1): mirrors the "linux" list in platform/mod.rs. No IDM, live
 * blur, DynIs dock, Wi-Fi/Bluetooth panels or per-app volume.
 */
export const LINUX_FEATURES: Feature[] = [
	"media",
	"battery",
	"headphones",
	"notifications",
	"downloads",
	"keep-awake",
	"snap",
	"clipboard",
	"stats",
	"volume",
	"brightness",
	"lock",
	"screenshot",
	"calendar",
	"spotify"
];

/** Tauri's macOS webview (WKWebView) reports a Macintosh user agent. */
export const isMac: boolean = typeof navigator !== "undefined" && /Macintosh|Mac OS X/.test(navigator.userAgent);

/** WebKitGTK on Linux reports "X11; Linux x86_64" (never Android here). */
export const isLinux: boolean =
	typeof navigator !== "undefined" && !isMac && /Linux|X11/.test(navigator.userAgent) && !/Android/.test(navigator.userAgent);

/**
 * Features that are not finished and stay hidden on every platform. Empty in
 * 2.1.0: Spotify shipped (it was hidden in 2.0.1).
 */
export const UNRELEASED_FEATURES: Feature[] = [];

/** Windows offers everything; macOS and Linux their lists. Unreleased features are off. */
export function has(feature: Feature, mac = isMac, linux = isLinux): boolean {
	if (UNRELEASED_FEATURES.includes(feature)) return false;
	if (mac) return MAC_FEATURES.includes(feature);
	if (linux) return LINUX_FEATURES.includes(feature);
	return true;
}

/** Control Center tiles that need a feature macOS doesn't have. */
const CC_NEEDS: Record<string, Feature> = {
	wifi: "wifi",
	bluetooth: "bluetooth",
	brightness: "brightness",
	"dock-mode": "dock",
	tray: "dock",
	notifications: "notifications",
	focus: "notifications",
	"battery-saver": "brightness"
};

export function ccKindSupported(kind: string, mac = isMac, linux = isLinux): boolean {
	const need = CC_NEEDS[kind];
	return !need || has(need, mac, linux);
}

/** The name of the system key used for shortcuts in labels. */
export const modKey = isMac ? "⌘" : "Ctrl";

/** Main-screen geometry from the macOS backend (`mac_display_info`). */
export interface MacDisplay {
	has_notch: boolean;
	notch_width: number;
	top_inset: number;
	screen_width: number;
}
