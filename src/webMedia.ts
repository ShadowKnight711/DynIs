/**
 * Web media (2.1): what the DynIs browser extension reports for the tab that
 * is playing (YouTube, YouTube Music, Spotify, Apple Music, SoundCloud and,
 * when allowed, other sites), and how it is chosen over the system media
 * session. Pure, so it can be unit-tested.
 */

export interface WebQueueItem {
	title: string;
	artist: string;
	art: string | null;
	/** The row's place on the page, for "jump to". */
	index: number;
}

export interface WebMedia {
	site: string;
	source: string;
	title: string;
	artist: string;
	art: string | null;
	durationMs: number | null;
	positionMs: number | null;
	positionAt: number;
	playing: boolean;
	canNext: boolean;
	canPrev: boolean;
	canSeek: boolean;
	queueKind: "queue" | "upnext" | "none" | string;
	queue: WebQueueItem[];
}

/** The `browser-media` event payload (null when no tab plays anything). */
export interface WebMediaState {
	updated: number;
	connected: boolean;
	browser: string;
	media: WebMedia | null;
}

/** The island's media shape (the `media-update` payload). */
export interface MediaInfoLike {
	title: string;
	artist: string;
	is_playing: boolean;
	has_media: boolean;
	artwork?: string[];
	position_ms?: number;
	duration_ms?: number;
	seek_enabled?: boolean;
	position_updated_at?: number;
	shuffle?: boolean | null;
	repeat?: string | null;
	source_app?: string;
}

/** Marks media that came from the extension (`source_app`). */
export const WEB_SOURCE_PREFIX = "web:";

export const WEB_SITES = [
	{ id: "youtube", label: "YouTube" },
	{ id: "ytmusic", label: "YouTube Music" },
	{ id: "spotify", label: "Spotify Web Player" },
	{ id: "applemusic", label: "Apple Music" },
	{ id: "soundcloud", label: "SoundCloud" },
	{ id: "generic", label: "Other Sites" }
] as const;

export type WebSiteId = (typeof WEB_SITES)[number]["id"];

/** `bloom-web-media-sites` → on/off per site (all on except Other Sites). */
export function parseWebSites(value: unknown): Record<WebSiteId, boolean> {
	let parsed: Record<string, unknown> = {};
	if (typeof value === "string") {
		try {
			const v = JSON.parse(value);
			if (v && typeof v === "object") parsed = v;
		} catch {
			/* defaults */
		}
	} else if (value && typeof value === "object") parsed = value as Record<string, unknown>;
	const out = {} as Record<WebSiteId, boolean>;
	for (const s of WEB_SITES) out[s.id] = typeof parsed[s.id] === "boolean" ? (parsed[s.id] as boolean) : s.id !== "generic";
	return out;
}

/**
 * Whether a system media session belongs to a web browser. Firefox registers
 * under a 16-hex-digit hash of its install folder (e.g. 308046B0AF4A39CB).
 */
export function isBrowserSource(sourceApp: string | null | undefined): boolean {
	if (!sourceApp) return false;
	return /(brave|chrome|msedge|edge|firefox|opera|vivaldi|arc)/i.test(sourceApp) || /^[0-9A-F]{16}$/.test(sourceApp);
}

export function isWebSource(sourceApp: string | null | undefined): boolean {
	return !!sourceApp && sourceApp.startsWith(WEB_SOURCE_PREFIX);
}

/** "YouTube · Brave" */
export function webSourceLabel(state: WebMediaState | null): string | null {
	if (!state?.media) return null;
	return [state.media.source, state.browser].filter(Boolean).join(" · ");
}

/** The extension's state in the island's media shape. */
export function webToMediaInfo(state: WebMediaState): MediaInfoLike | null {
	const m = state.media;
	if (!state.connected || !m) return null;
	return {
		title: m.title,
		artist: m.artist,
		is_playing: m.playing,
		has_media: true,
		artwork: m.art ? [m.art] : undefined,
		position_ms: m.positionMs ?? 0,
		duration_ms: m.durationMs ?? 0,
		seek_enabled: m.canSeek,
		position_updated_at: m.positionAt,
		shuffle: null,
		repeat: null,
		source_app: `${WEB_SOURCE_PREFIX}${webSourceLabel(state) ?? m.source}`
	};
}

/**
 * Which media the island shows.
 * - "Ignore Browser Media" on, or no web media: the system session.
 * - Web media playing: it wins over the browser's own system session (which
 *   has no queue and weak next/previous), and over another app unless that
 *   app started playing more recently.
 * - Nothing playing: the web tab if the system session is a browser or empty.
 */
export function chooseMedia(
	system: MediaInfoLike | null,
	systemPlayingSince: number,
	web: WebMediaState | null,
	webPlayingSince: number,
	ignoreBrowsers: boolean
): "system" | "web" {
	if (ignoreBrowsers || !web?.connected || !web.media) return "system";
	const sysIsBrowser = !system || !system.has_media || isBrowserSource(system.source_app);
	if (web.media.playing) {
		if (sysIsBrowser || !system?.is_playing) return "web";
		return webPlayingSince >= systemPlayingSince ? "web" : "system";
	}
	if (system?.is_playing && !sysIsBrowser) return "system";
	return sysIsBrowser ? "web" : "system";
}

/** The up-next rows in the shape the Home view shows (Spotify's). */
export function webQueueForHome(state: WebMediaState | null) {
	const m = state?.media;
	if (!m || m.queue.length === 0) return null;
	return {
		kind: m.queueKind,
		current: null,
		next: m.queue.map((q, i) => ({ id: `web-${q.index}-${i}`, uri: "", name: q.title, artist: q.artist, art: q.art }))
	};
}
