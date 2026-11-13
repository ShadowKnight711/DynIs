/** Widgets catalog and saved-layout handling (pure, unit-tested). */

export type WidgetSize = "small" | "large";

export interface WidgetItem {
	id: string;
	kind: string;
	size: WidgetSize;
	/** Per-widget options (city, countdown date, photo path, pinned apps…). */
	opts?: Record<string, unknown>;
}

export interface WidgetMeta {
	label: string;
	desc: string;
	category: string;
	sizes: WidgetSize[];
	/** Only one of these makes sense on the board. */
	single?: boolean;
}

export const CATEGORIES = ["Time & Date", "Weather", "Productivity", "Media", "System", "Shortcuts", "Other"];

export const CATALOG: Record<string, WidgetMeta> = {
	clock: { label: "Clock", desc: "Digital or analog time", category: "Time & Date", sizes: ["small", "large"] },
	worldclock: { label: "World Clock", desc: "The time in another city", category: "Time & Date", sizes: ["small"] },
	calmonth: { label: "Calendar Month", desc: "This month with today marked", category: "Time & Date", sizes: ["small", "large"], single: true },
	month: { label: "Month Progress", desc: "How far through the month you are", category: "Time & Date", sizes: ["small", "large"], single: true },
	day: { label: "Day Progress", desc: "How much of today has passed", category: "Time & Date", sizes: ["small"], single: true },
	year: { label: "Year Progress", desc: "How much of the year has passed", category: "Time & Date", sizes: ["small"], single: true },
	countdown: { label: "Countdown", desc: "Days until a date you choose", category: "Time & Date", sizes: ["small"] },
	sun: { label: "Sunrise & Sunset", desc: "Today's sunrise and sunset", category: "Time & Date", sizes: ["small"], single: true },
	weathernow: { label: "Weather Now", desc: "Current weather, high and low", category: "Weather", sizes: ["small"], single: true },
	weather: { label: "Weather Hourly", desc: "The next hours at a glance", category: "Weather", sizes: ["large", "small"], single: true },
	forecast: { label: "5-Day Forecast", desc: "Highs and lows for the week", category: "Weather", sizes: ["large", "small"], single: true },
	air: { label: "Air Quality", desc: "Air quality where you are", category: "Weather", sizes: ["small"], single: true },
	moon: { label: "Moon Phase", desc: "Tonight's moon", category: "Weather", sizes: ["small"], single: true },
	todos: { label: "To-Do", desc: "Your open to-dos", category: "Productivity", sizes: ["small", "large"], single: true },
	events: { label: "Next Events", desc: "Upcoming Google Calendar events", category: "Productivity", sizes: ["small", "large"], single: true },
	note: { label: "Quick Note", desc: "A note that stays on this PC", category: "Productivity", sizes: ["small", "large"] },
	timer: { label: "Timer", desc: "The island timer", category: "Productivity", sizes: ["small"], single: true },
	pomodoro: { label: "Pomodoro", desc: "Start a 25-minute focus timer", category: "Productivity", sizes: ["small"], single: true },
	stopwatch: { label: "Stopwatch", desc: "Start, stop and reset", category: "Productivity", sizes: ["small"], single: true },
	nowplaying: { label: "Now Playing", desc: "The current song with controls", category: "Media", sizes: ["large", "small"], single: true },
	shelf: { label: "Shelf", desc: "Items on your shelf", category: "Media", sizes: ["small"], single: true },
	system: { label: "System", desc: "CPU, memory, disk and network", category: "System", sizes: ["large", "small"], single: true },
	cpugraph: { label: "CPU Graph", desc: "CPU use over the last minute", category: "System", sizes: ["small", "large"], single: true },
	netgraph: { label: "Network Graph", desc: "Download speed over the last minute", category: "System", sizes: ["small", "large"], single: true },
	storage: { label: "Storage", desc: "Free space on each drive", category: "System", sizes: ["small", "large"], single: true },
	devices: { label: "Batteries", desc: "This PC and your headphones", category: "System", sizes: ["small", "large"], single: true },
	uptime: { label: "Uptime", desc: "How long Windows has been running", category: "System", sizes: ["small"], single: true },
	actions: { label: "Quick Actions", desc: "Keep Awake, Snap, Search, Screenshot, Lock", category: "Shortcuts", sizes: ["large", "small"], single: true },
	apps: { label: "App Launcher", desc: "Up to 6 apps you pin", category: "Shortcuts", sizes: ["large", "small"] },
	quote: { label: "Quote of the Day", desc: "A new quote every day", category: "Other", sizes: ["small", "large"], single: true },
	photo: { label: "Photo", desc: "A picture from your PC", category: "Other", sizes: ["small", "large"] }
};

