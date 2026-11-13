/**
 * DynIs has one theme: Dark, the solid Ink look (2.0.1). The Light, Custom
 * and Adaptive themes and their picker were removed, so every window (island,
 * dock, overlay, Settings, setup) paints the same dark tokens. The island's
 * own material (Ink / Glass / Glass live blur) is separate and unchanged.
 */

const DARK_TOKENS: Record<string, string> = {
	"--bloom-bg": "var(--ink, #000000)",
	"--bloom-bg-expanded": "var(--ink, #000000)",
	"--bloom-text": "#ffffff",
	"--bloom-text-muted": "rgba(255, 255, 255, 0.6)",
	"--bloom-border": "rgba(255, 255, 255, 0.1)",
	"--bloom-group-bg": "rgba(255, 255, 255, 0.04)",
	"--bloom-accent": "#007aff",
	"--bloom-scrollbar-thumb": "rgba(255, 255, 255, 0.1)"
};

/** Paint the dark theme on this window's root element. */
export function applyDarkTheme(root: HTMLElement = document.documentElement) {
	for (const [name, value] of Object.entries(DARK_TOKENS)) root.style.setProperty(name, value);
	root.classList.add("dark-mode", "theme-dark");
	root.classList.remove("light-mode", "theme-light", "theme-custom", "theme-adaptive");
}

/**
 * Called by every window on mount. The theme never changes at run time, so
 * there is nothing to listen for; returns a no-op cleanup for the callers'
 * `useEffect`.
 */
export function initTheme(): () => void {
	applyDarkTheme();
	return () => {};
}
