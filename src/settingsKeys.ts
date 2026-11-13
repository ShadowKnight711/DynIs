/**
 * Settings keys, defaults and value mappings shared by every window.
 * Pure (no Tauri imports) so it can be unit-tested with `bun test`.
 */

/** settings.json key behind each Settings control. Every control writes its own key. */
export const SETTING_KEYS = {
	// General
	timeFormat24h: "bloom-time-format-24h",
	lowBatteryThreshold: "bloom-low-battery-threshold",
	// Appearance
	scale: "bloom-scale",
	// Notch
	notchMode: "bloom-notch-mode",
	notchModeChosen: "bloom-notch-mode-chosen",
	notchEdge: "bloom-notch-edge",
	notchEdgeDelay: "bloom-notch-edge-delay",
	islandStyle: "bloom-island-style",
	islandMaterial: "bloom-island-material",
	notchRememberPanel: "bloom-notch-remember-panel",
	notchDefaultPanel: "bloom-notch-default-panel",
	calendarEnabled: "bloom-calendar-enabled",
	timerSoundEnabled: "bloom-timer-sound-enabled",
	musicModeEnabled: "bloom-music-mode-enabled",
	musicCompactNotch: "bloom-music-compact-notch",
	mediaLayout: "bloom-media-layout",
	mediaAmbienceEnabled: "bloom-media-ambience-enabled",
	mediaCompactGlowEnabled: "bloom-media-compact-glow-enabled",
	shelfPersist: "bloom-shelf-persist",
	weatherEnabled: "bloom-weather-enabled",
	tempUnit: "bloom-temp-unit",
	weatherCity: "bloom-weather-city",
	statusWidgets: "bloom-status-widgets",
	// Dock
	dockEnabled: "bloom-dock-enabled",
	dockMode: "bloom-dock-mode",
	dockEdgeDelay: "bloom-dock-edge-delay",
	dockPreviewEnabled: "bloom-dock-preview-enabled",
	dockIconOnly: "bloom-dock-icon-only",
	dockSeparatorEnabled: "bloom-dock-separator-enabled",
	dockAdaptive: "bloom-dock-adaptive",
	dockWinNumberEnabled: "bloom-dock-win-number-enabled",
	dockExtrasPosition: "bloom-dock-extras-position",
	dockExtrasDrives: "bloom-dock-extras-drives",
	dockExtrasHiddenDrives: "bloom-dock-extras-hidden-drives",
	dockExtrasRecycleBin: "bloom-dock-extras-recycle-bin",
	dockTaskView: "bloom-dock-task-view",
	dockExtrasFolders: "bloom-dock-extras-folders",
	dockExtrasCustomFolders: "bloom-dock-extras-custom-folders",
	startIcon: "bloom-start-icon",
	// Overlays
	volumeOverlayEnabled: "bloom-volume-overlay-enabled",
	volumeEdgeEnabled: "bloom-volume-edge-enabled",
	brightnessOverlayEnabled: "bloom-brightness-overlay-enabled",
	brightnessEdgeEnabled: "bloom-brightness-edge-enabled"
} as const;

export type SettingName = keyof typeof SETTING_KEYS;

/** The sliders in Settings and the key each one writes. */
export const SLIDER_SETTINGS: SettingName[] = [
	"notchEdgeDelay",
	"dockEdgeDelay",
	"lowBatteryThreshold"
];

// ── Notch behaviour ──

export const NOTCH_MODES = ["smart", "overlay", "peek", "fixed"] as const;
export type NotchMode = (typeof NOTCH_MODES)[number];

/**
 * Default for new installs (2.0.1). Smart overlays the screen and never
 * reserves space, so maximised windows keep the full screen height. Keep in
 * step with `DEFAULT_NOTCH_MODE` in src-tauri/src/utils.rs.
 */
export const DEFAULT_NOTCH_MODE: NotchMode = "smart";

/** "auto-hide" is the legacy name for smart; anything unknown is the default. */
export function normalizeNotchMode(value: unknown): NotchMode {
	if (value === "auto-hide") return "smart";
	return (NOTCH_MODES as readonly unknown[]).includes(value) ? (value as NotchMode) : DEFAULT_NOTCH_MODE;
}

// ── Theme ──

/**
 * DynIs is dark only (2.0.1): the Light, Custom and Adaptive themes and the
 * theme picker were removed. These keys from older versions are dropped by
 * the settings migration and ignored on import; keep in step with
 * `RETIRED_THEME_KEYS` in src-tauri/src/utils.rs.
 */
export const RETIRED_THEME_KEYS = [
	"bloom-theme-mode",
	"bloom-theme-color",
	"bloom-theme-opacity",
	"bloom-theme-saturation",
	"bloom-theme-brightness"
] as const;

// ── localStorage mirror ──

/** Coordinates live only in settings.json, never in the mirror. */
const NOT_MIRRORED = new Set(["bloom-weather-lat", "bloom-weather-lon"]);

/**
 * Copy one broadcast setting into this window's localStorage mirror.
 *
 * Must run before a window acts on a `settings-changed` event: the Settings
 * window only updates the mirror after `save_setting` returns, and the backend
 * broadcasts before that. Reading the mirror without this gets the previous
 * value (in 2.0.0 this made picking Dark show Light, and the reverse).
 */
export function mirrorSetting(
	key: string,
	value: unknown,
	storage: Pick<Storage, "setItem" | "removeItem"> = localStorage
) {
	if (!key.startsWith("bloom-")) return;
	try {
		if (NOT_MIRRORED.has(key) || value === null || value === undefined) storage.removeItem(key);
		else storage.setItem(key, String(value));
	} catch {
		// Storage can be unavailable; the event's own value is still applied.
	}
}