/** Fresh installs and "Reset to Default". */
export const DEFAULT_LAYOUT: WidgetItem[] = [
	{ id: "weather", kind: "weather", size: "large" },
	{ id: "system", kind: "system", size: "large" },
	{ id: "month", kind: "month", size: "small" }
];

/** Older saves used "clock" for the world clock with a `zone` field. */
const RENAMED: Record<string, string> = {};

/**
 * Reads a saved layout. Unknown kinds are dropped, old fields migrated,
 * sizes fixed to what the kind supports, duplicate ids and duplicate
 * single-instance widgets removed. `null`/garbage → the default layout.
 */
export function parseLayout(raw: unknown): WidgetItem[] {
	let value = raw;
	if (typeof value === "string") {
		try {
			value = JSON.parse(value);
		} catch {
			return DEFAULT_LAYOUT.map((w) => ({ ...w }));
		}
	}
	if (!Array.isArray(value)) return DEFAULT_LAYOUT.map((w) => ({ ...w }));
	const seenIds = new Set<string>();
	const seenSingles = new Set<string>();
	const out: WidgetItem[] = [];
	for (const v of value) {
		if (!v || typeof v !== "object") continue;
		const item = v as Record<string, unknown>;
		let kind = typeof item.kind === "string" ? item.kind : "";
		// 2.0.0 betas: the world clock was "clock" with a `zone`.
		if (kind === "clock" && typeof item.zone === "string") kind = "worldclock";
		kind = RENAMED[kind] ?? kind;
		const meta = CATALOG[kind];
		if (!meta) continue;
		if (meta.single) {
			if (seenSingles.has(kind)) continue;
			seenSingles.add(kind);
		}
		let id = typeof item.id === "string" && item.id ? item.id : kind;
		while (seenIds.has(id)) id = `${id}-x`;
		seenIds.add(id);
		const size: WidgetSize = meta.sizes.includes(item.size as WidgetSize) ? (item.size as WidgetSize) : meta.sizes[0];
		const opts: Record<string, unknown> = { ...((item.opts as Record<string, unknown>) ?? {}) };
		if (typeof item.zone === "string" && !opts.zone) opts.zone = item.zone;
		out.push(Object.keys(opts).length ? { id, kind, size, opts } : { id, kind, size });
	}
	return out;
}

/** Which kinds the Add gallery shows as already added. */
export function addedSingles(layout: WidgetItem[]): Set<string> {
	return new Set(layout.filter((w) => CATALOG[w.kind]?.single).map((w) => w.kind));
}

/** Moon phase 0..1 (0 = new, 0.5 = full) for a date, from a known new moon. */
export function moonPhase(date: Date): number {
	const synodic = 29.530588853;
	const knownNew = Date.UTC(2000, 0, 6, 18, 14);
	const days = (date.getTime() - knownNew) / 86400000;
	const phase = (days % synodic) / synodic;
	return phase < 0 ? phase + 1 : phase;
}

export function moonName(phase: number): string {
	const names = ["New Moon", "Waxing Crescent", "First Quarter", "Waxing Gibbous", "Full Moon", "Waning Gibbous", "Last Quarter", "Waning Crescent"];
	return names[Math.round(phase * 8) % 8];
}
