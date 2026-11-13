import { invoke } from "@tauri-apps/api/core";
import {
	Bell,
	Bluetooth,
	BatteryCharging,
	BatteryLow,
	BatteryMedium,
	CalendarClock,
	CircleCheck,
	CircleX,
	ClipboardCheck,
	Download,
	Headphones,
	LoaderCircle,
	Timer
} from "lucide-react";

/** One live activity from the Island Engine (src-tauri/src/activities). */
export interface Activity {
	id: string;
	kind: string;
	priority?: number;
	startedMs?: number;
	expiresMs?: number | null;
	liftUntilMs?: number | null;
	signal?: "positive" | "timer" | "alert" | "focus" | "transfer" | "music" | null;
	icon?: string | null;
	title: string;
	value?: string | null;
	detail?: string | null;
	progress?: number | null;
	action?: string | null;
}

export interface Presentation {
	main: Activity | null;
	bubble: Activity | null;
	rest: Activity[];
	lifting: boolean;
}

export const EMPTY_PRESENTATION: Presentation = { main: null, bubble: null, rest: [], lifting: false };

/** Kinds that stay in the island while they last, not only as a short lift. */
const PERSISTENT_KINDS = new Set(["download", "custom"]);

/** Whether an activity should take the collapsed island right now. */
export function showsInIsland(p: Presentation): boolean {
	return !!p.main && (p.lifting || PERSISTENT_KINDS.has(p.main.kind));
}

export function showsAsBubble(a: Activity | null): a is Activity {
	return !!a && PERSISTENT_KINDS.has(a.kind);
}

export function ActivityIcon({ icon, size = 15 }: { icon?: string | null; size?: number }) {
	if (icon && icon.startsWith("data:")) {
		return <img src={icon} alt="" width={size + 3} height={size + 3} style={{ borderRadius: 5 }} />;
	}
	const p = { size, strokeWidth: 2.2 };
	switch (icon) {
		case "battery-charging":
			return <BatteryCharging {...p} />;
		case "battery-low":
			return <BatteryLow {...p} />;
		case "battery":
			return <BatteryMedium {...p} />;
		case "headphones":
			return <Headphones {...p} />;
		case "bluetooth":
			return <Bluetooth {...p} />;
		case "download":
			return <Download {...p} />;
		case "download-done":
		case "custom-done":
			return <CircleCheck {...p} />;
		case "custom-failed":
			return <CircleX {...p} />;
		case "custom-running":
			return <LoaderCircle {...p} className="activity-spin" />;
		case "clipboard":
			return <ClipboardCheck {...p} />;
		case "timer":
			return <Timer {...p} />;
		case "calendar":
			return <CalendarClock {...p} />;
		default:
			return <Bell {...p} />;
	}
}

/** Runs an activity's click action. Returns a panel name for the island to open. */
export function runActivityAction(action?: string | null): string | null {
	if (!action) return null;
	if (action.startsWith("open:")) {
		invoke("open_app", { appName: action.slice(5) }).catch(() => {});
		return null;
	}
	if (action.startsWith("panel:")) return action.slice(6);
	return null;
}

/** Fire-and-forget helpers for activities the island itself produces. */
export function liftActivity(activity: Activity, ttlMs?: number) {
	invoke("activity_lift", { activity, ttlMs: ttlMs ?? null }).catch(() => {});
}

export function upsertActivity(activity: Activity) {
	invoke("activity_upsert", { activity }).catch(() => {});
}

export function endActivity(id: string) {
	invoke("activity_end", { id }).catch(() => {});
}

/** Today's count of clipboard captures, kept per day in localStorage. */
export function bumpClipboardCount(): number {
	const key = `bloom-clip-count-${new Date().toDateString()}`;
	let n = 0;
	try {
		n = Number(localStorage.getItem(key) || "0") + 1;
		localStorage.setItem(key, String(n));
	} catch {
		/* ignore */
	}
	return n;
}
