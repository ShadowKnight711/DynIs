import { motion, AnimatePresence, MotionConfig, useAnimation, useReducedMotion } from "framer-motion";
import { useEffect, useLayoutEffect, useState, useCallback, useMemo, useRef, memo } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getVersion } from "@tauri-apps/api/app";
import { batteryTooltip, type BatteryDetails } from "./batteryTooltip";
import {
	createRegionSender,
	measureElements,
	notchPillBox,
	type RegionRect
} from "./windowRegion";
import "./App.css";
import "./ink.css";
import "./engine.css";
import { initTheme } from "./theme";
import {
	PlayIcon,
	PauseIcon,
	SkipBackIcon,
	SkipForwardIcon,
	VolumeLowIcon,
	VolumeHighIcon,
	MusicNoteIcon,
	HeadphonesIcon
} from "./icons";
import { CompactMediaPlayer } from "./CompactMediaPlayer";
import { useWeather } from "./hooks/useWeather";
import { useSettingsSync } from "./hooks/useSettingsSync";
import { useTrailingThrottle } from "./hooks/useTrailingThrottle";
import { useAnnouncement } from "./hooks/useAnnouncement";
import { reloadIfMirrorWasStale } from "./hooks/settingsMirror";
import { openUrl } from "@tauri-apps/plugin-opener";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { startDrag } from "@crabnebula/tauri-plugin-drag";
import type { WidgetConfig } from "./components/StatusWidgetConfig";
import { EdgeSurface } from "./components/EdgeSurface";
import {
	cornerRadii,
	edgeOffset,
	parseNotchEdge,
	type NotchEdge
} from "./notchEdge";
import { ShelfTypeIcon } from "./components/ShelfTypeIcon";
import { WifiPanel } from "./components/WifiPanel";
import { BluetoothPanel } from "./components/BluetoothPanel";
import { HomePanel } from "./components/HomePanel";
import { prefetchWeather } from "./components/widgetData";
import { CommandSearch, type SearchAction } from "./components/CommandSearch";
import {
	ActivityIcon,
	EMPTY_PRESENTATION,
	bumpClipboardCount,
	liftActivity,
	runActivityAction,
	showsAsBubble,
	showsInIsland,
	upsertActivity,
	endActivity,
	type Activity,
	type Presentation
} from "./activities";
import {
	SPOTIFY_CHANGED_EVENT,
	addToQueue,
	fetchDevices,
	fetchPlaylists,
	fetchQueue,
	isSaved,
	isSpotifyActive,
	isSpotifySource,
	nextRepeat,
	playContext,
	playNow,
	playQueueIndex,
	searchTracks,
	seek as spotifySeek,
	setRepeat as spotifySetRepeat,
	setSaved,
	setShuffle as spotifySetShuffle,
	spotifyConnected,
	transferTo,
	type SpotifyQueue
} from "./spotify";
import {
	CommandCenterGrid,
	DEFAULT_CC_LAYOUT,
	parseCcLayout,
	type CcControl,
	type CcItem
} from "./components/CommandCenterGrid";
import {
	Cpu,
	MemoryStick,
	HardDrive,
	ArrowUpDown,
	BellRing,
	Play,
	Pause,
	RotateCcw,
	Megaphone,
	Type,
	X,
	ChevronLeft,
	ChevronRight,
	Inbox,
	Music,
	Sun,
	Plane,
	Coffee,
	Columns2,
	PanelLeft,
	PanelRight,
	Maximize,
	Minimize2 as CenterIcon,
	House as HomeIcon,
	Calculator,
	Folder,
	Scissors,
	Timer,
	ListChecks,
	Sparkles,
	SunMoon,
	Volume1,
	Volume2,
	VolumeX
} from "lucide-react";
import { ccKindSupported, has, isMac, type MacDisplay } from "./platform";
import { DEFAULT_NOTCH_MODE, SETTING_KEYS, normalizeNotchMode } from "./settingsKeys";
import {
	chooseMedia,
	webQueueForHome,
	webSourceLabel,
	webToMediaInfo,
	type WebMediaState
} from "./webMedia";

/**
 * The notch has two kinds of content:
 * - Panels are tools the user chooses. A click opens the last-used panel by
 *   default, or a selected fixed panel when panel memory is turned off.
 * - Live activities (music, a set timer, a filled shelf) show a compact form in
 *   the pill or a bubble beside it, and opening one shows its own view, which
 *   stands alone (no panel arrows) and is never remembered as the last panel.
 *   Dragging files onto the notch also opens the shelf. Wheel/swipe switches
 *   between tool panels, including when a live activity occupies the pill.
 */
type NotchPanel = "home" | "calendar" | "command-center";
const NOTCH_PANELS: readonly NotchPanel[] = ["home", "calendar", "command-center"];
const asNotchPanel = (value: unknown): NotchPanel | null =>
	NOTCH_PANELS.includes(value as NotchPanel) ? (value as NotchPanel) : null;

// Pomodoro timer limit.
const MAX_TIMER_SECONDS = 180 * 60;

// Inline timer editing: digits fill from the right and the colon is inserted
// automatically ("130" -> 1:30, "2500" -> 25:00, "45" -> 0:45).
const timerDigitsToSeconds = (digits: string): number | null => {
	if (!digits) return null;
	const secs = parseInt(digits.slice(-2) || "0", 10);
	const mins = parseInt(digits.slice(0, -2) || "0", 10);
	const total = mins * 60 + secs;
	return total > 0 && total <= MAX_TIMER_SECONDS ? total : null;
};

const timerSecondsToDigits = (seconds: number): string => {
	const mins = Math.floor(seconds / 60);
	const secs = seconds % 60;
	return `${mins}${secs.toString().padStart(2, "0")}`.replace(/^0+(?=\d)/, "");
};

const formatTimerDigits = (digits: string): string => {
	if (!digits) return "0:00";
	const secs = digits.slice(-2).padStart(2, "0");
	const mins = parseInt(digits.slice(0, -2) || "0", 10);
	return `${mins}:${secs}`;
};

// Completion chime for the Pomodoro timer. Synthesized with the Web Audio API
// so no audio asset is needed; created on the Start click so the webview's
// autoplay policy lets it play when the timer ends.
let timerChimeCtx: AudioContext | null = null;

const getTimerChimeCtx = (): AudioContext | null => {
	try {
		if (!timerChimeCtx) timerChimeCtx = new AudioContext();
		if (timerChimeCtx.state === "suspended") timerChimeCtx.resume().catch(() => {});
		return timerChimeCtx;
	} catch {
		return null;
	}
};

const playTimerChime = () => {
	const ctx = getTimerChimeCtx();
	if (!ctx) return;
	const start = ctx.currentTime + 0.02;
	const master = ctx.createGain();
	master.gain.value = 0.45;
	master.connect(ctx.destination);

	// Soft rising bell arpeggio (A5–C#6–E6) with a quiet octave harmonic.
	const notes = [
		{ freq: 880.0, at: 0 },
		{ freq: 1108.73, at: 0.18 },
		{ freq: 1318.51, at: 0.36 }
	];
	notes.forEach(({ freq, at }) => {
		const osc = ctx.createOscillator();
		const harmonic = ctx.createOscillator();
		const gain = ctx.createGain();
		const harmonicGain = ctx.createGain();
		osc.type = "sine";
		osc.frequency.value = freq;
		harmonic.type = "sine";
		harmonic.frequency.value = freq * 2.01;
		harmonicGain.gain.value = 0.12;
		gain.gain.setValueAtTime(0.0001, start + at);
		gain.gain.exponentialRampToValueAtTime(0.32, start + at + 0.02);
		gain.gain.exponentialRampToValueAtTime(0.0001, start + at + 1.4);
		osc.connect(gain);
		harmonic.connect(harmonicGain);
		harmonicGain.connect(gain);
		gain.connect(master);
		osc.start(start + at);
		harmonic.start(start + at);
		osc.stop(start + at + 1.5);
		harmonic.stop(start + at + 1.5);
	});
};

// Simple SVG icons
function WifiIcon({ enabled, connected }: { enabled: boolean; connected: boolean }) {
	return (
		<svg
			width="18"
			height="18"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2.5"
			strokeLinecap="round"
			strokeLinejoin="round"
			opacity={!enabled ? 0.4 : connected ? 1 : 0.7}
		>
			<path d="M5 12.55a11 11 0 0 1 14.08 0" />
			<path d="M1.42 9a16 16 0 0 1 21.16 0" />
			<path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
			<line x1="12" y1="20" x2="12.01" y2="20" />
		</svg>
	);
}

function TrayIcon() {
	return (
		<svg
			width="14"
			height="14"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2.5"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<rect x="3" y="3" width="6" height="6" rx="1" />
			<rect x="15" y="3" width="6" height="6" rx="1" />
			<rect x="15" y="15" width="6" height="6" rx="1" />
			<rect x="3" y="15" width="6" height="6" rx="1" />
		</svg>
	);
}

/** Collapsed island height (Minimal and Compact), CSS px. */
const ISLAND_HEIGHT = 32;
/** Gap between the floating island and its screen edge, CSS px. */
const ISLAND_GAP = 6;
/** The one spring the island's shape moves on. */
const ISLAND_SPRING = { type: "spring", stiffness: 420, damping: 34, mass: 0.9 } as const;
/** Content arrives just after the shape starts moving and never stretches. */
const CONTENT_IN = { duration: 0.18, delay: 0.06, ease: [0.2, 0, 0, 1] } as const;
/** prefers-reduced-motion: crossfades only, no overshoot. */
const REDUCED_TRANSITION = { duration: 0.12, ease: "easeOut" } as const;

function BatteryIcon({
	charging,
	level,
	threshold = 20
}: {
	charging: boolean;
	level: number;
	threshold?: number;
}) {
	const percentage = Math.min(Math.max(level, 0), 100);

	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				position: "relative",
				height: "14px",
				justifyContent: "center"
			}}
		>
			<svg width="20" height="10" viewBox="0 0 20 10" fill="none">
				{/* Battery Shell - Centered at 9px within 20px width, ignoring the tip's offset */}
				<rect
					x="2"
					y="0.75"
					width="14"
					height="8.5"
					rx="2.4"
					stroke="currentColor"
					strokeOpacity={0.35}
					strokeWidth="1.1"
				/>
				{/* Battery Tip */}
				<path
					d="M17.5 3.5V6.5"
					stroke="currentColor"
					strokeOpacity={0.35}
					strokeWidth="1.2"
					strokeLinecap="round"
				/>
				{/* Fill */}
				<rect
					x="3.8"
					y="2.5"
					width={Math.max(0.5, (percentage / 100) * 10.4)}
					height="5"
					rx="1"
					fill={charging ? "#32D74B" : percentage <= threshold ? "#FF453A" : "white"}
				/>
			</svg>
			{/* Charging Bolt - Centered on the battery body */}
			{charging && (
				<div
					style={{
						position: "absolute",
						top: "50%",
						left: "9px",
						transform: "translate(-50%, -50%)",
						color: "white",
						filter: "drop-shadow(0px 0px 1.5px rgba(0,0,0,0.8))"
					}}
				>
					<svg width="7" height="10" viewBox="0 0 8 12" fill="currentColor">
						<path d="M4.5 0L0 7H3.5L2.5 12L8 5H4.5L5.5 0H4.5Z" />
					</svg>
				</div>
			)}
		</div>
	);
}

export const Visualizer = memo(function Visualizer({
	isPlaying,
	bars = 5,
	height = 20
}: {
	isPlaying: boolean;
	bars?: number;
	height?: number;
}) {
	const [audioData, setAudioData] = useState<number[]>(new Array(bars).fill(0.18));

	useEffect(() => {
		if (!isPlaying) {
			setAudioData(new Array(bars).fill(0.18));
			return;
		}

		const unlisten = listen<{ frequencies: number[] }>("audio-visualization", (event) => {
			// If we receive fewer frequencies than bars, repeat or interpolate
			// If more, slice
			let data = event.payload.frequencies;
			if (data.length > bars) data = data.slice(0, bars);
			while (data.length < bars) data.push(0.18);
			setAudioData(data);
		});

		return () => {
			unlisten.then((fn) => fn());
		};
	}, [isPlaying, bars]);

	return (
		<div
			className="visualizer-horizontal"
			style={{ height: `${height}px`, width: `${bars * 6}px` }}
		>
			{audioData.map((value, i) => (
				<motion.div
					key={i}
					className="bar-horizontal"
					animate={{
						scaleY: isPlaying ? Math.max(0.2, value) : 0.1,
						opacity: isPlaying ? 0.95 : 0.5
					}}
					transition={{
						type: "spring",
						stiffness: 600,
						damping: 30,
						mass: 0.5
					}}
				/>
			))}
		</div>
	);
});

// Number of week rows the current month occupies. Calendar mode sizes the
// notch to the month so five-row months stay compact and six-row months never
// clip the last row.
const calendarMonthRows = (() => {
	const now = new Date();
	const firstWeekday = new Date(now.getFullYear(), now.getMonth(), 1).getDay();
	const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
	return Math.ceil((firstWeekday + daysInMonth) / 7);
})();

// Odometer-style digit for the timer clock. When the value changes the old
// digit rolls up and out while the new one rolls in from below with a slight
// 3D tilt — no card chrome, just the numerals.
const RollDigit = memo(function RollDigit({
	value,
	compact = false
}: {
	value: string;
	compact?: boolean;
}) {
	return (
		<span className={`roll-digit ${compact ? "compact" : ""}`}>
			<AnimatePresence initial={false}>
				<motion.span
					key={value}
					className="roll-num"
					initial={{ y: "72%", rotateX: -50, opacity: 0 }}
					animate={{ y: "0%", rotateX: 0, opacity: 1 }}
					exit={{ y: "-72%", rotateX: 50, opacity: 0 }}
					transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
				>
					{value}
				</motion.span>
			</AnimatePresence>
		</span>
	);
});

interface MediaInfo {
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
	/** The playing app's id (AppUserModelID on Windows). */
	source_app?: string;
}

interface CalendarEvent {
	id: string;
	title: string;
	start: string;
	end: string;
	allDay: boolean;
	location: string | null;
}

interface RecentCopy {
	id: string;
	text: string | null;
	files: string[];
	image: boolean;
	preview: string;
	/** Folder of a single copied file. */
	detail: string | null;
	/** Identity for de-duplicating repeated copies. */
	key: string;
	day: string;
}

interface WifiStatus {
	enabled: boolean;
	connected: boolean;
	ssid: string | null;
}

// A shelf file's preview from the backend: a picture when one can be made,
// else the opening text of a document or text file, and whether it's a folder
// (for the placeholder icon).
interface ShelfPreview {
	thumb: string | null;
	text: string | null;
	folder: boolean;
}

interface ShelfItem {
	id: string;
	type: "file" | "text";
	name: string;
	path?: string;
	text?: string;
	timestamp: number;
}

type BloomMode =
	| "music"
	| "home"
	| "search"
	| "calendar"
	| "command-center"
	| "announcement"
	| "status"
	| "shelf"
	| "wifi"
	| "bluetooth";

// The shelf is a short-lived stash: one row, newest first, oldest evicted.
const SHELF_MAX_ITEMS = 10;

const MARQUEE_SPEED = 30; // px/s — constant for all titles
const MARQUEE_MIN_DURATION = 5; // floor so short titles don't flicker

/** m:ss for a millisecond count. */
const formatMs = (ms: number) => {
	const total = Math.max(0, Math.floor(ms / 1000));
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const sec = String(total % 60).padStart(2, "0");
	return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
};

/**
 * A thin read-only progress bar with elapsed / remaining time, extrapolated
 * between the backend's position updates. Renders nothing without a duration.
 */
const MusicProgress = ({
	positionMs,
	durationMs,
	updatedAt,
	isPlaying
}: {
	positionMs: number;
	durationMs: number;
	updatedAt: number;
	isPlaying: boolean;
}) => {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!isPlaying) return;
		const timer = setInterval(() => setNow(Date.now()), 500);
		return () => clearInterval(timer);
	}, [isPlaying]);
	if (durationMs <= 0) return null;
	const elapsed = isPlaying && updatedAt > 0 ? Math.max(0, now - updatedAt) : 0;
	const pos = Math.min(positionMs + elapsed, durationMs);
	const pct = (pos / durationMs) * 100;
	return (
		<div className="music-progress" aria-label={`${formatMs(pos)} of ${formatMs(durationMs)}`}>
			<div className="music-progress-track">
				<div className="music-progress-fill" style={{ transform: `scaleX(${pct / 100})` }} />
			</div>
			<div className="music-progress-times">
				<span>{formatMs(pos)}</span>
				<span>-{formatMs(durationMs - pos)}</span>
			</div>
		</div>
	);
};

const TitleMarquee = ({ title }: { title: string }) => {
	const textRef = useRef<HTMLSpanElement>(null);
	const containerRef = useRef<HTMLDivElement>(null);
	const [isOverflowing, setIsOverflowing] = useState(false);
	const [scrollDistance, setScrollDistance] = useState(0);
	const [scrollDuration, setScrollDuration] = useState(8);

	useEffect(() => {
		const check = () => {
			if (textRef.current && containerRef.current) {
				const textWidth = textRef.current.scrollWidth;
				const containerWidth = containerRef.current.clientWidth;
				const overflow = textWidth > containerWidth;
				setIsOverflowing(overflow);
				if (overflow) {
					const distance = textWidth - containerWidth;
					setScrollDistance(distance);
					setScrollDuration(Math.max(distance / MARQUEE_SPEED, MARQUEE_MIN_DURATION));
				}
			}
		};
		check();
		const observer = new ResizeObserver(check);
		if (containerRef.current) observer.observe(containerRef.current);
		return () => observer.disconnect();
	}, [title]);

	return (
		<div
			ref={containerRef}
			className="premium-title-wrap"
			style={{ width: "100%", overflow: "hidden" }}
		>
			<span
				ref={textRef}
				className={`premium-title ${isOverflowing ? "marquee" : ""}`}
				style={
					{
						"--scroll-distance": isOverflowing ? `-${scrollDistance}px` : undefined,
						"--scroll-duration": `${scrollDuration}s`
					} as React.CSSProperties
				}
			>
				{title}
			</span>
		</div>
	);
};

function App() {
	useEffect(() => {
		return initTheme();
	}, []);

	const [time, setTime] = useState("");
	const [isHovered, setIsHovered] = useState(false);
	// Expanded into a panel by a click. Hover alone only peeks.
	const [isOpen, setIsOpen] = useState(false);
	const isOpenRef = useRef(false);
	isOpenRef.current = isOpen;
	const [isReady, setIsReady] = useState(false);
	const [scale, setScale] = useState(() =>
		parseFloat(localStorage.getItem("bloom-scale") || "1.0")
	);
	const [timeFormat24h, setTimeFormat24h] = useState(
		() => localStorage.getItem("bloom-time-format-24h") === "true"
	);

	const [batteryLevel, setBatteryLevel] = useState(100);
	const [isCharging, setIsCharging] = useState(false);
	// Fetched when the pointer reaches the battery widget, for its tooltip.
	const [batteryDetails, setBatteryDetails] = useState<BatteryDetails | null>(null);
	// The status widget whose tooltip is open, the side of the pill it hangs
	// from, and the distance from the widget to just past that edge.
	const [statusTooltip, setStatusTooltip] = useState<{
		id: string;
		side: "below" | "left" | "right";
		offset: number;
	} | null>(null);
	const statusTooltipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	// Width the hovered status strip needs so neither side runs into the clock.
	const [statusFitWidth, setStatusFitWidth] = useState(0);
	const [showPowerPulse, setShowPowerPulse] = useState(false);
	const [showLowBatteryPulse, setShowLowBatteryPulse] = useState(false);
	const [lowBatteryThreshold, setLowBatteryThreshold] = useState(() =>
		parseInt(localStorage.getItem("bloom-low-battery-threshold") || "20")
	);
	const prevChargingRef = useRef<boolean | null>(null);
	const powerPulseTimeoutRef = useRef<any>(null);
	const lowBatteryPulseShownRef = useRef<boolean>(false);

	const [eventPeek, setEventPeek] = useState(false);
	const eventPeekTimeoutRef = useRef<any>(null);
	const triggerEventPeek = useCallback((duration = 3000) => {
		setEventPeek(true);
		if (eventPeekTimeoutRef.current) clearTimeout(eventPeekTimeoutRef.current);
		eventPeekTimeoutRef.current = setTimeout(() => setEventPeek(false), duration);
	}, []);

	// Smart is the default since 2.0.1: it overlays windows and never reserves
	// the top strip, so maximised windows keep the full screen height.
	const [notchMode, setNotchModeState] = useState<string>(() =>
		normalizeNotchMode(localStorage.getItem(SETTING_KEYS.notchMode))
	);
	const setNotchMode = useCallback((value: unknown) => setNotchModeState(normalizeNotchMode(value)), []);
	// "pill": the floating capsule; "notch": the classic look attached to the edge.
	const [islandStyle, setIslandStyleState] = useState<"pill" | "notch">(() =>
		localStorage.getItem("bloom-island-style") === "notch" ? "notch" : "pill"
	);
	const setIslandStyle = useCallback(
		(value: unknown) => setIslandStyleState(value === "notch" ? "notch" : "pill"),
		[]
	);
	const isPill = islandStyle === "pill";
	// "ink": solid black; "glass": frosted tint (see ink.css).
	const [islandMaterial, setIslandMaterialState] = useState<"ink" | "glass" | "glass-live">(() => {
		const v = localStorage.getItem("bloom-island-material");
		return v === "glass" || v === "glass-live" ? v : "ink";
	});
	const setIslandMaterial = useCallback(
		(value: unknown) =>
			setIslandMaterialState(value === "glass" || value === "glass-live" ? value : "ink"),
		[]
	);
	const glassCanvasRef = useRef<HTMLCanvasElement>(null);
	// Live blur runs faster while the island is in use.
	const glassActiveRef = useRef(false);
	// macOS with a notch: the Classic island wraps the real camera housing.
	const [macDisplay, setMacDisplay] = useState<MacDisplay | null>(null);
	useEffect(() => {
		if (isMac) invoke<MacDisplay | null>("mac_display_info").then(setMacDisplay).catch(() => {});
	}, []);
	const wrapsNotch = !isPill && !!macDisplay?.has_notch && localStorage.getItem("bloom-notch-edge") !== "bottom";
	const islandHeight = isPill ? ISLAND_HEIGHT : wrapsNotch ? Math.max(36, Math.round(macDisplay!.top_inset)) : 36;
	const [notchEdge, setNotchEdgeState] = useState<NotchEdge>(() =>
		parseNotchEdge(localStorage.getItem("bloom-notch-edge"))
	);
	const setNotchEdge = useCallback((value: unknown) => setNotchEdgeState(parseNotchEdge(value)), []);

	useEffect(() => {
		if (isReady && prevChargingRef.current !== null && prevChargingRef.current !== isCharging) {
			// Island Engine lift (green while charging).
			liftActivity({
				id: "power",
				kind: "charging",
				priority: 6,
				signal: isCharging ? "positive" : null,
				icon: isCharging ? "battery-charging" : "battery",
				title: isCharging ? "Charging" : "On Battery",
				value: `${batteryLevel}%`
			});
			if (notchMode === "peek") triggerEventPeek(4000);
			if (powerPulseTimeoutRef.current) clearTimeout(powerPulseTimeoutRef.current);
			setShowPowerPulse(false);
		}
		prevChargingRef.current = isCharging;
	}, [isCharging, isReady, notchMode, triggerEventPeek]);

	useEffect(() => {
		// Trigger pulse when dropping below threshold while discharging
		if (
			isReady &&
			batteryLevel <= lowBatteryThreshold &&
			!isCharging &&
			!lowBatteryPulseShownRef.current
		) {
			liftActivity({
				id: "low-battery",
				kind: "charging",
				priority: 7,
				signal: "alert",
				icon: "battery-low",
				title: "Low Battery",
				value: `${batteryLevel}%`
			});
			if (notchMode === "peek") triggerEventPeek(5000);
			lowBatteryPulseShownRef.current = true;
			setShowLowBatteryPulse(false);
		}

		// Reset the "shown" state if battery is charged or threshold is lowered
		if (isCharging || batteryLevel > lowBatteryThreshold) {
			lowBatteryPulseShownRef.current = false;
		}
	}, [batteryLevel, isCharging, lowBatteryThreshold, isReady, notchMode, triggerEventPeek]);

	// Weather state (managed by useWeather hook)

	// Media state
	const [isPlaying, setIsPlaying] = useState(false);
	const [mediaInfo, setMediaInfo] = useState<MediaInfo>({
		title: "",
		artist: "",
		is_playing: false,
		has_media: false
	});
	const [albumArtUrl, setAlbumArtUrl] = useState<string | null>(null);
	const [albumArtKey, setAlbumArtKey] = useState(0);
	const [volume, setVolume] = useState(0.5);
	const [isMuted, setIsMuted] = useState(false);
	// Volume / brightness level shown inside the island (replaces the side HUDs
	// for key presses). Held open while hovered or dragged.
	const [levelHud, setLevelHud] = useState<null | "volume" | "brightness">(null);
	const [keepAwake, setKeepAwake] = useState(false);
	// Google Calendar events for this week (empty until connected).
	const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
	const remindedEvents = useRef<Set<string>>(new Set());
	// Copies waiting for "Keep" (not saved unless kept), newest first.
	const [recentCopies, setRecentCopies] = useState<RecentCopy[]>([]);
	// Island Engine presentation (see src-tauri/src/activities).
	const [presentation, setPresentation] = useState<Presentation>(EMPTY_PRESENTATION);
	// Spotify module (off until connected).
	const [spotifyOn, setSpotifyOn] = useState(false);
	const [spotifyQueue, setSpotifyQueue] = useState<SpotifyQueue | null>(null);
	const [spotifyLiked, setSpotifyLiked] = useState<boolean | null>(null);
	const levelHudTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const levelHudHeld = useRef(false);
	const [hudVolumeEnabled, setHudVolumeEnabled] = useState(
		() => localStorage.getItem("bloom-volume-overlay-enabled") !== "false"
	);
	const [hudBrightnessEnabled, setHudBrightnessEnabled] = useState(
		() => localStorage.getItem("bloom-brightness-overlay-enabled") !== "false"
	);
	const scheduleLevelHudHide = useCallback(() => {
		if (levelHudTimer.current) clearTimeout(levelHudTimer.current);
		levelHudTimer.current = setTimeout(() => {
			if (levelHudHeld.current) return;
			setLevelHud(null);
		}, 1500);
	}, []);
	const showLevelHud = useCallback(
		(kind: "volume" | "brightness") => {
			setLevelHud(kind);
			scheduleLevelHudHide();
			if (notchMode === "peek") triggerEventPeek(1700);
		},
		[scheduleLevelHudHide, notchMode, triggerEventPeek]
	);
	// Sliders show 0 while muted, matching the overlay HUD.
	const displayVolume = isMuted ? 0 : volume;
	// Null until the first successful fetch so the pill can't flash a wrong
	// default on startup.
	const [wifiStatus, setWifiStatus] = useState<WifiStatus | null>(null);
	const wifiEnabled = wifiStatus?.enabled ?? false;
	const wifiConnected = wifiStatus?.connected ?? false;
	const [bluetoothEnabled, setBluetoothEnabled] = useState(true);
	// Names of connected Bluetooth devices, for the controls tile.
	const [btConnectedNames, setBtConnectedNames] = useState<string[]>([]);
	const [batterySaverEnabled, setBatterySaverEnabled] = useState(false);
	const [currentBrightness, setCurrentBrightness] = useState(50);

	// System metrics for status widgets
	const [cpuUsage, setCpuUsage] = useState(0);
	const [ramUsage, setRamUsage] = useState(0);
	const [diskSpace, setDiskSpace] = useState(0);
	const [netUpSpeed, setNetUpSpeed] = useState(0);
	const [netDownSpeed, setNetDownSpeed] = useState(0);
	const [statusWidgets, setStatusWidgets] = useState<WidgetConfig>({
		left: ["weather"],
		right: ["battery"]
	});

	const [windowLabel, setWindowLabel] = useState<string>("");
	useEffect(() => {
		setWindowLabel(getCurrentWebviewWindow().label);
	}, []);

	// Remote announcement shown as a persistent notch card until dismissed.
	const {
		announcement,
		dismissed: announcementDismissed,
		dismiss: dismissAnnouncement
	} = useAnnouncement();
	const announcementShownRef = useRef<string | null>(null);
	const announcementOpen = !!announcement && !announcementDismissed;
	const announcementOpenRef = useRef(false);
	announcementOpenRef.current = announcementOpen;

	const [isVisible, setIsVisible] = useState(true);
	const [isImpacted, setIsImpacted] = useState(false);
	const [isExpanded, setIsExpanded] = useState(false);
	const [startupAnimating, setStartupAnimating] = useState(false);

	const [dockMode, setDockMode] = useState(() => {
		const raw = localStorage.getItem("bloom-dock-mode") || "smart";
		if (raw === "auto-hide") return "smart";
		return raw;
	});
	const [dndActive, setDndActive] = useState(false);
	// Customisable Command Center (bloom-cc-layout).
	const [ccLayout, setCcLayoutState] = useState<CcItem[]>(
		() => parseCcLayout(localStorage.getItem("bloom-cc-layout")) ?? DEFAULT_CC_LAYOUT
	);
	const [ccEditing, setCcEditing] = useState(false);
	const [ccHeight, setCcHeight] = useState(190);
	const saveCcLayout = useCallback((next: CcItem[]) => {
		setCcLayoutState(next);
		const json = JSON.stringify(next);
		localStorage.setItem("bloom-cc-layout", json);
		invoke("save_setting", { key: "bloom-cc-layout", value: json }).catch(() => {});
	}, []);
	const [dockEnabled, setDockEnabled] = useState(
		() => localStorage.getItem("bloom-dock-enabled") !== "false"
	);
	const [isNotchHovered, setIsNotchHovered] = useState(false);

	const [isEdgeHovered, setIsEdgeHovered] = useState(false);
	const [isOverlapped, setIsOverlapped] = useState(false);
	const [interactionState, setInteractionState] = useState<"active" | "grace" | "none">("none");
	const bloomRef = useRef<HTMLDivElement>(null);
	// Measured to fit the hovered status strip; see statusFitWidth.
	const leftWidgetsRef = useRef<HTMLDivElement>(null);
	const rightWidgetsRef = useRef<HTMLDivElement>(null);
	const timeCenterRef = useRef<HTMLDivElement>(null);
	const musicBubbleRef = useRef<HTMLButtonElement>(null);
	const shelfBubbleRef = useRef<HTMLButtonElement>(null);
	const bubbleRowRef = useRef<HTMLDivElement>(null);
	// When each bubble first appeared, so the row keeps arrival order.
	const bubbleFirstSeen = useRef<Map<string, number>>(new Map());
	const reportNotchRect = useRef<() => void>(() => {});
	// The pill's target box in window CSS px, and the sender that applies the
	// notch window's region (holding earlier regions while it shrinks).
	const pillTargetRef = useRef<RegionRect | null>(null);
	// The pill's unpadded target box, which the backend hit-tests against. It
	// is the box the pill is springing toward, not a DOM measurement, so it is
	// right on every edge even while a slide-in transform is still running
	// (transforms never trigger the ResizeObserver).
	const pillHitRef = useRef<RegionRect | null>(null);
	const lastNotchRectKey = useRef("");
	// The window's size, as state: the backend moves and resizes the window
	// when the edge changes, and the pill geometry must be recomputed then.
	const [viewport, setViewport] = useState(() => ({
		width: window.innerWidth,
		height: window.innerHeight
	}));
	useEffect(() => {
		const onResize = () =>
			setViewport((v) =>
				v.width === window.innerWidth && v.height === window.innerHeight
					? v
					: { width: window.innerWidth, height: window.innerHeight }
			);
		window.addEventListener("resize", onResize);
		return () => window.removeEventListener("resize", onResize);
	}, []);
	const sendNotchRegion = useMemo(
		() =>
			createRegionSender((rects) => {
				invoke("set_window_region", { rects }).catch(() => {});
			}),
		[]
	);

	// Recomputes the notch window's region from the pill's target box and the
	// floating parts drawn around it, and sends it if it changed. Reads only
	// refs and the DOM, so it is safe to call from any callback.
	const updateNotchRegion = () => {
		const wanted: RegionRect[] = [];
		if (pillTargetRef.current) wanted.push(pillTargetRef.current);
		// Each floating part, padded to cover what it paints outside its box: a
		// tooltip card's shadow reaches 20px out plus a 6px drop, a bubble's
		// glow less, and the screen corners nothing.
		wanted.push(
			...measureElements([
				[".activity-bubble", 16],
				[".status-tooltip", 28]
			])
		);
		sendNotchRegion(wanted);
	};
	const [systemSettingsReady, setSystemSettingsReady] = useState(false);
	// No island (or dock) until first-run setup is finished.
	const [onboarded, setOnboarded] = useState(
		() => localStorage.getItem("bloom-onboarding-complete") === "2.0.0"
	);
	const [waitForStartupSplash, setWaitForStartupSplash] = useState(false);
	const initialSystemSyncDone = useRef(false);
	const splashDone = useRef(false);
	const systemSyncQueue = useRef<Promise<void>>(Promise.resolve());
	const appliedDock = useRef<{ enabled: boolean; mode: string } | null>(null);
	const appliedNotchMode = useRef<string | null>(null);

	const isAnyInteraction = isHovered || isNotchHovered || isEdgeHovered;
	const isHidden =
		!startupAnimating &&
		((notchMode === "smart" && isOverlapped && interactionState === "none") ||
			(notchMode === "peek" && interactionState === "none" && !eventPeek));

	useEffect(() => {
		if (isAnyInteraction) {
			setInteractionState("active");
		} else if (interactionState !== "none") {
			setInteractionState("grace");
			const timer = setTimeout(() => setInteractionState("none"), 800);
			return () => clearTimeout(timer);
		}
	}, [isAnyInteraction]);

	useEffect(() => {
		if (windowLabel === "main") {
			invoke("set_notch_hovered", { hovered: isNotchHovered }).catch(() => {});
		}
	}, [isNotchHovered, windowLabel]);

	// Tell the backend whether the notch is actually on screen so a hidden
	// notch (smart/peek mode) stays click-through instead of swallowing clicks
	// in its footprint.
	useEffect(() => {
		if (windowLabel === "main") {
			invoke("set_notch_visible", { visible: isVisible && !isHidden }).catch(() => {});
		}
	}, [isVisible, isHidden, windowLabel]);

	useEffect(() => {
		const updateRect = () => {
			if (bloomRef.current && windowLabel === "main") {
				// Activity bubbles sit beside the pill and must stay clickable too.
				const hit = pillHitRef.current;
				const pillBox = hit
					? { left: hit.x, top: hit.y, right: hit.x + hit.width, bottom: hit.y + hit.height }
					: bloomRef.current.getBoundingClientRect();
				const rects = [
					pillBox,
					...[musicBubbleRef.current, shelfBubbleRef.current, bubbleRowRef.current]
						.filter((el): el is NonNullable<typeof el> => el !== null)
						.map((el) => el.getBoundingClientRect())
				];
				const left = Math.min(...rects.map((r) => r.left));
				const top = Math.min(...rects.map((r) => r.top));
				const right = Math.max(...rects.map((r) => r.right));
				const bottom = Math.max(...rects.map((r) => r.bottom));
				const rect = {
					x: Math.round(left),
					y: Math.round(top),
					width: Math.round(right - left),
					height: Math.round(bottom - top)
				};
				const key = `${rect.x},${rect.y},${rect.width},${rect.height}`;
				if (key !== lastNotchRectKey.current) {
					lastNotchRectKey.current = key;
					invoke("update_notch_rect", { rect }).catch(() => {});
				}
				// Bubbles finishing their entrance land here too.
				updateNotchRegion();
			}
		};
		reportNotchRect.current = updateRect;

		updateRect();
		window.addEventListener("resize", updateRect);
		const observer = new ResizeObserver(updateRect);
		if (bloomRef.current) observer.observe(bloomRef.current);

		return () => {
			window.removeEventListener("resize", updateRect);
			observer.disconnect();
		};
	}, [isExpanded, isHidden, windowLabel, scale]);

	useEffect(() => {
		if (!windowLabel) return;

		// Only animate the main top-bar
		if (windowLabel !== "main") {
			setIsReady(true);
			setIsImpacted(true);
			setIsExpanded(true);
			return;
		}

		const proceedWithStartup = () => {
			const checkVisibility = async () => {
				try {
					const win = getCurrentWebviewWindow();
					const visible = await win.isVisible();
					if (visible) {
						setStartupAnimating(true);
						setIsReady(true);
						// The window is shown here; WebView2 may only create its
						// render child now, so refresh the drop targets.
						invoke("setup_shelf_drop").catch(() => {});
						setTimeout(() => {
							setIsImpacted(true);
							setIsExpanded(true);
						}, 240);
						setTimeout(() => setStartupAnimating(false), 1500);
						return true;
					}
				} catch (e) {}
				return false;
			};

			const interval = setInterval(async () => {
				if (await checkVisibility()) clearInterval(interval);
			}, 100);

			checkVisibility();
			return interval;
		};

		// Mirror Overlay.tsx's splash decision so we only wait when a splash will actually fire.
		// Overlay always emits splash-done, but on a normal relaunch it emits it near-instantly
		// (after one async getVersion() call) — before this listener would be registered.
		// By making the same decision here we avoid a race and avoid any unnecessary delay.
		const firstRun = localStorage.getItem("bloom-first-run") === null;
		const storedVersion = localStorage.getItem("bloom-app-version");

		const waitForSplash = () => {
			// Splash is definitely coming — register listener now (2800ms animation gives us plenty of time)
			let started = false;
			let interval: any;
			const unlistenSplash = listen("splash-done", () => {
				if (started) return;
				started = true;
				interval = proceedWithStartup();
				unlistenSplash.then((fn) => fn());
			});
			const safetyTimer = setTimeout(() => {
				if (started) return;
				started = true;
				interval = proceedWithStartup();
				unlistenSplash.then((fn) => fn());
			}, 6000);
			return () => {
				clearTimeout(safetyTimer);
				if (interval) clearInterval(interval);
				unlistenSplash.then((fn) => fn());
			};
		};

		if (firstRun || storedVersion === null) {
			// Splash is definitely showing — wait for it
			return waitForSplash();
		}

		// Has a version key — need async check to know if version changed
		let interval: any;
		getVersion()
			.then((currentVersion) => {
				if (storedVersion !== currentVersion) {
					// Version changed — splash is coming, wait for it
					// (splash takes 2800ms so there's plenty of time to register the listener)
					waitForSplash();
				} else {
					// Same version — no splash, start immediately
					interval = proceedWithStartup();
				}
			})
			.catch(() => {
				interval = proceedWithStartup();
			});
		return () => {
			if (interval) clearInterval(interval);
		};
	}, [windowLabel]);

	// Settings state
	const [settingsWeatherEnabled, setSettingsWeatherEnabled] = useState(
		() => localStorage.getItem("bloom-weather-enabled") !== "false"
	);
	const [settingsCalendarEnabled, setSettingsCalendarEnabled] = useState(
		() => localStorage.getItem("bloom-calendar-enabled") !== "false"
	);
	const [settingsTimerSoundEnabled, setSettingsTimerSoundEnabled] = useState(
		() => localStorage.getItem("bloom-timer-sound-enabled") !== "false"
	);
	const [settingsMusicModeEnabled, setSettingsMusicModeEnabled] = useState(
		() => localStorage.getItem("bloom-music-mode-enabled") !== "false"
	);
	const [rememberPanelEnabled, setRememberPanelEnabled] = useState(
		() => (localStorage.getItem("bloom-notch-remember-panel") ??
			localStorage.getItem("bloom-notch-click-to-open")) !== "false"
	);
	const rememberPanelEnabledRef = useRef(rememberPanelEnabled);
	rememberPanelEnabledRef.current = rememberPanelEnabled;
	const [defaultPanel, setDefaultPanel] = useState<NotchPanel>(() =>
		asNotchPanel(localStorage.getItem("bloom-notch-default-panel")) ?? "home"
	);
	// The panel the open notch was last left on. Opening the notch returns to it,
	// across restarts too (bloom-notch-last-panel).
	const [lastPanel, setLastPanel] = useState<NotchPanel | null>(() =>
		asNotchPanel(localStorage.getItem("bloom-notch-last-panel"))
	);
	const [settingsMusicCompactNotch, setSettingsMusicCompactNotch] = useState(
		() => localStorage.getItem("bloom-music-compact-notch") !== "false"
	);
	const [shelfPersist, setShelfPersist] = useState(
		() => localStorage.getItem("bloom-shelf-persist") === "true"
	);
	const [settingsVisualizerEnabled, setSettingsVisualizerEnabled] = useState(
		() => localStorage.getItem("bloom-visualizer-enabled") !== "false"
	);
	const [settingsAlbumArtEnabled, setSettingsAlbumArtEnabled] = useState(
		() => localStorage.getItem("bloom-media-album-art-enabled") !== "false"
	);
	const [settingsAmbienceEnabled, setSettingsAmbienceEnabled] = useState(
		() => localStorage.getItem("bloom-media-ambience-enabled") !== "false"
	);
	const [settingsCompactGlowEnabled, setSettingsCompactGlowEnabled] = useState(
		() => localStorage.getItem("bloom-media-compact-glow-enabled") !== "false"
	);
	const [mediaLayout, setMediaLayout] = useState<"classic" | "compact">(
		() => (localStorage.getItem("bloom-media-layout") as "classic" | "compact") || "classic"
	);
	const [compactVolumeExpanded, setCompactVolumeExpanded] = useState(false);

	// Weather hook
	const {
		temperature,
		weatherCondition,
		weatherIcon: WeatherIcon,
		cityName,
		tempUnit
	} = useWeather(settingsWeatherEnabled);

	useEffect(() => {
		if (!windowLabel) return;
		let cancelled = false;

		invoke("load_settings")
			.then(async (settings: any) => {
				if (await reloadIfMirrorWasStale(settings)) return;
				if (cancelled) return;
				const getVal = (key: string, fallback: string | null = null) => {
					const val = settings[key];
					if (val !== undefined && val !== null) return String(val);
					const local = localStorage.getItem(key);
					if (local !== null) return local;
					return fallback;
				};

				setSettingsWeatherEnabled(getVal("bloom-weather-enabled", "true") !== "false");
				setSettingsCalendarEnabled(getVal("bloom-calendar-enabled", "true") !== "false");
				setSettingsTimerSoundEnabled(getVal("bloom-timer-sound-enabled", "true") !== "false");
				setSettingsMusicModeEnabled(getVal("bloom-music-mode-enabled", "true") !== "false");
				setRememberPanelEnabled(
					(getVal("bloom-notch-remember-panel") ?? getVal("bloom-notch-click-to-open", "true")) !== "false"
				);
				setDefaultPanel(asNotchPanel(getVal("bloom-notch-default-panel")) ?? "home");
				setShelfPersist(getVal("bloom-shelf-persist", "false") === "true");
				setSettingsMusicCompactNotch(getVal("bloom-music-compact-notch", "true") !== "false");
				setLastPanel(asNotchPanel(getVal("bloom-notch-last-panel")));
				const viz =
					getVal("bloom-media-visualizer-enabled") ?? getVal("bloom-visualizer-enabled", "true");
				setSettingsVisualizerEnabled(viz !== "false");
				setSettingsAlbumArtEnabled(getVal("bloom-media-album-art-enabled", "true") !== "false");
				setSettingsAmbienceEnabled(getVal("bloom-media-ambience-enabled", "true") !== "false");
				setSettingsCompactGlowEnabled(
					getVal("bloom-media-compact-glow-enabled", "true") !== "false"
				);
				setTimeFormat24h(getVal("bloom-time-format-24h") === "true");

				const thresholdStr = getVal("bloom-low-battery-threshold", "20");
				if (thresholdStr) setLowBatteryThreshold(parseInt(thresholdStr as string));

				setNotchMode(getVal(SETTING_KEYS.notchMode, DEFAULT_NOTCH_MODE));
				setNotchEdge(getVal("bloom-notch-edge", "top"));
				setIslandStyle(getVal("bloom-island-style", "pill"));
				setIslandMaterial(getVal("bloom-island-material", "ink"));

				if (windowLabel === "main") {
					const firstRun = localStorage.getItem("bloom-first-run") === null;
					if (firstRun) {
						import("@tauri-apps/plugin-autostart").then(({ enable, isEnabled }) => {
							isEnabled().then((enabled) => {
								if (!enabled) enable().catch(() => {});
							});
						});
						localStorage.setItem("bloom-first-run", "done");
					}
					const rawDockMode = getVal("bloom-dock-mode", "smart") as string;
					const dockMode = rawDockMode === "auto-hide" ? "smart" : rawDockMode;
					setDockMode(dockMode);
					setDockEnabled(getVal("bloom-dock-enabled", "true") === "true");
					const storedVersion = localStorage.getItem("bloom-app-version");
					let waitForSplash = firstRun || storedVersion === null;
					if (!waitForSplash) {
						try {
							waitForSplash = storedVersion !== (await getVersion());
						} catch {
							// Version lookup is optional; continue startup without a splash.
						}
					}
					if (cancelled) return;
					setWaitForStartupSplash(waitForSplash);
					setOnboarded(getVal("bloom-onboarding-complete", "") === "2.0.0");
					setSystemSettingsReady(true);
				}

				const scaleVal = getVal("bloom-scale");
				if (scaleVal !== null) setScale(parseFloat(scaleVal));

				const widgetsVal = getVal("bloom-status-widgets");
				if (widgetsVal) {
					try {
						const parsed = JSON.parse(widgetsVal);
						if (parsed && Array.isArray(parsed.left) && Array.isArray(parsed.right)) {
							setStatusWidgets(parsed);
						}
					} catch {}
				}
			})
			.catch((error) => {
				console.error(error);
				if (!cancelled && windowLabel === "main") setSystemSettingsReady(true);
			});
		return () => {
			cancelled = true;
		};
	}, [windowLabel]); // eslint-disable-line react-hooks/exhaustive-deps

	useEffect(() => {
		// Disable context menu globally
		const preventContext = (e: MouseEvent) => e.preventDefault();
		document.addEventListener("contextmenu", preventContext);

		const unlistenVisibility = listen<boolean>("visibility-change", (event) => {
			setIsVisible(event.payload);
		});

		const unlistenNotchOverlap = listen<boolean>("notch-overlap", (event) => {
			setIsOverlapped(event.payload);
		});

		const unlistenNotchEdgeHover = listen<boolean>("notch-edge-hover", (event) => {
			setIsEdgeHovered(event.payload);
		});

		// The backend emits this when the window flips to click-through while
		// the webview still thinks the pointer is inside the notch (it cannot
		// receive the mouseleave once the window is click-through).
		const unlistenNotchPointerLeft = listen("notch-pointer-left", () => {
			releaseNotchHover();
		});

		return () => {
			unlistenVisibility.then((f) => f());
			unlistenNotchOverlap.then((f) => f());
			unlistenNotchEdgeHover.then((f) => f());
			unlistenNotchPointerLeft.then((f) => f());
			document.removeEventListener("contextmenu", preventContext);
		};
	}, [windowLabel]);

	// Settings sync — consolidated dispatch for all settings events
	useSettingsSync(
		{
			"bloom-weather-enabled": setSettingsWeatherEnabled,
			"bloom-calendar-enabled": setSettingsCalendarEnabled,
			"bloom-timer-sound-enabled": setSettingsTimerSoundEnabled,
			"bloom-music-mode-enabled": setSettingsMusicModeEnabled,
			"bloom-notch-remember-panel": setRememberPanelEnabled,
			"bloom-notch-default-panel": (v: unknown) =>
				setDefaultPanel(asNotchPanel(v) ?? "home"),
			"bloom-shelf-persist": setShelfPersist,
			"bloom-music-compact-notch": setSettingsMusicCompactNotch,
			"bloom-notch-last-panel": (v: unknown) => setLastPanel(asNotchPanel(v)),
			"bloom-media-visualizer-enabled": setSettingsVisualizerEnabled,
			"bloom-visualizer-enabled": setSettingsVisualizerEnabled,
			"bloom-media-album-art-enabled": setSettingsAlbumArtEnabled,
			"bloom-media-ambience-enabled": setSettingsAmbienceEnabled,
			"bloom-media-compact-glow-enabled": setSettingsCompactGlowEnabled,
			"bloom-media-layout": setMediaLayout,
			"bloom-scale": setScale,
			"bloom-low-battery-threshold": setLowBatteryThreshold,
			"bloom-dock-enabled": setDockEnabled,
			"bloom-dock-mode": setDockMode,
			"bloom-notch-mode": setNotchMode,
			"bloom-notch-edge": setNotchEdge,
			"bloom-island-style": setIslandStyle,
			"bloom-island-material": setIslandMaterial,
			"bloom-cc-layout": (v) => setCcLayoutState(parseCcLayout(v) ?? DEFAULT_CC_LAYOUT),
			"bloom-volume-overlay-enabled": (v) => setHudVolumeEnabled(String(v) !== "false"),
			"bloom-brightness-overlay-enabled": (v) => setHudBrightnessEnabled(String(v) !== "false"),
			"bloom-status-widgets": (value) => {
				try {
					const parsed = JSON.parse(value);
					if (parsed && Array.isArray(parsed.left) && Array.isArray(parsed.right)) {
						setStatusWidgets(parsed);
					}
				} catch {}
			},
			"bloom-time-format-24h": setTimeFormat24h
		},
		[windowLabel]
	);

	// One owner applies the latest window settings. Superseded splash timers and
	// retries are cancelled; an in-flight command finishes before the new state
	// is applied, so an old startup retry cannot overwrite a user change.
	useEffect(() => {
		if (windowLabel !== "main" || !systemSettingsReady || !onboarded) return;

		let cancelled = false;
		let started = false;
		let attempts = 0;
		let startTimer: number | undefined;
		let splashTimer: number | undefined;
		let retryTimer: number | undefined;
		let settleTimer: number | undefined;
		let unlistenSplash: (() => void) | undefined;

		const reconcile = () => {
			systemSyncQueue.current = systemSyncQueue.current
				.catch(() => {})
				.then(async () => {
					if (cancelled) return;
					try {
						if (dockEnabled) {
							if (!appliedDock.current?.enabled) {
								await invoke("init_dock", { mode: dockMode });
								appliedDock.current = { enabled: true, mode: dockMode };
							} else if (appliedDock.current.mode !== dockMode) {
								await invoke("change_dock_mode", { mode: dockMode });
								appliedDock.current = { enabled: true, mode: dockMode };
							}
						} else if (appliedDock.current?.enabled !== false) {
							await invoke("toggle_dock", { enable: false });
							appliedDock.current = { enabled: false, mode: dockMode };
						}
						if (cancelled) return;
						if (appliedNotchMode.current !== notchMode) {
							await invoke("change_notch_mode", { mode: notchMode });
							appliedNotchMode.current = notchMode;
						}
						if (cancelled) return;
						await invoke("sync_appbar");
						if (cancelled) return;
						const wasInitialSync = !initialSystemSyncDone.current;
						initialSystemSyncDone.current = true;
						if (wasInitialSync) {
							settleTimer = window.setTimeout(() => {
								if (!cancelled) {
									systemSyncQueue.current = systemSyncQueue.current
										.catch(() => {})
										.then(() => invoke<void>("sync_appbar"))
										.catch((error) => console.error("AppBar settle failed", error));
								}
							}, 1000);
						}
					} catch (error) {
						console.error("Window reconciliation failed", error);
						if (!cancelled && attempts++ < 1) {
							retryTimer = window.setTimeout(reconcile, 1000);
						}
					}
				});
		};

		const start = () => {
			if (cancelled || started) return;
			started = true;
			splashDone.current = true;
			if (splashTimer !== undefined) window.clearTimeout(splashTimer);
			unlistenSplash?.();
			startTimer = window.setTimeout(reconcile, initialSystemSyncDone.current ? 0 : 400);
		};

		if (waitForStartupSplash && !splashDone.current && !initialSystemSyncDone.current) {
			void listen("splash-done", start)
				.then((unlisten) => {
					if (cancelled || started) unlisten();
					else unlistenSplash = unlisten;
				})
				.catch(() => start());
			splashTimer = window.setTimeout(start, 6000);
		} else {
			start();
		}

		return () => {
			cancelled = true;
			for (const timer of [startTimer, splashTimer, retryTimer, settleTimer]) {
				if (timer !== undefined) window.clearTimeout(timer);
			}
			unlistenSplash?.();
		};
	}, [windowLabel, systemSettingsReady, onboarded, waitForStartupSplash, dockEnabled, dockMode, notchMode]);

	// Setup finished: start, then say hello once the island has grown in.
	useEffect(() => {
		if (windowLabel !== "main") return;
		const un = listen("onboarding-complete", () => {
			localStorage.setItem("bloom-onboarding-complete", "2.0.0");
			setOnboarded(true);
			setTimeout(
				() =>
					liftActivity(
						{ id: "hello", kind: "notice", priority: 9, signal: null, icon: "bell", title: "Hello from DynIs", value: "👋" },
						3500
					),
				1800
			);
		});
		return () => {
			un.then((fn) => fn());
		};
	}, [windowLabel]);

	// Bloom mode state: 'music', 'calendar', 'command-center', 'announcement', 'shelf', or 'status'
	const [bloomMode, setBloomMode] = useState<BloomMode>("status");

	// Shelf: files and selected text stashed in the notch via drag-and-drop.
	// Files are stored as plain paths (references, never copies). Session-scoped
	// by default; the bloom-shelf-persist setting keeps items across restarts.
	const [shelfItems, setShelfItems] = useState<ShelfItem[]>(() => {
		if (localStorage.getItem("bloom-shelf-persist") !== "true") return [];
		try {
			const saved = localStorage.getItem("bloom-shelf-items");
			const parsed = saved ? JSON.parse(saved) : [];
			if (!Array.isArray(parsed)) return [];
			return parsed
				.filter((i): i is ShelfItem => {
					if (typeof i?.id !== "string" || typeof i?.name !== "string") return false;
					// Items stored before text support have no `type`; treat as files.
					if (i.type === "text") return typeof i.text === "string";
					return typeof i.path === "string";
				})
				.map((i) => ({ ...i, type: i.type === "text" ? "text" : "file" }));
		} catch {
			return [];
		}
	});
	useEffect(() => {
		try {
			if (shelfPersist) {
				localStorage.setItem("bloom-shelf-items", JSON.stringify(shelfItems));
			} else {
				localStorage.removeItem("bloom-shelf-items");
			}
		} catch {
			/* storage full or unavailable — shelf just won't persist */
		}
	}, [shelfItems, shelfPersist]);

	// Drop file references whose files are gone (moved/deleted/drive unplugged)
	// once at startup, so a persisted shelf does not accumulate dead entries.
	// Text items are always kept.
	const shelfPrunedRef = useRef(false);
	useEffect(() => {
		if (shelfPrunedRef.current) return;
		shelfPrunedRef.current = true;
		const filePaths = shelfItems
			.filter((i) => i.type === "file" && i.path)
			.map((i) => i.path as string);
		if (filePaths.length === 0) return;
		invoke<string[]>("shelf_prune", { paths: filePaths })
			.then((existing) => {
				const alive = new Set(existing);
				setShelfItems((prev) => {
					const kept = prev.filter(
						(i) => i.type !== "file" || (i.path !== undefined && alive.has(i.path))
					);
					return kept.length === prev.length ? prev : kept;
				});
			})
			.catch(() => {});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// Previews are generated lazily per path and cached. Images, PDFs, Office
	// files with a saved thumbnail, and anything Windows can thumbnail (videos,
	// folders...) show a picture; documents and text files show their opening
	// text; the rest fall back to an icon for their type. Text items render
	// their content.
	const [shelfThumbs, setShelfThumbs] = useState<Record<string, ShelfPreview>>({});
	const shelfThumbPending = useRef<Set<string>>(new Set());
	useEffect(() => {
		for (const item of shelfItems) {
			if (item.type !== "file" || !item.path) continue;
			const path = item.path;
			if (shelfThumbs[path] !== undefined || shelfThumbPending.current.has(path)) continue;
			shelfThumbPending.current.add(path);
			// The item may be removed while this is in flight; don't resurrect
			// a stale cache entry.
			const storeThumb = (preview: ShelfPreview) =>
				setShelfThumbs((prev) => {
					if (!shelfItemsRef.current.some((i) => i.path === path)) return prev;
					return { ...prev, [path]: preview };
				});
			invoke<ShelfPreview>("shelf_thumbnail", { path })
				.then(storeThumb)
				.catch(() => storeThumb({ thumb: null, text: null, folder: false }))
				.finally(() => shelfThumbPending.current.delete(path));
		}
	}, [shelfItems, shelfThumbs]);

	// Drop cached thumbnails for items that left the shelf so the cache cannot
	// grow without bound over a long session (each entry is a data URI).
	useEffect(() => {
		const current = new Set(shelfItems.filter((i) => i.path).map((i) => i.path as string));
		setShelfThumbs((prev) => {
			const keys = Object.keys(prev);
			if (keys.every((k) => current.has(k))) return prev;
			const next: Record<string, ShelfPreview> = {};
			for (const k of keys) {
				if (current.has(k)) next[k] = prev[k];
			}
			return next;
		});
	}, [shelfItems]);

	// Native drag preview for items without a thumbnail.
	const [shelfDragIcon, setShelfDragIcon] = useState<string | null>(null);
	useEffect(() => {
		invoke<string | null>("shelf_drag_icon")
			.then(setShelfDragIcon)
			.catch(() => {});
	}, []);

	// Picking a file back up is a drag-out gesture: press, move past a small
	// threshold, and the OS takes over the drag. A press without movement is a
	// plain click that opens the file (or copies text items).
	const shelfPointerRef = useRef<{ id: string; x: number; y: number; dragging: boolean } | null>(
		null
	);
	// Timestamp of the last drop onto the notch. A drop recorded during our
	// own drag-out means the item came back to the notch (pointer still over
	// it), which decides whether the drag cleanup clears the hover flags.
	const shelfSelfDropAtRef = useRef(0);
	// True while our own drag-out is running, so the drag-enter we receive when
	// it starts over the notch does not flash the hover outline or re-open it.
	const shelfSelfDragRef = useRef(false);
	const handleShelfPointerDown = (e: React.PointerEvent<HTMLDivElement>, item: ShelfItem) => {
		if (e.button !== 0) return;
		// Text items have no native drag-out; a click copies them.
		if (item.type !== "file" || !item.path) return;
		// The remove button must keep receiving its own click; capturing the
		// pointer on the tile would retarget it.
		if ((e.target as HTMLElement).closest(".shelf-tile-remove")) return;
		e.stopPropagation();
		e.currentTarget.setPointerCapture(e.pointerId);
		shelfPointerRef.current = { id: item.id, x: e.clientX, y: e.clientY, dragging: false };
	};
	const handleShelfPointerMove = (e: React.PointerEvent<HTMLDivElement>, item: ShelfItem) => {
		const st = shelfPointerRef.current;
		if (!st || st.id !== item.id || st.dragging) return;
		if (Math.hypot(e.clientX - st.x, e.clientY - st.y) < 6) return;
		if (!item.path) return;
		const path = item.path;
		const icon = shelfThumbs[path]?.thumb ?? shelfDragIcon;
		if (!icon) return;
		st.dragging = true;
		// Picking an item up is a deliberate act; don't let the post-drop
		// auto-close fire mid-drag.
		clearShelfCollapse();
		shelfSelfDragRef.current = true;
		const dragStartedAt = Date.now();
		startDrag({ item: [path], icon })
			.catch((err) => console.error("[shelf] drag out failed:", path, err))
			.finally(() => {
				shelfSelfDragRef.current = false;
				// A drop recorded during this drag means it landed back on the
				// notch, so the pointer is still over it. Otherwise the native
				// drag owned the pointer and the webview never saw it leave —
				// release the hover state (flags AND the resting mode) or the
				// shelf panel stays expanded. The command also makes the
				// backend re-evaluate its edge-hover state immediately.
				const droppedOnSelf = shelfSelfDropAtRef.current >= dragStartedAt;
				if (!droppedOnSelf) {
					releaseNotchHover();
					invoke("set_notch_hovered", { hovered: false }).catch(() => {});
				}
			});
	};
	const handleShelfTileClick = (e: React.MouseEvent<HTMLDivElement>, item: ShelfItem) => {
		e.stopPropagation();
		const st = shelfPointerRef.current;
		shelfPointerRef.current = null;
		// Only this tile's own drag suppresses the click; a stale flag from a
		// previous tile's drag-out must not swallow it.
		if (st && st.id === item.id && st.dragging) return;
		openShelfItem(item);
	};

	// Wheel scrolling for the shelf strip: ease towards a target instead of
	// jumping, so wheel and trackpad input both feel fluid.
	const shelfScrollTargetRef = useRef<number | null>(null);
	const shelfGridRef = useRef<HTMLDivElement>(null);
	// Whether the shelf row overflows, so it gets room for its scrollbar.
	const [shelfOverflowing, setShelfOverflowing] = useState(false);
	// Measured against the open shelf's width (380px minus its 14px side
	// padding) rather than the live one, which is still growing while the
	// notch animates open. A removed tile stays in the row until its exit
	// animation ends, so the row is measured again then.
	const measureShelfOverflow = useCallback(() => {
		const el = shelfGridRef.current;
		setShelfOverflowing(!!el && el.scrollWidth > 380 - 28 + 1);
	}, []);
	useLayoutEffect(measureShelfOverflow, [shelfItems, bloomMode, measureShelfOverflow]);
	const shelfScrollRafRef = useRef<number | null>(null);
	// The wheel scrolls the row from anywhere over the shelf view, not just
	// over the tiles. Mice that report lines instead of pixels are scaled up.
	const handleShelfWheel = (e: React.WheelEvent<HTMLDivElement>) => {
		const el = shelfGridRef.current;
		if (!el) return;
		const max = el.scrollWidth - el.clientWidth;
		if (max <= 0) return;
		const unit = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? el.clientWidth : 1;
		const base = shelfScrollTargetRef.current ?? el.scrollLeft;
		shelfScrollTargetRef.current = Math.max(0, Math.min(max, base + (e.deltaY + e.deltaX) * unit));
		if (shelfScrollRafRef.current !== null) return;
		const step = () => {
			const target = shelfScrollTargetRef.current;
			if (target === null) {
				shelfScrollRafRef.current = null;
				return;
			}
			const diff = target - el.scrollLeft;
			if (Math.abs(diff) < 0.5) {
				el.scrollLeft = target;
				shelfScrollTargetRef.current = null;
				shelfScrollRafRef.current = null;
				return;
			}
			const before = el.scrollLeft;
			el.scrollLeft += diff * 0.22;
			// At fractional display scales a small step can round back to the
			// same position; finish the move instead of stalling short of it.
			if (el.scrollLeft === before) {
				el.scrollLeft = target;
				shelfScrollTargetRef.current = null;
				shelfScrollRafRef.current = null;
				return;
			}
			shelfScrollRafRef.current = requestAnimationFrame(step);
		};
		shelfScrollRafRef.current = requestAnimationFrame(step);
	};

	// The shelf closes itself shortly after a drop so the notch does not stay
	// expanded. Hovering it cancels the timer; leaving collapses it.
	const shelfCollapseTimer = useRef<number | null>(null);
	// What the collapsed notch shows (see collapsedMode). Refs let the drop
	// listener and the backend pointer-left event, both mounted once, act on
	// the current state.
	const restingModeRef = useRef<BloomMode>("status");
	const bloomModeRef = useRef<BloomMode>("status");
	const rememberPanelRef = useRef<(panel: NotchPanel) => void>(() => {});
	const notchPinnedRef = useRef(false);
	const releaseDeferredRef = useRef(false);

	const reduceMotion = useReducedMotion() ?? false;

	// Shared hover-release, called on DOM hover end and when the backend
	// reports the pointer left the (now click-through) notch window. Closes an
	// open notch, remembering its panel, and returns to the resting mode.
	const releaseNotchHover = () => {
		// A view being typed into (a Wi-Fi password) keeps the notch open; the
		// release happens once it lets go, if the pointer is still away.
		if (notchPinnedRef.current) {
			releaseDeferredRef.current = true;
			return;
		}
		setIsHovered(false);
		setIsNotchHovered(false);
		if (isOpenRef.current) {
			const panel = asNotchPanel(bloomModeRef.current);
			if (panel && rememberPanelEnabledRef.current) rememberPanelRef.current(panel);
			setIsOpen(false);
		}
		setBloomMode((prev) =>
			prev === "music" ||
			prev === "home" ||
			prev === "search" ||
			prev === "command-center" ||
			prev === "calendar" ||
			prev === "status" ||
			prev === "shelf" ||
			prev === "wifi" ||
			prev === "bluetooth"
				? restingModeRef.current
				: prev
		);
	};

	const clearShelfCollapse = () => {
		if (shelfCollapseTimer.current !== null) {
			window.clearTimeout(shelfCollapseTimer.current);
			shelfCollapseTimer.current = null;
		}
	};

	const collapseShelfSoon = (delay = 1800) => {
		clearShelfCollapse();
		shelfCollapseTimer.current = window.setTimeout(() => {
			shelfCollapseTimer.current = null;
			if (bloomModeRef.current !== "shelf") return;
			setIsOpen(false);
			setBloomMode(restingModeRef.current);
		}, delay);
	};

	const removeShelfItem = (id: string) => {
		const next = shelfItems.filter((i) => i.id !== id);
		setShelfItems(next);
		if (next.length === 0 && bloomMode === "shelf") {
			// Nothing left to show: an open notch moves to the remembered panel,
			// a closed one to its resting mode, instead of an empty shelf.
			clearShelfCollapse();
			setBloomMode(isOpen ? openingPanel() : restingModeRef.current);
		}
	};

	// A full shelf never evicts silently: whatever fits is added and the rest
	// is reported. Reads through a ref so the drop listener (mounted once) sees
	// the current list.
	const shelfItemsRef = useRef<ShelfItem[]>(shelfItems);
	shelfItemsRef.current = shelfItems;
	// Tiles that were just added get an entrance animation; ones restored when
	// the panel reopens do not (the panel itself already fades in).
	const shelfNewIdsRef = useRef<Set<string>>(new Set());
	const markShelfNew = (ids: string[]) => {
		for (const id of ids) shelfNewIdsRef.current.add(id);
		window.setTimeout(() => {
			for (const id of ids) shelfNewIdsRef.current.delete(id);
		}, 900);
	};
	const [shelfNotice, setShelfNotice] = useState<string | null>(null);
	const shelfNoticeTimer = useRef<number | null>(null);
	const showShelfNotice = (message: string) => {
		setShelfNotice(message);
		if (shelfNoticeTimer.current !== null) window.clearTimeout(shelfNoticeTimer.current);
		shelfNoticeTimer.current = window.setTimeout(() => {
			shelfNoticeTimer.current = null;
			setShelfNotice(null);
		}, 2600);
	};

	const addShelfItems = (paths: string[]) => {
		if (paths.length === 0) return;
		const prev = shelfItemsRef.current;
		const existing = new Set(prev.filter((i) => i.path).map((i) => i.path));
		const fresh: ShelfItem[] = [];
		for (const p of paths) {
			if (existing.has(p)) continue;
			existing.add(p);
			fresh.push({
				id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
				type: "file",
				name: p.split("\\").pop()?.split("/").pop() || p,
				path: p,
				timestamp: Date.now()
			});
		}
		if (fresh.length === 0) return;

		const room = Math.max(0, SHELF_MAX_ITEMS - prev.length);
		if (room === 0) {
			showShelfNotice(`Shelf is full (${SHELF_MAX_ITEMS}) — remove an item first`);
			return;
		}
		if (fresh.length > room) {
			showShelfNotice(`Shelf is full — added ${room} of ${fresh.length} items`);
		}
		const added = fresh.slice(0, room);
		markShelfNew(added.map((i) => i.id));
		setShelfItems([...added, ...prev]);
	};

	const addShelfText = (text: string) => {
		const prev = shelfItemsRef.current;
		if (prev.some((i) => i.type === "text" && i.text === text)) return;
		if (prev.length >= SHELF_MAX_ITEMS) {
			showShelfNotice(`Shelf is full (${SHELF_MAX_ITEMS}) — remove an item first`);
			return;
		}
		const item: ShelfItem = {
			id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
			type: "text",
			name: text.trim().replace(/\s+/g, " ").slice(0, 48),
			text,
			timestamp: Date.now()
		};
		markShelfNew([item.id]);
		setShelfItems([item, ...prev]);
	};

	// Files open in their default app; text items are copied to the clipboard
	// so they can be pasted anywhere. A file that no longer exists is reported
	// and dropped from the shelf.
	const openShelfItem = (item: ShelfItem) => {
		if (item.type === "text") {
			if (!item.text) return;
			invoke("clipboard_ignore_next")
				.catch(() => {})
				.then(() => writeText(item.text!))
				.then(() => showShelfNotice("Copied to clipboard"))
				.catch((e) => console.error("[shelf] copy failed:", e));
			return;
		}
		if (item.path) {
			const path = item.path;
			invoke("shelf_open", { path }).catch(async (e) => {
				console.error("[shelf] open failed:", path, e);
				// Only a confirmed-missing file leaves the shelf; a transient
				// failure (e.g. no association) must not remove it.
				const alive = await invoke<string[]>("shelf_prune", { paths: [path] }).catch(() => null);
				if (alive && alive.length === 0) {
					showShelfNotice("File no longer exists — removed from shelf");
					removeShelfItem(item.id);
				} else {
					showShelfNotice("Couldn't open the file");
				}
			});
		}
	};

	// Shelf drag-and-drop plumbing. The backend registers its own OLE drop
	// target (src-tauri/src/shelf.rs) because wry's target can go stale when
	// WebView2 recreates its render child; it emits the shelf-drag-* events
	// below. Drag-enter switches to the shelf panel (restoring the previous
	// mode on cancel); drop stashes the real file paths.
	const [isDragHovering, setIsDragHovering] = useState(false);
	const shelfPrevModeRef = useRef<BloomMode>("status");
	const shelfPrevOpenRef = useRef(false);
	const shelfDragActiveRef = useRef(false);
	useEffect(() => {
		let unlisteners: (() => void)[] = [];
		let cancelled = false;

		const enter = (event: { payload: { paths?: string[]; text?: string } }) => {
			// Our own drag-out starts with the cursor over the notch; ignore
			// the enter it causes instead of flashing the hover state.
			if (shelfSelfDragRef.current) return;
			console.info("[shelf] drag-enter:", event.payload.paths ?? event.payload.text);
			setIsDragHovering(true);
			const prev = bloomModeRef.current;
			if (prev === "announcement" || prev === "shelf") return;
			shelfPrevModeRef.current = prev;
			shelfPrevOpenRef.current = isOpenRef.current;
			shelfDragActiveRef.current = true;
			setIsOpen(true);
			setBloomMode("shelf");
		};
		const leave = () => {
			setIsDragHovering(false);
			if (shelfDragActiveRef.current) {
				shelfDragActiveRef.current = false;
				if (bloomModeRef.current === "shelf") {
					setIsOpen(shelfPrevOpenRef.current);
					setBloomMode(shelfPrevModeRef.current);
				}
			}
		};
		const drop = (event: { payload: { paths?: string[]; text?: string } }) => {
			setIsDragHovering(false);
			shelfDragActiveRef.current = false;
			shelfSelfDropAtRef.current = Date.now();
			const paths = event.payload.paths ?? [];
			const text = event.payload.text;
			console.info("[shelf] drop:", paths.length > 0 ? paths : text);
			if (paths.length === 0 && !text) return;
			if (paths.length > 0) addShelfItems(paths);
			if (text) addShelfText(text);
			if (bloomModeRef.current !== "announcement") {
				setIsOpen(true);
				setBloomMode("shelf");
			}
			collapseShelfSoon();
		};

		Promise.all([
			listen<{ paths?: string[]; text?: string }>("shelf-drag-enter", enter),
			listen("shelf-drag-leave", leave),
			listen<{ paths?: string[]; text?: string }>("shelf-drag-drop", drop)
		])
			.then((fns) => {
				if (cancelled) {
					fns.forEach((fn) => fn());
				} else {
					unlisteners = fns;
				}
			})
			.catch((e) => console.error("[shelf] drag-drop listener failed:", e));

		invoke("setup_shelf_drop").catch((e) => console.error("[shelf] drop target setup failed:", e));

		return () => {
			cancelled = true;
			unlisteners.forEach((fn) => fn());
		};
	}, []);

	// Open the notch on an unseen announcement; stays open until dismissed.
	useEffect(() => {
		if (!announcement || announcementDismissed) return;
		if (announcementShownRef.current === announcement.id) return;
		announcementShownRef.current = announcement.id;
		setBloomMode("announcement");
		if (notchMode === "peek") triggerEventPeek(6000);
	}, [announcement, announcementDismissed, notchMode, triggerEventPeek]);

	// Leave the announcement view once it is dismissed (or gone).
	useEffect(() => {
		if (bloomMode === "announcement" && (!announcement || announcementDismissed)) {
			setBloomMode(mediaInfo.has_media && isPlaying ? "music" : "status");
		}
	}, [bloomMode, announcement, announcementDismissed, mediaInfo.has_media, isPlaying]);

	// Window height is now kept constant to prevent rendering layout lag and sharp corners

	const lastScrollTime = useRef(0);
	const handleWheel = (e: React.WheelEvent) => {
		const target = e.target as HTMLElement;
		if (
			target.closest(".calendar-grid") ||
			target.closest(".timer-column") ||
			target.closest(".shelf-content") ||
			target.closest(".qp-list") ||
			// Lists, settings and the open views scroll; the wheel there never
			// switches views. Switching is for the pill, the header and tabs.
			target.closest(".home-content") ||
			target.closest(".command-center-content-minimal") ||
			target.closest(".cmd-search")
		) {
			return;
		}
		// Any other scrollable area: let it scroll while it still can, and
		// pause switching briefly after it hits its end.
		for (let el: HTMLElement | null = target; el && el !== e.currentTarget; el = el.parentElement) {
			const style = getComputedStyle(el);
			if (!/(auto|scroll)/.test(style.overflowY) || el.scrollHeight <= el.clientHeight + 1) continue;
			const atTop = el.scrollTop <= 0;
			const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
			if ((e.deltaY < 0 && !atTop) || (e.deltaY > 0 && !atBottom)) {
				lastScrollTime.current = Date.now() + 400;
				return;
			}
		}

		const now = Date.now();
		if (now - lastScrollTime.current < 250) return;

		// Use absolute values to detect horizontal swipe gestures on trackpad
		const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
		if (Math.abs(delta) < 5) return; // Ignore tiny movements

		if (cycleBloomMode(delta > 0 ? 1 : -1)) lastScrollTime.current = now;
	};

	function panelAvailable(panel: NotchPanel) {
		if (panel === "calendar") return settingsCalendarEnabled;
		return true;
	}

	// Wheel and swipe navigate panels, even from a collapsed live activity.
	// Music and shelf remain entry points through their activity affordances.
	const cycleBloomMode = (direction: 1 | -1) => {
		if (bloomMode === "announcement") return false;
		const panels = NOTCH_PANELS.filter(panelAvailable);
		const currentIndex = panels.indexOf(bloomMode as NotchPanel);
		const nextMode = currentIndex === -1
			? openingPanel()
			: panels[(currentIndex + direction + panels.length) % panels.length];
		setIsOpen(true);
		setBloomMode(nextMode);
		return true;
	};

	// Arrows and wheel both stay within panels once one is open.
	const cyclePanel = (direction: 1 | -1) => {
		const panels = NOTCH_PANELS.filter(panelAvailable);
		const index = panels.indexOf(bloomMode as NotchPanel);
		if (index === -1 || panels.length < 2) return;
		setBloomMode(panels[(index + direction + panels.length) % panels.length]);
	};

	// Timer state
	const [timerSeconds, setTimerSeconds] = useState(0);
	const [isTimerRunning, setIsTimerRunning] = useState(false);
	const [isTimerFinished, setIsTimerFinished] = useState(false);
	const [isEditingTimer, setIsEditingTimer] = useState(false);
	const [timerEditDigits, setTimerEditDigits] = useState("");
	const [lastDurationSeconds, setLastDurationSeconds] = useState(() => {
		const stored = parseInt(localStorage.getItem("bloom-timer-last-duration") || "", 10);
		return Number.isFinite(stored) && stored > 0 ? stored : 25 * 60;
	});
	const timerInputRef = useRef<HTMLInputElement>(null);
	const timerEditActiveRef = useRef(false);
	const timerIntervalRef = useRef<any>(null);
	const prevTimerFinishedRef = useRef(false);

	const formatTimerTime = (totalSeconds: number) => {
		const mins = Math.floor(Math.abs(totalSeconds) / 60);
		const secs = Math.abs(totalSeconds) % 60;
		return `${mins}:${secs.toString().padStart(2, "0")}`;
	};

	const startTimer = (seconds: number) => {
		// Unlock audio here (user gesture) so the completion chime can play later.
		getTimerChimeCtx();
		timerEditActiveRef.current = false;
		setIsEditingTimer(false);
		setTimerSeconds(seconds);
		setLastDurationSeconds(seconds);
		localStorage.setItem("bloom-timer-last-duration", String(seconds));
		setIsTimerRunning(true);
		setIsTimerFinished(false);
	};

	const resetTimer = () => {
		timerEditActiveRef.current = false;
		setIsEditingTimer(false);
		setIsTimerRunning(false);
		setTimerSeconds(0);
		setIsTimerFinished(false);
	};

	// Idle/finished play restarts the last duration; paused play resumes.
	const handlePrimaryTimerAction = () => {
		if (isEditingTimer) {
			commitTimerEdit(true);
		} else if (isTimerRunning) {
			setIsTimerRunning(false);
		} else if (timerSeconds > 0) {
			getTimerChimeCtx();
			setIsTimerRunning(true);
		} else {
			startTimer(lastDurationSeconds);
		}
	};

	// Clicking the big time turns it into a masked editor. Digits fill from the
	// right, so the colon never has to be typed.
	const beginTimerEdit = () => {
		if (isTimerRunning || isEditingTimer) return;
		if (isTimerFinished) resetTimer();
		const base = timerSeconds > 0 ? timerSeconds : lastDurationSeconds;
		setTimerEditDigits(timerSecondsToDigits(base));
		timerEditActiveRef.current = true;
		setIsEditingTimer(true);
	};

	const commitTimerEdit = (start: boolean) => {
		if (!timerEditActiveRef.current) return;
		timerEditActiveRef.current = false;
		setIsEditingTimer(false);
		const total = timerDigitsToSeconds(timerEditDigits);
		if (total === null) return;
		const base = timerSeconds > 0 ? timerSeconds : lastDurationSeconds;
		// A tap that changes nothing (e.g. paused timer) must not reset the state.
		if (!start && total === base) return;
		localStorage.setItem("bloom-timer-last-duration", String(total));
		setLastDurationSeconds(total);
		setTimerSeconds(start ? total : 0);
		setIsTimerRunning(start);
		setIsTimerFinished(false);
		if (start) getTimerChimeCtx();
	};

	useEffect(() => {
		if (isEditingTimer) {
			timerInputRef.current?.focus();
			timerInputRef.current?.select();
		}
	}, [isEditingTimer]);

	const timerEditValid = timerDigitsToSeconds(timerEditDigits) !== null;

	const timerState: "idle" | "running" | "paused" | "finished" = isEditingTimer
		? "idle"
		: isTimerFinished
			? "finished"
			: isTimerRunning
				? "running"
				: timerSeconds > 0
					? "paused"
					: "idle";
	const timerDisplaySeconds =
		timerSeconds > 0 || isTimerFinished ? timerSeconds : lastDurationSeconds;
	const primaryTimerLabel = isTimerRunning
		? "Pause"
		: timerSeconds > 0
			? "Resume"
			: isTimerFinished
				? "Restart"
				: "Start";
	const timerEndTime =
		timerSeconds > 0 && !isTimerFinished
			? new Date(Date.now() + timerSeconds * 1000).toLocaleTimeString([], {
					hour: "2-digit",
					minute: "2-digit",
					hour12: !timeFormat24h
				})
			: null;

	// Split the display time into individual flip-clock digits. Keys are counted
	// from the right so existing digits keep their identity when minutes grow
	// from two digits to three. While editing, the same clock renders the digits
	// being typed so the layout never changes.
	const clockText = isEditingTimer
		? formatTimerDigits(timerEditDigits)
		: formatTimerTime(timerDisplaySeconds);
	const [clockMinutesText, clockSecondsText] = clockText.split(":");
	const clockMinutesPadded = clockMinutesText.padStart(2, "0");
	const clockCompact = clockMinutesPadded.length > 2;
	const minuteDigitItems = clockMinutesPadded
		.split("")
		.map((digit, i, arr) => ({ digit, key: `m${arr.length - i}` }));
	const secondDigitItems = clockSecondsText
		.split("")
		.map((digit, i, arr) => ({ digit, key: `s${arr.length - i}` }));

	useEffect(() => {
		if (isTimerRunning && timerSeconds > 0) {
			timerIntervalRef.current = setInterval(() => {
				setTimerSeconds((s) => s - 1);
			}, 1000);
		} else if (isTimerRunning && timerSeconds === 0) {
			setIsTimerRunning(false);
			setIsTimerFinished(true);
		}
		return () => {
			if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
		};
	}, [isTimerRunning, timerSeconds === 0]);

	// Completion moment: chime once and reveal the notch in peek mode.
	useEffect(() => {
		if (isTimerFinished && !prevTimerFinishedRef.current) {
			if (settingsTimerSoundEnabled) playTimerChime();
			if (notchMode === "peek") triggerEventPeek(6000);
		}
		prevTimerFinishedRef.current = isTimerFinished;
	}, [isTimerFinished, settingsTimerSoundEnabled, notchMode, triggerEventPeek]);

	const lastTrackRef = useRef<string | null>(null);
	const lastPlayingRef = useRef<boolean>(false);
	const [musicActivityVisible, setMusicActivityVisible] = useState(false);

	// Keep a paused media session visible briefly so it can be resumed, then
	// clear its compact activity even if Windows retains the media session.
	useEffect(() => {
		if (!settingsMusicModeEnabled || !mediaInfo.has_media) {
			setMusicActivityVisible(false);
			return;
		}
		setMusicActivityVisible(true);
		if (isPlaying) return;
		const timeout = window.setTimeout(() => setMusicActivityVisible(false), 5000);
		return () => window.clearTimeout(timeout);
	}, [settingsMusicModeEnabled, mediaInfo.has_media, isPlaying]);

	// Like the Dynamic Island, the collapsed notch shows one live activity at a
	// time. Music fades a few seconds after playback stops. A set timer
	// (running, paused or just finished) takes the pill, and music then moves to
	// its own bubble beside it.
	const timerActive = timerSeconds > 0 || isTimerFinished;
	const musicActivity =
		settingsMusicModeEnabled && settingsMusicCompactNotch && mediaInfo.has_media && musicActivityVisible;
	const collapsedMode = musicActivity && !timerActive ? "music" : "status";
	const showMusicBubble = musicActivity && timerActive && !isOpen && isVisible && !isHidden;
	const showShelfBubble =
		shelfItems.length > 0 && !isOpen && isVisible && !isHidden && bloomMode !== "announcement";
	restingModeRef.current = collapsedMode;
	bloomModeRef.current = bloomMode;

	// A click opens the last-used panel when memory is enabled, otherwise the
	// selected default. The controls panel is always available as a fallback.
	const openingPanel = (): NotchPanel => {
		const preferred = rememberPanelEnabled ? lastPanel ?? defaultPanel : defaultPanel;
		return panelAvailable(preferred) ? preferred : "command-center";
	};

	// Expands the notch into a panel, or into an activity's own view.
	const openNotch = (view: NotchPanel | "music" | "shelf") => {
		if (bloomMode === "announcement") return;
		setIsOpen(true);
		setBloomMode(view);
	};

	const rememberPanel = (panel: NotchPanel) => {
		if (panel === lastPanel) return;
		setLastPanel(panel);
		localStorage.setItem("bloom-notch-last-panel", panel);
		invoke("save_setting", { key: "bloom-notch-last-panel", value: panel }).catch(console.error);
	};
	rememberPanelRef.current = rememberPanel;

	// Called by views that take typed input; see releaseNotchHover.
	const setNotchPinned = useCallback((pinned: boolean) => {
		notchPinnedRef.current = pinned;
		if (!pinned && releaseDeferredRef.current) {
			releaseDeferredRef.current = false;
			releaseNotchHover();
		}
		// releaseNotchHover only touches refs and state setters.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// In peek mode, briefly show the notch when a new track starts or playback
	// resumes. The notch itself never switches views for media; the collapsed
	// pill follows the live-activity rule below.
	useEffect(() => {
		const isNewTrackWhilePlaying = mediaInfo.title !== lastTrackRef.current && isPlaying;
		const justStartedPlaying = isPlaying && !lastPlayingRef.current;

		// Peek notch on media events (play start or track change)
		if (notchMode === "peek" && (isNewTrackWhilePlaying || justStartedPlaying)) {
			triggerEventPeek(3000);
		}

		lastTrackRef.current = mediaInfo.title;
		lastPlayingRef.current = isPlaying;
	}, [isPlaying, mediaInfo.title, notchMode, triggerEventPeek]);

	// Reset bloom mode when calendar setting is disabled
	useEffect(() => {
		if (!settingsCalendarEnabled && bloomMode === "calendar") {
			setBloomMode(isOpen ? openingPanel() : collapsedMode);
		}
	}, [settingsCalendarEnabled, bloomMode, isOpen]);

	// Leave the music view when music is turned off or the player ends its media
	// session: an open notch falls back to the remembered panel.
	useEffect(() => {
		if (bloomMode === "music" && !(settingsMusicModeEnabled && mediaInfo.has_media)) {
			setBloomMode(isOpen ? openingPanel() : collapsedMode);
		}
	}, [settingsMusicModeEnabled, mediaInfo.has_media, bloomMode, isOpen]);

	// The collapsed notch always shows its current live activity: music while a
	// session exists, the timer (with music in its bubble) once one is set, and
	// the clock otherwise. An open notch is left alone.
	useEffect(() => {
		if (isOpen || announcementOpenRef.current) return;
		if ((bloomMode === "status" || bloomMode === "music") && bloomMode !== collapsedMode) {
			setBloomMode(collapsedMode);
		}
	}, [collapsedMode, bloomMode, isOpen]);

	// Update time
	useEffect(() => {
		const updateTime = () => {
			const now = new Date();
			setTime(
				now.toLocaleTimeString([], {
					hour: "2-digit",
					minute: "2-digit",
					hour12: !timeFormat24h
				})
			);
		};

		updateTime();
		// Wake on each minute boundary instead of every second.
		let timer: ReturnType<typeof setTimeout>;
		const schedule = () => {
			timer = setTimeout(() => {
				updateTime();
				schedule();
			}, 60000 - (Date.now() % 60000) + 20);
		};
		schedule();
		const onVisible = () => !document.hidden && updateTime();
		document.addEventListener("visibilitychange", onVisible);
		return () => {
			clearTimeout(timer);
			document.removeEventListener("visibilitychange", onVisible);
		};
	}, [timeFormat24h]);

	// Battery API
	useEffect(() => {
		let battery: any = null;

		const initBattery = async () => {
			try {
				battery = await (navigator as any).getBattery();

				const updateBattery = () => {
					setBatteryLevel(Math.round(battery.level * 100));
					setIsCharging(battery.charging);
				};

				updateBattery();

				battery.addEventListener("levelchange", updateBattery);
				battery.addEventListener("chargingchange", updateBattery);

				return () => {
					battery.removeEventListener("levelchange", updateBattery);
					battery.removeEventListener("chargingchange", updateBattery);
				};
			} catch (e) {
				// Battery API not supported (macOS webview): the backend sends
				// battery-update events instead.
				if (has("battery")) {
					invoke<{ percent: number | null; charging: boolean; plugged_in: boolean }>("get_battery_details")
						.then((d) => {
							if (d.percent != null) setBatteryLevel(d.percent);
							setIsCharging(d.charging || d.plugged_in);
						})
						.catch(() => {});
					const un = listen<{ level: number; charging: boolean }>("battery-update", (ev) => {
						setBatteryLevel(Math.round(ev.payload.level));
						setIsCharging(ev.payload.charging);
					});
					return () => {
						un.then((f) => f());
					};
				}
			}
		};

		initBattery();
	}, []);

	// Listen for Volume Changes
	useEffect(() => {
		const unlisten = listen<{ volume: number; is_muted: boolean }>("volume-change", (event) => {
			setVolume(event.payload.volume);
			setIsMuted(event.payload.is_muted);
			if (getCurrentWebviewWindow().label === "main" && hudVolumeEnabled) {
				invoke("hide_native_osd").catch(() => {});
				showLevelHud("volume");
			}
		});
		return () => {
			unlisten.then((fn) => fn());
		};
	}, [hudVolumeEnabled, showLevelHud]);

	// Wi-Fi is a three-state control: Off, on-but-not-connected, Connected.
	// The radio state alone can't tell those apart, so get_wifi_status returns
	// both flags, plus the connected network's name. Returns false so the startup loader knows to retry.
	const refreshWifiStatus = useCallback(async (): Promise<boolean> => {
		try {
			setWifiStatus(await invoke<WifiStatus>("get_wifi_status"));
			return true;
		} catch {
			return false;
		}
	}, []);

	// Seed the Wi-Fi pill at startup. The first call can fail while the WLAN
	// service is still coming up, so retry instead of leaving the pill stuck on
	// its default.
	useEffect(() => {
		let cancelled = false;
		let retryTimer: ReturnType<typeof setTimeout> | undefined;
		const initializeWifiStatus = async (attempt: number) => {
			const loaded = await refreshWifiStatus();
			if (!loaded && !cancelled && attempt < 3) {
				retryTimer = setTimeout(() => void initializeWifiStatus(attempt + 1), (attempt + 1) * 1000);
			}
		};
		void initializeWifiStatus(0);
		return () => {
			cancelled = true;
			if (retryTimer) clearTimeout(retryTimer);
		};
	}, [refreshWifiStatus]);

	// Connected Bluetooth devices for the tile, refreshed whenever the backend
	// reports a device connecting, disconnecting, pairing or being removed.
	useEffect(() => {
		if (!bluetoothEnabled) {
			setBtConnectedNames([]);
			return;
		}
		const refresh = () =>
			invoke<{ name: string; connected: boolean }[]>("bluetooth_list_devices")
				.then((devices) =>
					setBtConnectedNames(devices.filter((d) => d.connected).map((d) => d.name))
				)
				.catch(() => {});
		let debounce: ReturnType<typeof setTimeout> | undefined;
		void refresh();
		const unlisten = listen("bluetooth-changed", () => {
			clearTimeout(debounce);
			debounce = setTimeout(() => void refresh(), 400);
		});
		return () => {
			clearTimeout(debounce);
			unlisten.then((f) => f());
		};
	}, [bluetoothEnabled]);

	// The backend reports connection changes and finished scans as they
	// happen, so the pill follows without waiting for the next poll.
	useEffect(() => {
		let debounce: ReturnType<typeof setTimeout> | undefined;
		const unlisten = listen("wifi-changed", () => {
			clearTimeout(debounce);
			debounce = setTimeout(() => void refreshWifiStatus(), 300);
		});
		return () => {
			clearTimeout(debounce);
			unlisten.then((f) => f());
		};
	}, [refreshWifiStatus]);

	// Load bluetooth/volume/brightness state on mount
	useEffect(() => {
		invoke<boolean>("get_bluetooth_state")
			.then(setBluetoothEnabled)
			.catch(() => {});
		invoke<boolean>("get_battery_saver_state")
			.then(setBatterySaverEnabled)
			.catch(() => {});
		invoke<{ volume: number; is_muted: boolean }>("get_volume_state")
			.then((state) => {
				setVolume(state.volume);
				setIsMuted(state.is_muted);
			})
			.catch(() => {});
		invoke<number>("get_brightness")
			.then(setCurrentBrightness)
			.catch(() => {});

	}, []);

	// Battery saver has no change event: read it only while it can be seen.
	const islandVisible = isOpen || isHovered;
	useEffect(() => {
		if (!islandVisible) return;
		const read = () =>
			invoke<boolean>("get_battery_saver_state")
				.then(setBatterySaverEnabled)
				.catch(() => {});
		read();
		const interval = setInterval(read, 5000);
		return () => clearInterval(interval);
	}, [islandVisible]);

	// Refresh Wi-Fi status while the command center is open so changes made
	// outside Bloom (keyboard toggle, Windows quick settings) show up.
	useEffect(() => {
		if (bloomMode !== "command-center") return;
		void refreshWifiStatus();
		const interval = setInterval(() => void refreshWifiStatus(), 5000);
		return () => clearInterval(interval);
	}, [bloomMode, refreshWifiStatus]);

	// Poll system metrics for status widgets
	useEffect(() => {
		const fetchMetrics = () => {
			invoke<number>("get_cpu_usage")
				.then(setCpuUsage)
				.catch((e) => console.warn("CPU:", e));
			invoke<number>("get_ram_usage")
				.then(setRamUsage)
				.catch((e) => console.warn("RAM:", e));
			invoke<number>("get_disk_space")
				.then(setDiskSpace)
				.catch((e) => console.warn("Disk:", e));
			invoke<[number, number]>("get_network_speed")
				.then(([up, down]) => {
					setNetUpSpeed(up);
					setNetDownSpeed(down);
				})
				.catch(() => {});
		};
		if (!islandVisible) return;
		fetchMetrics();
		const interval = setInterval(fetchMetrics, 2000);
		return () => clearInterval(interval);
	}, [islandVisible]);

	// Listen for brightness changes
	useEffect(() => {
		const unlisten = listen<{ brightness: number }>("brightness-change", (event) => {
			setCurrentBrightness(event.payload.brightness);
			if (getCurrentWebviewWindow().label === "main" && hudBrightnessEnabled) {
				invoke("hide_native_osd").catch(() => {});
				showLevelHud("brightness");
			}
		});
		return () => {
			unlisten.then((fn) => fn());
		};
	}, [hudBrightnessEnabled, showLevelHud]);

	// What the island shows: the system media session (GSMTC), or a browser
	// tab reported by the DynIs extension (it has the up-next list and real
	// next/previous). See chooseMedia in webMedia.ts.
	const systemMediaRef = useRef<MediaInfo | null>(null);
	const systemPlayingSinceRef = useRef(0);
	const browserMediaRef = useRef<WebMediaState | null>(null);
	const webPlayingSinceRef = useRef(0);
	const ignoreBrowserMediaRef = useRef(localStorage.getItem("bloom-media-ignore-browsers") === "true");
	const [browserMedia, setBrowserMedia] = useState<WebMediaState | null>(null);
	const webActiveRef = useRef(false);
	const [webActive, setWebActive] = useState(false);

	const applyMediaInfo = useCallback((info: MediaInfo) => {
			setMediaInfo((prev) => {
				// Find if artwork changed by checking the first element
				const prevArt = prev.artwork?.[0];
				const nextArt = info.artwork?.[0];
				const artChanged = prevArt !== nextArt;

				if (
					prev.title === info.title &&
					prev.artist === info.artist &&
					prev.is_playing === info.is_playing &&
					prev.has_media === info.has_media &&
					!artChanged &&
					prev.position_ms === info.position_ms &&
					prev.duration_ms === info.duration_ms &&
					prev.position_updated_at === info.position_updated_at &&
					prev.source_app === info.source_app
				) {
					return prev;
				}

				// Update playing state separately for the hook triggers
				setIsPlaying(info.is_playing);

				if (info.artwork && info.artwork.length > 0) {
					const newArt = info.artwork[0];
					setAlbumArtUrl((prev) => {
						if (prev !== newArt) {
							setAlbumArtKey((k) => k + 1);
							return newArt;
						}
						return prev;
					});
				} else {
					setAlbumArtUrl(null);
				}

				return info;
			});
	}, []);

	const reconcileMedia = useCallback(() => {
		const choice = chooseMedia(
			systemMediaRef.current,
			systemPlayingSinceRef.current,
			browserMediaRef.current,
			webPlayingSinceRef.current,
			ignoreBrowserMediaRef.current
		);
		const web = choice === "web" && browserMediaRef.current ? webToMediaInfo(browserMediaRef.current) : null;
		webActiveRef.current = !!web;
		setWebActive(!!web);
		const info = web ?? systemMediaRef.current;
		if (info) applyMediaInfo(info as MediaInfo);
	}, [applyMediaInfo]);

	useEffect(() => {
		const onWeb = (state: WebMediaState | null) => {
			const wasPlaying = !!browserMediaRef.current?.media?.playing;
			if (state?.media?.playing && !wasPlaying) webPlayingSinceRef.current = Date.now();
			browserMediaRef.current = state;
			setBrowserMedia(state);
			reconcileMedia();
		};
		const unlisten = listen<MediaInfo>("media-update", (event) => {
			const info = event.payload;
			if (!info) return;
			const prev = systemMediaRef.current;
			if (info.is_playing && !(prev?.is_playing && prev.title === info.title)) {
				systemPlayingSinceRef.current = Date.now();
			}
			systemMediaRef.current = info;
			reconcileMedia();
		});
		const unlistenWeb = listen<WebMediaState | null>("browser-media", (event) => onWeb(event.payload ?? null));
		// A tab may already be playing when the island starts.
		invoke<WebMediaState | null>("browser_media_state")
			.then((s) => s && onWeb(s))
			.catch(() => {});

		return () => {
			unlisten.then((fn) => fn());
			unlistenWeb.then((fn) => fn());
		};
	}, [reconcileMedia]);

	useSettingsSync({
		"bloom-media-ignore-browsers": (v) => {
			ignoreBrowserMediaRef.current = v === true || v === "true";
			reconcileMedia();
		}
	});

	// Media controls via Tauri commands
	/* Unused saveAndBroadcast removed to fix TS build error */
	const togglePlayPause = useCallback(async () => {
		try {
			if (webActiveRef.current) {
				await invoke("browser_media_command", { action: "toggle" });
				setIsPlaying(!isPlaying);
				return;
			}
			await invoke("media_play_pause");
			setIsPlaying(!isPlaying);
		} catch (e) {
			console.error("Failed to toggle play/pause:", e);
		}
	}, [isPlaying]);

	const skipNext = useCallback(async () => {
		try {
			if (webActiveRef.current) {
				await invoke("browser_media_command", { action: "next" });
				return;
			}
			await invoke("media_next");
		} catch (e) {
			console.error("Failed to skip next:", e);
		}
	}, []);

	const skipPrevious = useCallback(async () => {
		try {
			// The extension restarts the song when more than 3 s in.
			if (webActiveRef.current) {
				await invoke("browser_media_command", { action: "previous" });
				return;
			}
			await invoke("media_previous");
		} catch (e) {
			console.error("Failed to skip previous:", e);
		}
	}, []);

	// Slide-push animation for prev/next buttons
	const prevFront = useAnimation();
	const prevBack = useAnimation();
	const nextFront = useAnimation();
	const nextBack = useAnimation();

	const animatePrev = useCallback(async () => {
		prevFront.set({ x: 0 });
		prevBack.set({ x: 30 });
		prevFront.start({ x: -30, transition: { duration: 0.18, ease: [0.4, 0, 0.2, 1] } });
		await prevBack.start({ x: 0, transition: { duration: 0.18, ease: [0.4, 0, 0.2, 1] } });
		skipPrevious();
	}, [skipPrevious, prevFront, prevBack]);

	const animateNext = useCallback(async () => {
		nextFront.set({ x: 0 });
		nextBack.set({ x: -30 });
		nextFront.start({ x: 30, transition: { duration: 0.18, ease: [0.4, 0, 0.2, 1] } });
		await nextBack.start({ x: 0, transition: { duration: 0.18, ease: [0.4, 0, 0.2, 1] } });
		skipNext();
	}, [skipNext, nextFront, nextBack]);

	const sendVolume = useTrailingThrottle((newVol: number) => {
		invoke("set_volume", { volume: newVol }).catch(() => {});
	}, 50);

	const handleVolumeChange = useCallback(
		(newVol: number) => {
			setVolume(newVol);
			// set_volume unmutes for any non-zero level.
			setIsMuted(newVol === 0);
			sendVolume(newVol);
		},
		[sendVolume]
	);

	// WiFi toggle
	const toggleWifi = useCallback(async () => {
		const previous = wifiStatus;
		const newState = !(previous?.enabled ?? false);
		setWifiStatus({
			enabled: newState,
			connected: newState ? (previous?.connected ?? false) : false,
			ssid: newState ? (previous?.ssid ?? null) : null
		});
		try {
			await invoke("set_wifi_state", { enabled: newState });
			// The radio and association take a moment to settle.
			setTimeout(() => void refreshWifiStatus(), 800);
		} catch (e) {
			setWifiStatus(previous);
			console.error("Failed to toggle WiFi:", e);
		}
	}, [wifiStatus, refreshWifiStatus]);

	// Bluetooth toggle
	const toggleBluetooth = useCallback(async () => {
		const newState = !bluetoothEnabled;
		setBluetoothEnabled(newState);
		try {
			await invoke("set_bluetooth_state", { enabled: newState });
		} catch (e) {
			setBluetoothEnabled(!newState);
			console.error("Failed to toggle Bluetooth:", e);
		}
	}, [bluetoothEnabled]);

	// The notch never takes focus, and native `title` tooltips only show for an
	// active window, so the status widgets draw their own. A tooltip opens
	// after a tooltip-like delay, by which time the battery details fetched on
	// enter are in. Under the status strip it hangs below the pill; once the
	// notch is open the pill is the tall panel, so it sits beside the pill on
	// the widget's side instead, level with the widget.
	const showStatusTooltip = useCallback(
		(id: string, widget: HTMLElement) => {
			if (statusTooltipTimerRef.current) clearTimeout(statusTooltipTimerRef.current);
			statusTooltipTimerRef.current = setTimeout(() => {
				const pill = bloomRef.current?.getBoundingClientRect();
				const own = widget.getBoundingClientRect();
				// Client rects are zoomed by the notch scale; offsets are not.
				if (!pill) {
					setStatusTooltip({ id, side: "below", offset: 8 });
				} else if (!isOpen) {
					const gap = (pill.bottom - own.bottom) / scale;
					setStatusTooltip({ id, side: "below", offset: Math.max(0, gap) + 8 });
				} else if (own.left + own.width / 2 >= pill.left + pill.width / 2) {
					const gap = (pill.right - own.right) / scale;
					setStatusTooltip({ id, side: "right", offset: Math.max(0, gap) + 10 });
				} else {
					const gap = (own.left - pill.left) / scale;
					setStatusTooltip({ id, side: "left", offset: Math.max(0, gap) + 10 });
				}
			}, 400);
		},
		[scale, isOpen]
	);

	const hideStatusTooltip = useCallback(() => {
		if (statusTooltipTimerRef.current) clearTimeout(statusTooltipTimerRef.current);
		statusTooltipTimerRef.current = null;
		setStatusTooltip(null);
	}, []);

	// Widgets unmount when the notch collapses, without a mouse leave, and an
	// open card is placed for the notch's shape when it opened.
	useEffect(() => {
		hideStatusTooltip();
	}, [isHovered, isOpen, hideStatusTooltip]);

	// Both sides of the status strip get equal width around the centered
	// clock, so the notch must fit the clock plus twice the wider side. Widget
	// widths vary (network speed especially), so they are measured rather than
	// counted. The width only grows during a hover, so a live label getting
	// shorter doesn't make the notch jitter. Layout widths are unaffected by
	// the notch scale.
	useLayoutEffect(() => {
		if (!isHovered || bloomMode !== "status") {
			if (statusFitWidth !== 0) setStatusFitWidth(0);
			return;
		}
		// offsetWidth, not scrollWidth: an open tooltip card overflows its
		// widget and must not widen the notch.
		const side = Math.max(
			leftWidgetsRef.current?.offsetWidth ?? 0,
			rightWidgetsRef.current?.offsetWidth ?? 0
		);
		const clock = timeCenterRef.current?.offsetWidth ?? 0;
		// The pill's 12px padding on each side, and a 10px gap to the clock.
		const needed = Math.ceil(clock + 2 * (side + 10) + 24);
		if (side > 0 && needed > statusFitWidth) setStatusFitWidth(needed);
	});

	const refreshBatteryDetails = useCallback(() => {
		invoke<BatteryDetails>("get_battery_details")
			.then(setBatteryDetails)
			.catch((err) => console.error("Failed to read battery details:", err));
	}, []);

	// Battery Saver - opens settings (no public API to toggle without admin)
	const openBatterySaverSettings = useCallback(async () => {
		try {
			await invoke("open_battery_saver_settings");
		} catch (e) {
			console.error("Failed to open Battery Saver settings:", e);
		}
	}, []);

	// Brightness change with throttling
	const sendBrightness = useTrailingThrottle((newVal: number) => {
		invoke("set_brightness", { brightness: newVal }).catch(() => {});
	}, 50);

	const handleBrightnessChange = useCallback(
		(newVal: number) => {
			setCurrentBrightness(newVal);
			sendBrightness(newVal);
		},
		[sendBrightness]
	);

	// Open system tray (unhide taskbar and invoke Win+B)
	const openSystemTray = useCallback(async (e: React.MouseEvent) => {
		e.stopPropagation();
		try {
			await invoke("open_system_tray");
		} catch (e) {
			console.error("Failed to open system tray:", e);
		}
	}, []);

	const openSettingsWindow = useCallback(async () => {
		try {
			await invoke("open_settings_window");
		} catch (e) {
			console.error("Failed to open settings window:", e);
		}
	}, []);

	// Right-click opens the tile's own view, the same as its › button.
	const handleWifiRightClick = useCallback((e: React.MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();
		setBloomMode("wifi");
	}, []);

	const toggleDockModeSetting = useCallback(
		async (e: React.MouseEvent) => {
			e.stopPropagation();
			const nextMode = dockMode === "fixed" ? "smart" : dockMode === "smart" ? "peek" : "fixed";
			setDockMode(nextMode);
			localStorage.setItem("bloom-dock-mode", nextMode);
			invoke("save_setting", { key: "bloom-dock-mode", value: nextMode }).catch(console.error);
			try {
				await invoke("change_dock_mode", { mode: nextMode });
			} catch (err) {
				console.error("Failed to change dock mode:", err);
			}
		},
		[dockMode]
	);

	const toggleNotchModeSetting = useCallback(
		async (e: React.MouseEvent) => {
			e.stopPropagation();
			const order = ["smart", "overlay", "peek", "fixed"];
			const nextMode = order[(order.indexOf(notchMode) + 1) % order.length];
			setNotchMode(nextMode);
			localStorage.setItem(SETTING_KEYS.notchMode, nextMode);
			invoke("save_setting", { key: SETTING_KEYS.notchModeChosen, value: "true" }).catch(console.error);
			invoke("save_setting", { key: SETTING_KEYS.notchMode, value: nextMode }).catch(console.error);
			try {
				await invoke("change_notch_mode", { mode: nextMode });
			} catch (err) {
				console.error("Failed to change notch mode:", err);
			}
		},
		[notchMode]
	);

	const handleBluetoothRightClick = useCallback((e: React.MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();
		setBloomMode("bluetooth");
	}, []);

	const toggleCalendarMode = (e: React.MouseEvent) => {
		e.stopPropagation();
		if (isTimerFinished) {
			resetTimer();
			return;
		}
		// The time is part of the notch: a click opens it like anywhere else.
		// Once open, it is a shortcut to the calendar.
		if (!isOpen) {
			openNotch(openingPanel());
		} else if (settingsCalendarEnabled) {
			setBloomMode("calendar");
		}
	};

	// Where a status tooltip card sits and how it slides in, by placement.
	const statusTooltipMotion = (side: "below" | "left" | "right", offset: number) => {
		if (side === "below") {
			return {
				style: { top: `calc(100% + ${offset}px)`, left: "50%" },
				hidden: { opacity: 0, x: "-50%", y: -4 },
				shown: { opacity: 1, x: "-50%", y: 0 }
			};
		}
		// Top-aligned with the widget rather than centered on it: the widgets
		// sit near the top of the screen, which would cut a centered card off.
		const nudge = side === "right" ? -4 : 4;
		return {
			// On a bottom island the card grows upward from the pill instead.
			style: {
				[notchEdge === "bottom" ? "bottom" : "top"]: -8,
				[side === "right" ? "left" : "right"]: `calc(100% + ${offset}px)`
			},
			hidden: { opacity: 0, x: nudge, y: 0 },
			shown: { opacity: 1, x: 0, y: 0 }
		};
	};

	// A status widget with its tooltip card, which hangs outside the pill.
	const statusWidget = (
		id: string,
		tooltip: string,
		content: React.ReactNode,
		onEnter?: () => void
	) => (
		<div
			className="passive-feature"
			key={id}
			onMouseEnter={(e) => {
				onEnter?.();
				showStatusTooltip(id, e.currentTarget);
			}}
			onMouseLeave={hideStatusTooltip}
		>
			{content}
			<AnimatePresence>
				{statusTooltip?.id === id &&
					(() => {
						const placed = statusTooltipMotion(statusTooltip.side, statusTooltip.offset);
						return (
							<motion.div
								className="status-tooltip"
								style={placed.style}
								initial={placed.hidden}
								animate={placed.shown}
								exit={placed.hidden}
								transition={{ duration: 0.15 }}
							>
								{tooltip}
							</motion.div>
						);
					})()}
			</AnimatePresence>
		</div>
	);

	// Render a status widget by ID
	const renderStatusWidget = (id: string) => {
		switch (id) {
			case "weather":
				if (!settingsWeatherEnabled || temperature === null) return null;
				return statusWidget(
					"weather",
					cityName ? `${weatherCondition} — ${cityName}` : weatherCondition,
					<>
						<WeatherIcon size={12} strokeWidth={2.2} />
						<span className="label">
							{temperature}°{tempUnit === "fahrenheit" ? "F" : "C"}
						</span>
					</>
				);
			case "battery":
				return statusWidget(
					"battery",
					batteryTooltip(
						batteryDetails,
						{ level: batteryLevel, charging: isCharging },
						batterySaverEnabled
					),
					<>
						{/* Only in the collapsed pill: the open header has no room (it
						    would push into the time's arrows); open views list it anyway. */}
						{headsetInPill && !isOpen && (
							<span
								className={`pill-headset sig-${headsetInPill.signal ?? "none"}`}
								title={`${headsetInPill.title}${headsetInPill.value ? ` · ${headsetInPill.value}` : ""}`}
								aria-label={`${headsetInPill.title}${headsetInPill.value ? `, battery ${headsetInPill.value}` : ""}`}
							>
								<HeadphonesIcon size={13} />
								{headsetInPill.value && <span className="label">{headsetInPill.value}</span>}
							</span>
						)}
						<BatteryIcon
							charging={isCharging}
							level={batteryLevel}
							threshold={lowBatteryThreshold}
						/>
						<span className="label">{batteryLevel}%</span>
					</>,
					refreshBatteryDetails
				);
			case "cpu":
				return statusWidget(
					"cpu",
					"CPU Usage",
					<>
						<Cpu size={12} strokeWidth={2} />
						<span className="label">{cpuUsage}%</span>
					</>
				);
			case "ram":
				return statusWidget(
					"ram",
					"RAM Usage",
					<>
						<MemoryStick size={12} strokeWidth={2} />
						<span className="label">{Math.round(ramUsage)}%</span>
					</>
				);
			case "disk":
				return statusWidget(
					"disk",
					"Free Disk Space",
					<>
						<HardDrive size={12} strokeWidth={2} />
						<span className="label">{diskSpace}GB</span>
					</>
				);
			case "net":
				return statusWidget(
					"net",
					"Network Speed",
					<>
						<ArrowUpDown size={12} strokeWidth={2} />
						<span className="label">
							↑{formatBytes(netUpSpeed)} ↓{formatBytes(netDownSpeed)}
						</span>
					</>
				);
			default:
				return null;
		}
	};

	const formatBytes = (bytes: number) => {
		if (bytes < 1024) return `${bytes}B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
		return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
	};

	// Music mode shows any time we have media info (playing or paused) and music mode setting is enabled
	const isMusicMode = mediaInfo.has_media && bloomMode === "music" && settingsMusicModeEnabled;
	// A media session remains reachable on hover after its activity fades, or
	// whenever the compact music display is disabled.
	const showMusicOnStatusHover =
		!isOpen && isHovered && bloomMode === "status" && settingsMusicModeEnabled &&
		mediaInfo.has_media && (!musicActivityVisible || !settingsMusicCompactNotch);
	const showCompactMusicIcons = isMusicMode || showMusicOnStatusHover;

	// The 24-hour clock is ~16px narrower than the 12-hour one.
	const clock24hTrim = timeFormat24h ? 16 : 0;

	// Calculate width dynamically based on enabled features
	function systemAction(action: string) {
		invoke("open_system_action", { action }).catch(() => {});
	}
	const toggleKeepAwake = () => {
		invoke<boolean>("set_keep_awake", { on: !keepAwake })
			.then(setKeepAwake)
			.catch(() => {});
	};
	const snap = (layout: string) =>
		invoke("snap_window", { layout }).catch((e) =>
			liftActivity({ id: "snap-error", kind: "notice", priority: 5, signal: "alert", icon: "bell", title: String(e) })
		);
	const closeSearch = () => {
		setNotchPinned(false);
		invoke("restore_foreground").catch(() => {});
		releaseNotchHover();
	};
	const searchActions: SearchAction[] = [
		{ id: "timer-5", label: "Start a 5 minute timer", keywords: "timer focus", icon: <Timer size={15} />, run: () => startTimer(5 * 60) },
		{ id: "timer-25", label: "Start a focus timer (25 min)", keywords: "timer pomodoro focus", icon: <Timer size={15} />, run: () => startTimer(25 * 60) },
		{ id: "keep-awake", label: keepAwake ? "Turn off Keep Awake" : "Keep PC awake", keywords: "caffeine sleep awake coffee", icon: <Coffee size={15} />, run: toggleKeepAwake },
		{ id: "focus", label: dndActive ? "Turn off Focus" : "Turn on Focus", keywords: "dnd do not disturb", icon: <MoonIcon />, run: () => setDndActive((v) => !v) },
		{ id: "wifi", label: wifiEnabled ? "Turn off Wi-Fi" : "Turn on Wi-Fi", keywords: "wifi network", icon: <WifiIcon enabled={wifiEnabled} connected={wifiConnected} />, run: toggleWifi },
		{ id: "bluetooth", label: bluetoothEnabled ? "Turn off Bluetooth" : "Turn on Bluetooth", keywords: "bluetooth headphones", icon: <BluetoothIcon />, run: toggleBluetooth },
		{ id: "snap-left", label: "Snap window left", keywords: "snap window half", icon: <PanelLeft size={15} />, hint: "Win+Left", run: () => snap("left") },
		{ id: "snap-right", label: "Snap window right", keywords: "snap window half", icon: <PanelRight size={15} />, hint: "Win+Right", run: () => snap("right") },
		{ id: "snap-center", label: "Center window", keywords: "snap window middle", icon: <CenterIcon size={15} />, run: () => snap("center") },
		{ id: "snap-full", label: "Maximize window", keywords: "snap window full", icon: <Maximize size={15} />, hint: "Win+Up", run: () => snap("full") },
		{ id: "home", label: "Open Home", keywords: "music calendar todo", icon: <HomeIcon size={15} />, run: () => setTimeout(() => openNotch("home"), 50) },
		{ id: "screenshot", label: "Take a screenshot", keywords: "snip capture", icon: <Scissors size={15} />, hint: "Win+Shift+S", run: () => systemAction("snipping-tool") },
		{ id: "settings", label: "Open DynIs Settings", keywords: "preferences", icon: <SettingsIcon />, run: openSettingsWindow }
	];

	// Every control the Command Center can show (see CommandCenterGrid).
	const noEvent = { stopPropagation() {} } as React.MouseEvent;

	const ccControlsAll: Record<string, CcControl> = {
		wifi: {
			label: "Wi-Fi",
			icon: <WifiIcon enabled={wifiEnabled} connected={wifiConnected} />,
			status:
				wifiStatus === null
					? "…"
					: !wifiEnabled
						? "Off"
						: wifiConnected
							? (wifiStatus?.ssid ?? "Connected")
							: "Not connected",
			active: wifiEnabled,
			signal: "connect",
			sizes: ["large", "small"],
			onClick: toggleWifi,
			onMore: () => setBloomMode("wifi"),
			onContextMenu: handleWifiRightClick
		},
		bluetooth: {
			label: "Bluetooth",
			icon: <BluetoothIcon />,
			status: !bluetoothEnabled
				? "Off"
				: btConnectedNames.length === 1
					? btConnectedNames[0]
					: btConnectedNames.length > 1
						? `${btConnectedNames.length} connected`
						: "On",
			active: bluetoothEnabled,
			signal: "connect",
			sizes: ["large", "small"],
			onClick: toggleBluetooth,
			onMore: () => setBloomMode("bluetooth"),
			onContextMenu: handleBluetoothRightClick
		},
		"dock-mode": {
			label: "Dock Mode",
			icon: <DockIcon />,
			status: dockMode === "fixed" ? "Fixed" : dockMode === "smart" ? "Smart" : "Peek",
			active: dockMode === "fixed",
			sizes: ["large", "small"],
			onClick: () => toggleDockModeSetting(noEvent)
		},
		"notch-mode": {
			label: "Notch Mode",
			icon: <NotchIcon />,
			status:
				notchMode === "fixed"
					? "Reserve Space"
					: notchMode === "overlay"
						? "Overlay"
						: notchMode === "smart"
							? "Smart"
							: "Peek",
			active: notchMode === "fixed" || notchMode === "overlay",
			sizes: ["large", "small"],
			onClick: () => toggleNotchModeSetting(noEvent)
		},
		"island-style": {
			label: "Island Style",
			icon: <Sparkles size={15} />,
			status: isPill ? "Capsule" : "Classic",
			sizes: ["large", "small"],
			onClick: () => {
				const next = isPill ? "notch" : "pill";
				setIslandStyle(next);
				localStorage.setItem("bloom-island-style", next);
				invoke("save_setting", { key: "bloom-island-style", value: next }).catch(() => {});
			}
		},
		focus: {
			label: "Focus",
			icon: <MoonIcon />,
			status: dndActive ? "On" : "Off",
			active: dndActive,
			signal: "focus",
			sizes: ["small", "large"],
			onClick: () => setDndActive((prev) => !prev)
		},
		"battery-saver": {
			label: "Energy Saver",
			icon: <BatterySaverIcon />,
			status: batterySaverEnabled ? "On" : "Off",
			active: batterySaverEnabled,
			sizes: ["small", "large"],
			onClick: openBatterySaverSettings
		},
		airplane: {
			label: "Airplane Mode",
			icon: <Plane size={15} />,
			status: "Settings",
			sizes: ["small", "large"],
			onClick: () => invoke("open_airplane_mode_settings").catch(() => {})
		},
		"night-light": {
			label: "Night Light",
			icon: <SunMoon size={15} />,
			status: "Settings",
			sizes: ["small", "large"],
			onClick: () => systemAction("night-light")
		},
		tray: {
			label: "System Tray",
			icon: <TrayIcon />,
			sizes: ["small", "large"],
			onClick: () => openSystemTray(noEvent)
		},
		notifications: {
			label: "Notifications",
			icon: <BellIcon />,
			sizes: ["small", "large"],
			onClick: () => invoke("open_notification_center").catch(() => {})
		},
		settings: {
			label: "DynIs Settings",
			icon: <SettingsIcon />,
			sizes: ["small", "large"],
			onClick: openSettingsWindow
		},
		restart: {
			label: "Restart DynIs",
			icon: <ReloadIcon />,
			sizes: ["small", "large"],
			onClick: () => invoke("restart_bloom").catch(() => {})
		},
		"now-playing": {
			label: "Now Playing",
			icon: <Music size={15} />,
			status: mediaInfo.has_media ? mediaInfo.title || "Playing" : "Not Playing",
			active: mediaInfo.has_media && isPlaying,
			sizes: ["large", "small"],
			onClick: () => {
				if (mediaInfo.has_media) openNotch("music");
			},
			xl: (
				<>
					<div className="cc-np-top">
						<div className="cc-np-art">
							{albumArtUrl && mediaInfo.has_media ? (
								<img src={albumArtUrl} alt="" draggable={false} />
							) : (
								<Music size={16} />
							)}
						</div>
						<span className="cc-tile-text">
							<span className="cc-tile-title">{mediaInfo.has_media ? mediaInfo.title : "Not Playing"}</span>
							{mediaInfo.has_media && <span className="cc-tile-status">{mediaInfo.artist}</span>}
						</span>
					</div>
					<div className="cc-np-controls">
						<button type="button" className="cc-np-btn" aria-label="Previous track" title="Previous" onClick={(e) => { e.stopPropagation(); skipPrevious(); }}>
							<SkipBackIcon size={16} />
						</button>
						<button type="button" className="cc-np-btn" aria-label={isPlaying ? "Pause" : "Play"} title={isPlaying ? "Pause" : "Play"} onClick={(e) => { e.stopPropagation(); togglePlayPause(); }}>
							{isPlaying ? <PauseIcon size={18} /> : <PlayIcon size={18} />}
						</button>
						<button type="button" className="cc-np-btn" aria-label="Next track" title="Next" onClick={(e) => { e.stopPropagation(); skipNext(); }}>
							<SkipForwardIcon size={16} />
						</button>
					</div>
				</>
			)
		},
		timer: {
			label: "Timer",
			icon: <Timer size={15} />,
			sizes: ["small", "large"],
			onClick: () => openNotch("calendar")
		},
		screenshot: {
			label: "Screenshot",
			icon: <Scissors size={15} />,
			sizes: ["small", "large"],
			onClick: () => systemAction("snipping-tool")
		},
		calculator: {
			label: "Calculator",
			icon: <Calculator size={15} />,
			sizes: ["small", "large"],
			onClick: () => systemAction("calculator")
		},
		"file-explorer": {
			label: "File Explorer",
			icon: <Folder size={15} />,
			sizes: ["small", "large"],
			onClick: () => systemAction("file-explorer")
		},
		"keep-awake": {
			label: "Keep Awake",
			icon: <Coffee size={15} />,
			status: keepAwake ? "On" : "Off",
			active: keepAwake,
			sizes: ["small", "large"],
			onClick: toggleKeepAwake
		},
		"snap-window": {
			label: "Snap Window",
			icon: <Columns2 size={15} />,
			sizes: ["large", "small"],
			onClick: () => snap("left"),
			xl: (
				<>
					<span className="cc-tile-title">Snap Window</span>
					<div className="cc-snap-grid">
						{[
							["left", "Left", <PanelLeft key="l" size={15} />],
							["center", "Center", <CenterIcon key="c" size={15} />],
							["full", "Full", <Maximize key="f" size={15} />],
							["right", "Right", <PanelRight key="r" size={15} />]
						].map(([layout, label, icon]) => (
							<button
								key={layout as string}
								type="button"
								className="cc-snap-btn"
								aria-label={`Snap window ${label}`}
								title={`Snap the active window: ${label}`}
								onClick={(e) => {
									e.stopPropagation();
									snap(layout as string);
								}}
							>
								{icon}
								<span>{label}</span>
							</button>
						))}
					</div>
				</>
			)
		},
		"task-manager": {
			label: "Task Manager",
			icon: <ListChecks size={15} />,
			sizes: ["small", "large"],
			onClick: () => systemAction("task-manager")
		},
		volume: {
			label: "Sound",
			icon: <VolumeLowIcon />,
			sizes: ["large"],
			slider: {
				value: displayVolume,
				max: 1,
				step: 0.01,
				onChange: handleVolumeChange,
				display: `${Math.round(displayVolume * 100)}%`,
				extra: {
					icon: <HeadphonesIcon size={14} />,
					label: "Choose audio output",
					onClick: () => invoke("open_audio_output_picker").catch(() => {})
				}
			}
		},
		brightness: {
			label: "Brightness",
			icon: <BrightnessLowIcon />,
			sizes: ["large"],
			slider: {
				value: currentBrightness,
				max: 100,
				step: 1,
				onChange: handleBrightnessChange,
				display: `${currentBrightness}%`
			}
		}
	};
	// macOS: only the controls it can run (see platform.ts).
	const ccControls: Record<string, CcControl> = Object.fromEntries(
		Object.entries(ccControlsAll).filter(([kind]) => ccKindSupported(kind))
	);

	// The level capsule takes over the collapsed island while a level changes.
	const showLevelCapsule = levelHud !== null && !isOpen && !isHovered;
	const showEngineActivity =
		!showLevelCapsule && !isOpen && !isHovered && isVisible && presentation.lifting && showsInIsland(presentation);
	const allActivities: Activity[] = [presentation.main, presentation.bubble, ...presentation.rest].filter(
		(a): a is Activity => !!a
	);

	// ── Bubble row ──
	interface Bubble {
		id: string;
		label: string;
		signal?: string | null;
		progress?: number | null;
		spinner?: boolean;
		content: React.ReactNode;
		onClick: () => void;
	}
	// Bubbles merge into the pill while it's hovered (it grows over their spot);
	// otherwise the pill and a bubble would chase the cursor back and forth.
	const bubblesAllowed = !isOpen && !isHovered && isVisible && !isHidden && bloomMode !== "announcement";
	const activityBubbles: Bubble[] = [];
	if (bubblesAllowed && showMusicBubble) {
		activityBubbles.push({
			id: "music",
			label: mediaInfo.title ? `Music: ${mediaInfo.title}` : "Music",
			signal: "music",
			content:
				settingsAlbumArtEnabled && albumArtUrl ? (
					<img
						src={albumArtUrl}
						alt=""
						draggable={false}
						className={isPlaying && !reduceMotion ? "album-art-spin-playing" : ""}
					/>
				) : (
					<Music size={14} strokeWidth={2.2} />
				),
			onClick: () => {
				setIsHovered(true);
				openNotch("music");
			}
		});
	}
	if (bubblesAllowed && showShelfBubble) {
		activityBubbles.push({
			id: "shelf",
			label: `Shelf: ${shelfItems.length} item${shelfItems.length === 1 ? "" : "s"}`,
			content: (
				<span className="bubble-count">
					<Inbox size={12} strokeWidth={2.4} />
					{shelfItems.length}
				</span>
			),
			onClick: () => {
				setIsHovered(true);
				openNotch("shelf");
			}
		});
	}
	for (const a of allActivities) {
		if (!bubblesAllowed || !showsAsBubble(a)) continue;
		// The lift currently in the pill isn't also a bubble.
		if (showEngineActivity && presentation.main?.id === a.id) continue;
		activityBubbles.push({
			id: a.id,
			label: `${a.title}${a.value ? ` · ${a.value}` : ""}`,
			signal: a.signal,
			progress: a.progress,
			spinner: a.kind === "download" && a.progress == null,
			content: <ActivityIcon icon={a.icon} size={13} />,
			onClick: () => handleActivityClick(a)
		});
	}
	// Arrival order: first seen stays first.
	const nowTs = Date.now();
	const seenMap = bubbleFirstSeen.current;
	for (const b of activityBubbles) if (!seenMap.has(b.id)) seenMap.set(b.id, nowTs);
	for (const id of Array.from(seenMap.keys())) {
		if (!activityBubbles.some((b) => b.id === id)) seenMap.delete(id);
	}
	activityBubbles.sort((x, y) => (seenMap.get(x.id) ?? 0) - (seenMap.get(y.id) ?? 0));
	const MAX_ACTIVITY_BUBBLES = 2;
	const overflow = activityBubbles.length - MAX_ACTIVITY_BUBBLES;
	const visibleBubbles: Bubble[] = activityBubbles.slice(0, MAX_ACTIVITY_BUBBLES);
	if (overflow > 0) {
		visibleBubbles.push({
			id: "overflow",
			label: `${overflow} more`,
			content: <span className="bubble-count">+{overflow}</span>,
			onClick: () => openNotch("home")
		});
	}
	// Bubbles are circles as tall as the collapsed pill, 8px apart.
	const bubbleSize = islandHeight;
	const bubbleShift = visibleBubbles.length > 0 ? -(visibleBubbles.length * (bubbleSize + 8)) / 2 : 0;
	const keepCopy = (id: string) => {
		const copy = recentCopies.find((c) => c.id === id);
		if (!copy) return;
		if (copy.files.length > 0) addShelfItems(copy.files);
		else if (copy.text) addShelfText(copy.text);
		setRecentCopies((prev) => prev.filter((c) => c.id !== id));
		endActivity("clipboard");
		liftActivity({ id: "clipboard-kept", kind: "clipboard", priority: 4, signal: "positive", icon: "clipboard", title: "Kept on the shelf", value: `${shelfItems.length + 1}`, action: "panel:shelf" });
	};
	const handleActivityClick = (a: Activity) => {
		if (a.action?.startsWith("keep:")) {
			keepCopy(a.action.slice(5));
			return;
		}
		const panel = runActivityAction(a.action);
		if (panel === "bluetooth" || panel === "wifi") {
			openNotch("command-center");
			setBloomMode(panel);
		} else if (panel === "music" || panel === "shelf" || panel === "home" || panel === "calendar") {
			openNotch(panel);
		}
	};
	const levelPercent =
		levelHud === "brightness"
			? Math.round(currentBrightness)
			: isMuted
				? 0
				: Math.round(volume * 100);

	// A connected headset sits inside the pill, next to the PC battery.
	const headsetInPill = [presentation.main, presentation.bubble, ...presentation.rest].find(
		(a): a is Activity => !!a && a.kind === "headphones-status"
	);
	const headsetWidth = headsetInPill && !isOpen ? (headsetInPill.value ? 50 : 22) : 0;

	const getDynamicWidth = () => {
		if (bloomMode === "announcement" && announcement && !announcementDismissed) return 380;
		if (showLevelCapsule) return 300;
		if (showEngineActivity) return isPill ? 300 : 340;
		if (bloomMode === "home" && isOpen) return 640;
		if (bloomMode === "search" && isOpen) return 440;
		if (isCalendarMode) return 480;
		if (bloomMode === "shelf") return 380;
		if (bloomMode === "command-center" && isOpen) return 350;
		if (bloomMode === "wifi" || bloomMode === "bluetooth") return 350;
		if (showMusicOnStatusHover) {
			return 170 + (settingsVisualizerEnabled ? 30 : 0);
		}
		if (bloomMode === "status" && isHovered) {
			const totalWidgets = statusWidgets.left.length + statusWidgets.right.length;
			return Math.max(Math.min(200 + totalWidgets * 50, 380) - clock24hTrim + headsetWidth, statusFitWidth);
		}
		if (isMusicMode && isOpen) return mediaLayout === "compact" ? 300 : 340;
		if ((showPowerPulse || showLowBatteryPulse) && !isHovered) return 200;

		let w = (isPill ? 120 : 140) - clock24hTrim + headsetWidth;
		if (isMusicMode) {
			if (settingsVisualizerEnabled && isPlaying) w += 30;
			if (settingsAlbumArtEnabled) w += 30;
		}

		return w;
	};

	const getDynamicHeight = () => {
		if (!isExpanded || !isVisible || isHidden) {
			return isImpacted ? 28.9 : 44.2;
		}
		// Announcement card: body is line-clamped, so a fixed size fits both cases.
		if (bloomMode === "announcement" && announcement && !announcementDismissed) {
			return announcement.url ? 168 : 148;
		}
		// Sized to the calendar's week-row count plus the timer's fixed content.
		if (bloomMode === "calendar") return calendarMonthRows >= 6 ? 305 : 273;
		// Shelf expands on mode alone (no hover needed: there is no cursor
		// hover during an OS drag) and is sized to exactly one row of tiles,
		// plus room for the scrollbar once the tiles overflow it.
		if (bloomMode === "shelf") {
			if (shelfItems.length === 0) return 130;
			return shelfOverflowing ? 190 : 176;
		}
		if (bloomMode === "command-center") return isOpen ? Math.min(ccHeight + 36 + 24, 400) : islandHeight;
		if (bloomMode === "home") return isOpen ? (spotifyQueue && spotifyQueue.next.length > 0 ? 330 : 300) + (spotifyOn && isSpotifyActive(spotifyQueue, mediaInfo.title) ? 34 : 0) : islandHeight;
		if (bloomMode === "search") return isOpen ? 300 : islandHeight;
		if (bloomMode === "wifi" || bloomMode === "bluetooth") return 300;
		if (bloomMode === "status") return islandHeight;
		if (isMusicMode && isOpen) {
			const hasProgressBar = (mediaInfo.duration_ms ?? 0) > 0;
			let h = mediaLayout === "compact" ? (hasProgressBar ? 132 : 116) : isPill ? 140 : 120;
			if (mediaLayout === "compact") {
				if (compactVolumeExpanded) h += 36;
			}
			return h;
		}
		return islandHeight;
	};

	const isCalendarMode = bloomMode === "calendar";
	// Arrows switch between the two tool panels; wheel/swipe can also open one
	// directly from the collapsed pill or a live activity.
	const showPanelArrows =
		isOpen && asNotchPanel(bloomMode) !== null && NOTCH_PANELS.filter(panelAvailable).length > 1;

	// Close compact media player expansions when notch is unhovered or mode changes
	useEffect(() => {
		if (mediaLayout === "compact") {
			setCompactVolumeExpanded(false);
		}
	}, [isHovered, mediaLayout, bloomMode]);

	// The pill's target geometry: the animation springs toward it, and the
	// window region below is cut from it, so the region is already at the
	// final size while the pill animates.
	// How far the pill sits inside the screen from its edge: negative retracts
	// it into the edge it hangs from (hidden), positive is the startup drop-in.
	// At rest the capsule floats ISLAND_GAP px off its edge, like a dynamic
	// island, instead of merging into it.
	// On a notched Mac the capsule floats just below the camera housing.
	const macNotchDrop = isPill && macDisplay?.has_notch && notchEdge !== "bottom" ? Math.round(macDisplay.top_inset) : 0;
	const pillInset = !isReady ? 250 : isVisible ? (isHidden ? -100 : isPill ? ISLAND_GAP + macNotchDrop : 0) : -150;
	const baseWidth = !isReady
		? 34
		: isExpanded && isVisible && !isHidden
			? getDynamicWidth()
			: isImpacted
				? 39.1
				: 30.6;
	const baseHeight = !isReady ? 34 : getDynamicHeight();
	// Never narrower than the notch plus room on both sides for its content.
	const pillTargetWidth = wrapsNotch && isReady ? Math.max(baseWidth, macDisplay!.notch_width + 120) : baseWidth;
	const pillTargetHeight = baseHeight;
	const pillOffset = edgeOffset(notchEdge, pillInset);
	// One continuous shape: a true capsule (radius = half the height) when
	// collapsed, large smooth radii when expanded.
	glassActiveRef.current = isOpen || isHovered;
	// Collapsed: a true capsule. Open: a rounded rectangle (never a stadium).
	const pillRadius = isOpen || isCalendarMode ? 30 : Math.min(pillTargetHeight, pillTargetWidth) / 2;
	// Classic notch: square corners against the edge (flares bridge them),
	// rounded corners away from it.
	const pillRadii = isPill
		? cornerRadii(notchEdge, pillRadius, pillRadius)
		: cornerRadii(notchEdge, isImpacted ? 0 : 18, isCalendarMode ? 28 : 18);
	// Hover lift: a little swell toward the screen (not while open).
	const pillLift = isHovered && !isOpen && isVisible && !isHidden && !reduceMotion ? 1.03 : 1;
	// Shadow and the edge flares beside the pill.
	pillTargetRef.current = notchPillBox(
		notchEdge,
		viewport.width,
		viewport.height,
		scale,
		pillInset,
		pillTargetWidth,
		pillTargetHeight,
		24,
		bubbleShift
	);
	pillHitRef.current = notchPillBox(
		notchEdge,
		viewport.width,
		viewport.height,
		scale,
		pillInset,
		pillTargetWidth,
		pillTargetHeight,
		0,
		bubbleShift
	);

	useEffect(() => {
		if (bloomMode !== "command-center" || !isOpen) setCcEditing(false);
	}, [bloomMode, isOpen]);

	// Live blur: the backend sends the (excluded-from-capture) screen area
	// behind the island; draw it, cropping the context margin it adds.
	useEffect(() => {
		if (windowLabel !== "main" || islandMaterial !== "glass-live" || !isPill) return;
		const staging = document.createElement("canvas");
		const stagingCtx = staging.getContext("2d");
		let stopped = false;
		let timer: ReturnType<typeof setTimeout> | null = null;
		const pull = async () => {
			if (stopped) return;
			let delay = 250;
			try {
				const buf = await invoke<ArrayBuffer>("glass_capture");
				const canvas = glassCanvasRef.current;
				if (buf && buf.byteLength > 8 && canvas && stagingCtx) {
					const view = new DataView(buf);
					const width = view.getUint32(0, true);
					const height = view.getUint32(4, true);
					const pixels = new Uint8ClampedArray(buf, 8);
					if (pixels.length === width * height * 4) {
						if (staging.width !== width || staging.height !== height) {
							staging.width = width;
							staging.height = height;
						}
						stagingCtx.putImageData(new ImageData(pixels, width, height), 0, 0);
						// 16 CSS px context margin, captured at 1/4 size.
						const m = Math.round((16 * window.devicePixelRatio) / 4);
						const cw = Math.max(1, width - m * 2);
						const ch = Math.max(1, height - m * 2);
						if (canvas.width !== cw || canvas.height !== ch) {
							canvas.width = cw;
							canvas.height = ch;
						}
						canvas.getContext("2d")?.drawImage(staging, m, m, cw, ch, 0, 0, cw, ch);
						// 30 fps while in use, 12 fps at rest.
						delay = glassActiveRef.current ? 33 : 83;
					}
				}
			} catch {
				delay = 1000;
			}
			if (document.hidden) {
				timer = null;
				return;
			}
			timer = setTimeout(pull, delay);
		};
		const onVisible = () => {
			if (!document.hidden && !timer && !stopped) pull();
		};
		document.addEventListener("visibilitychange", onVisible);
		pull();
		return () => {
			stopped = true;
			document.removeEventListener("visibilitychange", onVisible);
			if (timer) clearTimeout(timer);
		};
	}, [windowLabel, islandMaterial, isPill]);

	// Widgets open from a warm weather cache instead of a skeleton.
	useEffect(() => {
		if (windowLabel !== "main") return;
		const first = setTimeout(prefetchWeather, 4000);
		const t = setInterval(prefetchWeather, 20 * 60 * 1000);
		return () => {
			clearTimeout(first);
			clearInterval(t);
		};
	}, [windowLabel]);

	// Google Calendar: refresh every 5 minutes while connected.
	useEffect(() => {
		if (windowLabel !== "main") return;
		let cancelled = false;
		const refresh = async () => {
			const connected = await invoke<boolean>("google_connected").catch(() => false);
			if (!connected || cancelled) {
				if (!cancelled) setCalendarEvents([]);
				return;
			}
			const now = new Date();
			const monday = new Date(now);
			monday.setHours(0, 0, 0, 0);
			monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
			const end = new Date(monday);
			end.setDate(monday.getDate() + 8);
			const events = await invoke<CalendarEvent[]>("google_events", {
				timeMin: monday.toISOString(),
				timeMax: end.toISOString()
			}).catch(() => null);
			if (events && !cancelled) setCalendarEvents(events);
		};
		refresh();
		const t = setInterval(refresh, 5 * 60 * 1000);
		// Connecting in Settings saves the client: refresh right after.
		const un = listen<{ key: string }>("settings-changed", (e) => {
			if (e.payload?.key?.startsWith("bloom-google")) setTimeout(refresh, 3000);
		});
		// And poll quickly for a minute after start-up in case sign-in finishes.
		const quick = setInterval(refresh, 20000);
		const stopQuick = setTimeout(() => clearInterval(quick), 120000);
		return () => {
			cancelled = true;
			clearInterval(t);
			clearInterval(quick);
			clearTimeout(stopQuick);
			un.then((fn) => fn());
		};
	}, [windowLabel]);
	// A heads-up 10 minutes before each timed event.
	useEffect(() => {
		if (windowLabel !== "main" || calendarEvents.length === 0) return;
		const check = () => {
			const now = Date.now();
			for (const ev of calendarEvents) {
				if (ev.allDay || remindedEvents.current.has(ev.id)) continue;
				const start = new Date(ev.start).getTime();
				const mins = Math.round((start - now) / 60000);
				if (mins >= 0 && mins <= 10) {
					remindedEvents.current.add(ev.id);
					liftActivity(
						{
							id: `event-${ev.id}`,
							kind: "event",
							priority: 6,
							signal: null,
							icon: "calendar",
							title: ev.title,
							value: mins <= 0 ? "now" : `in ${mins} min`,
							action: "panel:home"
						},
						10000
					);
					if (notchMode === "peek") triggerEventPeek(4000);
				}
			}
		};
		check();
		const t = setInterval(check, 30000);
		return () => clearInterval(t);
	}, [calendarEvents, windowLabel, notchMode, triggerEventPeek]);

	// Keep awake and command search.
	useEffect(() => {
		if (windowLabel !== "main") return;
		invoke<boolean>("get_keep_awake").then(setKeepAwake).catch(() => {});
		const un = listen("command-search", () => {
			invoke("focus_island").catch(() => {});
			setNotchPinned(true);
			setIsOpen(true);
			setIsHovered(true);
			setBloomMode("search");
		});
		return () => {
			un.then((fn) => fn());
		};
	}, [windowLabel, setNotchPinned]);

	// ── Island Engine ──
	useEffect(() => {
		if (windowLabel !== "main") return;
		invoke<Presentation>("activity_presentation").then(setPresentation).catch(() => {});
		const un = listen<Presentation>("activities-changed", (e) => setPresentation(e.payload));
		return () => {
			un.then((fn) => fn());
		};
	}, [windowLabel]);
	// A lift peeks a hidden island in Peek mode.
	useEffect(() => {
		if (presentation.lifting && notchMode === "peek") triggerEventPeek(2600);
	}, [presentation.lifting, presentation.main?.id, notchMode, triggerEventPeek]);

	// Timer as an activity: orange, with a draining fill.
	useEffect(() => {
		if (windowLabel !== "main") return;
		if (isTimerFinished) {
			endActivity("timer");
			liftActivity({ id: "timer-done", kind: "timer", priority: 8, signal: "timer", icon: "timer", title: "Timer done", value: "0:00" }, 4000);
		} else if (timerSeconds > 0) {
			upsertActivity({
				id: "timer",
				kind: "timer",
				priority: 6,
				signal: "timer",
				icon: "timer",
				title: isTimerRunning ? "Timer" : "Timer paused",
				value: formatTimerTime(timerSeconds),
				progress: lastDurationSeconds > 0 ? timerSeconds / lastDurationSeconds : null,
				action: "panel:calendar"
			});
		} else {
			endActivity("timer");
		}
	}, [timerSeconds, isTimerRunning, isTimerFinished, lastDurationSeconds, windowLabel]);

	// Clipboard -> Shelf (the backend only reads the clipboard when enabled).
	const shelfAddRef = useRef({ text: addShelfText, files: addShelfItems });
	shelfAddRef.current = { text: addShelfText, files: addShelfItems };
	useEffect(() => {
		if (windowLabel !== "main") return;
		const un = listen<{ text: string | null; files: string[]; image: boolean }>("clipboard-captured", (e) => {
			const { text, files, image } = e.payload;
			if (files.length === 0 && !text) return;
			const id = `${Date.now().toString(36)}`;
			// Drop the Win32 long-path prefix (\\?\) from file paths.
			const cleanFiles = files.map((f) => (f.startsWith("\\\\?\\") ? f.slice(4) : f));
			const name = (f: string) => f.split(/[\\/]/).pop() || f;
			const folder = (f: string) => f.split(/[\\/]/).slice(0, -1).join("\\");
			const preview =
				cleanFiles.length > 0
					? image
						? "Copied image"
						: cleanFiles.length === 1
							? name(cleanFiles[0])
							: `${cleanFiles.length} files`
					: (text ?? "").replace(/\s+/g, " ").slice(0, 48);
			const detail = cleanFiles.length === 1 && !image ? folder(cleanFiles[0]) : null;
			const today = new Date().toDateString();
			const key = cleanFiles.length > 0 ? cleanFiles.join("|") : (text ?? "");
			setRecentCopies((prev) => {
				// The same thing copied twice in a row is one entry.
				if (prev[0] && prev[0].key === key) return prev;
				return [
					{ id, text, files: cleanFiles, image, preview, detail, key, day: today },
					...prev.filter((c) => c.day === today)
				].slice(0, 10);
			});
			const count = bumpClipboardCount();
			liftActivity(
				{
					id: "clipboard",
					kind: "clipboard",
					priority: 4,
					signal: null,
					icon: "clipboard",
					title: preview || "Copied",
					value: `${count} today`,
					action: `keep:${id}`
				},
				4000
			);
		});
		return () => {
			un.then((fn) => fn());
		};
	}, [windowLabel]);

	// Spotify: whether it's connected. Checked at start, when Settings
	// connects or disconnects, and when the Client ID changes.
	useEffect(() => {
		if (windowLabel !== "main") return;
		if (!has("spotify")) {
			setSpotifyOn(false);
			return;
		}
		const check = () => spotifyConnected().then(setSpotifyOn).catch(() => setSpotifyOn(false));
		check();
		const unChanged = listen<boolean>(SPOTIFY_CHANGED_EVENT, check);
		const unSettings = listen<{ key: string }>("settings-changed", (e) => {
			if (e.payload?.key === "bloom-spotify-client-id") check();
		});
		return () => {
			unChanged.then((fn) => fn());
			unSettings.then((fn) => fn());
		};
	}, [windowLabel]);
	// The Web API is polled only while Spotify is the player and the island's
	// Home view is open; otherwise the system media session is enough, which
	// keeps DynIs idle when nobody is looking.
	const spotifyIsPlayer = isSpotifySource(mediaInfo.source_app);
	useEffect(() => {
		if (!spotifyOn || !spotifyIsPlayer || bloomMode !== "home" || !isOpen) {
			if (!spotifyIsPlayer) {
				setSpotifyQueue(null);
				setSpotifyLiked(null);
			}
			return;
		}
		let cancelled = false;
		const refresh = async () => {
			const q = await fetchQueue();
			if (cancelled) return;
			setSpotifyQueue(q);
			setSpotifyLiked(q?.current ? await isSaved(q.current.id) : null);
		};
		refresh();
		const t = setInterval(refresh, 8000);
		return () => {
			cancelled = true;
			clearInterval(t);
		};
	}, [spotifyOn, spotifyIsPlayer, bloomMode, isOpen, mediaInfo.title]);
	// When Spotify is what's playing, its controls go through the Web API
	// (shuffle, repeat, seek, queue, devices); otherwise the system player.
	const spotifyActive = spotifyOn && spotifyIsPlayer && isSpotifyActive(spotifyQueue, mediaInfo.title);
	const spotifyResult = (err: string | null) => {
		if (err) liftActivity({ id: "spotify-error", kind: "notice", priority: 5, signal: "alert", icon: "bell", title: err });
		// The queue and state change right after a control: refresh them.
		setTimeout(() => fetchQueue().then((q) => q && setSpotifyQueue(q)).catch(() => {}), 700);
		return err;
	};
	useEffect(() => {
		setNotchPinned(ccEditing);
	}, [ccEditing, setNotchPinned]);

	// Esc collapses an open island (when the island window has keyboard focus).
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape" && isOpenRef.current) releaseNotchHover();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	});

	// Clip the notch window to what it draws (see window_region.rs): outside
	// these rectangles the window takes no clicks, whatever its click-through
	// state. Sent after every render, but only when the region changes.
	useEffect(() => {
		if (windowLabel === "main") {
			updateNotchRegion();
			// Report the hit box whenever the target geometry or edge changes
			// (deduplicated, so this is cheap on every render).
			reportNotchRect.current();
		}
	});

	return (
		<MotionConfig reducedMotion="user">
		<div className={`screen edge-${notchEdge} style-${islandStyle}`} style={{ overflow: "hidden" }}>
			<div
				className="notch-anchor"
				style={{
					zoom: scale,
					width: "100%",
					display: "flex",
					justifyContent: "center",
					alignItems: notchEdge === "bottom" ? "flex-end" : "flex-start",
					position: "relative"
				}}
			>
				<motion.div
					ref={bloomRef}
					className={`bloom ink island-${islandStyle} material-${isPill ? islandMaterial : "ink"} ${isOpen ? "is-open" : ""} edge-${notchEdge} ${isHovered ? "expanded" : ""} ${isImpacted ? "is-impacted" : ""} ${isDragHovering ? "drag-hover" : ""}`}
					onMouseEnter={() => setIsNotchHovered(true)}
					onMouseLeave={() => setIsNotchHovered(false)}
					onWheel={handleWheel}
					initial={{
						...edgeOffset(notchEdge, 250),
						width: 30.6,
						height: 44.2,
						borderTopLeftRadius: 18,
						borderTopRightRadius: 18,
						borderBottomLeftRadius: 18,
						borderBottomRightRadius: 18,
						scaleX: 1,
						scaleY: 1,
						opacity: 0
					}}
					animate={{
						...pillOffset,
						x: pillOffset.x + bubbleShift,
						width: pillTargetWidth,
						height: pillTargetHeight,
						opacity: isVisible ? 1 : 0,
						scaleX: pillLift,
						scaleY: pillLift,
						...pillRadii,
						filter: isVisible ? "blur(0px)" : "blur(8px)",
						pointerEvents: isVisible ? "auto" : "none"
					}}
					onClick={(e) => {
						e.stopPropagation();
						if (!isOpen) openNotch(openingPanel());
					}}
					onHoverStart={() => {
						releaseDeferredRef.current = false;
						setIsHovered(true);
						// Hovering the shelf cancels its post-drop auto-close.
						if (bloomMode === "shelf") clearShelfCollapse();
					}}
					onHoverEnd={releaseNotchHover}
					// Grow out of (and retract into) the edge the pill hangs from.
					style={{ originY: notchEdge === "bottom" ? 1 : 0 }}
					// Width, height, radius and position share one spring so the
					// shape breathes as a whole.
					transition={
						reduceMotion
							? { default: REDUCED_TRANSITION, opacity: REDUCED_TRANSITION }
							: {
									default: ISLAND_SPRING,
									width: ISLAND_SPRING,
									height: ISLAND_SPRING,
									x: ISLAND_SPRING,
									y: ISLAND_SPRING,
									scaleX: ISLAND_SPRING,
									scaleY: ISLAND_SPRING,
									borderTopLeftRadius: ISLAND_SPRING,
									borderTopRightRadius: ISLAND_SPRING,
									borderBottomLeftRadius: ISLAND_SPRING,
									borderBottomRightRadius: ISLAND_SPRING,
									opacity: { duration: 0.2 }
								}
					}
				>
					{isPill && islandMaterial === "glass-live" && (
						<div className="glass-live-clip" aria-hidden="true">
							<canvas ref={glassCanvasRef} className="glass-live-canvas" />
						</div>
					)}
					<EdgeSurface edge={notchEdge} flares={!isPill && isImpacted} />
					{/* Liquid edge: Classic only, while music plays. */}
					{!isPill && isPlaying && !isOpen && musicActivity && !reduceMotion && (
						<svg className="liquid-edge" viewBox="0 0 120 8" preserveAspectRatio="none" aria-hidden="true">
							<path d="M0 0 H240 V3 Q232 7 225 3 T210 3 T195 3 T180 3 T165 3 T150 3 T135 3 T120 3 T105 3 T90 3 T75 3 T60 3 T45 3 T30 3 T15 3 T0 3 Z" />
						</svg>
					)}
					{keepAwake && !isOpen && (
						<span className="keep-awake-badge" title="Keep Awake is on" aria-label="Keep Awake is on">
							<Coffee size={10} strokeWidth={2.6} />
						</span>
					)}
					{/* Timer: the pill drains as time passes. */}
					{(timerSeconds > 0 || isTimerFinished) && !isOpen && lastDurationSeconds > 0 && (
						<span
							className="timer-drain"
							aria-hidden="true"
							style={{ width: `${Math.min(100, (timerSeconds / lastDurationSeconds) * 100)}%` }}
						/>
					)}
					<AnimatePresence>
						{isMusicMode && settingsAmbienceEnabled && albumArtUrl && isOpen && !isCalendarMode && (
							<motion.div
								className="notch-ambient-glow"
								initial={{ opacity: 0 }}
								animate={{ opacity: 1 }}
								exit={{ opacity: 0 }}
								transition={{ duration: 0.15 }}
							>
								<AnimatePresence mode="wait">
									<motion.img
										key={albumArtUrl}
										src={albumArtUrl}
										alt=""
										draggable={false}
										initial={{ opacity: 0, scale: 1.1 }}
										animate={{ opacity: 1, scale: 1.8 }}
										exit={{ opacity: 0 }}
										transition={{ duration: 0.3 }}
									/>
								</AnimatePresence>
							</motion.div>
						)}
					</AnimatePresence>
					<AnimatePresence mode="wait">
						{isExpanded && (
							<motion.div
								key="bloom-content"
								initial={
									reduceMotion
										? { opacity: 0 }
										: { opacity: 0, scale: 0.96, filter: "blur(4px)" }
								}
								animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
								exit={{ opacity: 0, transition: { duration: reduceMotion ? 0.12 : 0.09 } }}
								transition={reduceMotion ? REDUCED_TRANSITION : CONTENT_IN}
								style={{
									width: "100%",
									height: "100%",
									display: "flex",
									flexDirection: "column",
									alignItems: "center",
									position: "relative",
									borderRadius: "inherit"
								}}
							>
								{/* Faster Waiting Transition Area */}
								<AnimatePresence mode="wait">
									{isOpen && isMusicMode && !isCalendarMode ? (
										<motion.div
											key="expanded-music"
											className="expanded-music-container"
											initial={{ opacity: 0, scale: 0.98 }}
											animate={{ opacity: 1, scale: 1 }}
											exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.1 } }}
											transition={ISLAND_SPRING}
										>
											{mediaLayout === "compact" ? (
												<CompactMediaPlayer
													mediaInfo={mediaInfo}
													albumArtUrl={albumArtUrl}
													albumArtKey={albumArtKey}
													isPlaying={isPlaying}
													volume={displayVolume}
													volumeExpanded={compactVolumeExpanded}
													onVolumeExpandedChange={setCompactVolumeExpanded}
													onTogglePlayPause={togglePlayPause}
													onVolumeChange={handleVolumeChange}
													prevFront={prevFront}
													prevBack={prevBack}
													nextFront={nextFront}
													nextBack={nextBack}
													onAnimatePrev={animatePrev}
													onAnimateNext={animateNext}
													onLayoutChange={(layout) => {
														setMediaLayout(layout);
														localStorage.setItem("bloom-media-layout", layout);
														invoke("save_setting", {
															key: "bloom-media-layout",
															value: layout
														}).catch(console.error);
														window.dispatchEvent(
															new CustomEvent("settings-changed", {
																detail: { key: "media-layout", value: layout }
															})
														);
													}}
												/>
											) : (
												<div className="compact-premium-layout">
													<div className="album-art-section">
														<motion.div
															className="premium-album-art"
															whileHover={{ scale: 1.05 }}
															whileTap={{ scale: 0.95 }}
															onClick={(e) => {
																e.stopPropagation();
																setMediaLayout("compact");
																localStorage.setItem("bloom-media-layout", "compact");
																invoke("save_setting", {
																	key: "bloom-media-layout",
																	value: "compact"
																}).catch(console.error);
																window.dispatchEvent(
																	new CustomEvent("settings-changed", {
																		detail: { key: "media-layout", value: "compact" }
																	})
																);
															}}
															style={{ cursor: "pointer" }}
														>
															<AnimatePresence mode="wait" initial={false}>
																{albumArtUrl ? (
																	<motion.img
																		key={`art-${albumArtKey}`}
																		src={albumArtUrl}
																		alt="Art"
																		initial={{ rotateY: 90, opacity: 0 }}
																		animate={{ rotateY: 0, opacity: 1 }}
																		exit={{ rotateY: -90, opacity: 0 }}
																		transition={{ duration: 0.3, ease: "easeInOut" }}
																		style={{ width: "100%", height: "100%", objectFit: "cover" }}
																	/>
																) : (
																	<motion.div
																		key="placeholder"
																		className="art-placeholder-mini"
																		initial={{ rotateY: 90, opacity: 0 }}
																		animate={{ rotateY: 0, opacity: 1 }}
																		exit={{ rotateY: -90, opacity: 0 }}
																		transition={{ duration: 0.3, ease: "easeInOut" }}
																	>
																		<MusicNoteIcon size={32} className="music-placeholder-svg" />
																	</motion.div>
																)}
															</AnimatePresence>
														</motion.div>
													</div>

													<div className="metadata-controls-section-middle">
														<div className="track-header-row">
															<div className="track-info-middle">
																<TitleMarquee title={mediaInfo.title} />
																<span className="premium-artist">{mediaInfo.artist}</span>
															</div>
															<div className="header-visualizer-wrap">
																{/* Only while playing: paused, the flat bars read as a "-----" placeholder. */}
																{isPlaying && (
																	<div className="header-visualizer">
																		<Visualizer isPlaying={isPlaying} bars={5} height={18} />
																	</div>
																)}
																<motion.button
																	className="classic-audio-output-btn"
																	onClick={(e) => {
																		e.stopPropagation();
																		invoke("open_sound_settings").catch(() => {});
																	}}
																	whileTap={{ scale: 0.9 }}
																	title="Audio Output"
																>
																	<HeadphonesIcon size={20} style={{ opacity: 0.5 }} />
																</motion.button>
															</div>
														</div>

														<div className="controls-row-sleek">
															<motion.button
																aria-label="Previous track"
									className="sleek-btn previous-btn"
																onClick={(e) => {
																	e.stopPropagation();
																	animatePrev();
																}}
																whileHover={{ scale: 1.2 }}
																whileTap={{ scale: 0.9 }}
																transition={ISLAND_SPRING}
															>
																<div
																	style={{
																		position: "relative",
																		width: 32,
																		height: 16,
																		overflow: "hidden"
																	}}
																>
																	<motion.div
																		animate={prevBack}
																		style={{
																			position: "absolute",
																			inset: 0,
																			display: "flex",
																			alignItems: "center",
																			justifyContent: "center"
																		}}
																	>
																		<SkipBackIcon size={32} />
																	</motion.div>
																	<motion.div
																		animate={prevFront}
																		style={{
																			position: "absolute",
																			inset: 0,
																			display: "flex",
																			alignItems: "center",
																			justifyContent: "center"
																		}}
																	>
																		<SkipBackIcon size={32} />
																	</motion.div>
																</div>
															</motion.button>

															<motion.button
																aria-label="Play or pause"
									className="sleek-btn play-pause-btn-floating"
																onClick={(e) => {
																	e.stopPropagation();
																	togglePlayPause();
																}}
																whileHover={{ scale: 1.2 }}
																whileTap={{ scale: 0.95 }}
																transition={ISLAND_SPRING}
															>
																<AnimatePresence mode="wait" initial={false}>
																	<motion.div
																		key={isPlaying ? "pause" : "play"}
																		initial={{ opacity: 0, scale: 0.8 }}
																		animate={{ opacity: 1, scale: 1 }}
																		exit={{ opacity: 0, scale: 0.8 }}
																		transition={{ duration: 0.15 }}
																		style={{
																			display: "flex",
																			alignItems: "center",
																			justifyContent: "center"
																		}}
																	>
																		{isPlaying ? <PauseIcon size={26} /> : <PlayIcon size={26} />}
																	</motion.div>
																</AnimatePresence>
															</motion.button>

															<motion.button
																aria-label="Next track"
									className="sleek-btn next-btn"
																onClick={(e) => {
																	e.stopPropagation();
																	animateNext();
																}}
																whileHover={{ scale: 1.2 }}
																whileTap={{ scale: 0.9 }}
																transition={ISLAND_SPRING}
															>
																<div
																	style={{
																		position: "relative",
																		width: 32,
																		height: 16,
																		overflow: "hidden"
																	}}
																>
																	<motion.div
																		animate={nextBack}
																		style={{
																			position: "absolute",
																			inset: 0,
																			display: "flex",
																			alignItems: "center",
																			justifyContent: "center"
																		}}
																	>
																		<SkipForwardIcon size={32} />
																	</motion.div>
																	<motion.div
																		animate={nextFront}
																		style={{
																			position: "absolute",
																			inset: 0,
																			display: "flex",
																			alignItems: "center",
																			justifyContent: "center"
																		}}
																	>
																		<SkipForwardIcon size={32} />
																	</motion.div>
																</div>
															</motion.button>
														</div>

														{isPill && (
															<MusicProgress
																positionMs={mediaInfo.position_ms ?? 0}
																durationMs={mediaInfo.duration_ms ?? 0}
																updatedAt={mediaInfo.position_updated_at ?? 0}
																isPlaying={isPlaying}
															/>
														)}
														<div className="volume-slider-container">
															<VolumeLowIcon size={12} style={{ opacity: 0.5 }} />
															<div className="slider-track-premium">
																<input
																	type="range"
																	min="0"
																	max="1"
																	step="0.01"
																	value={displayVolume}
																	onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
																	onPointerDown={(e) => e.stopPropagation()}
																	onClick={(e) => e.stopPropagation()}
																	className="premium-slider"
																/>
																<div
																	className="slider-progress-fill"
																	style={{ width: `${displayVolume * 100}%` }}
																/>
															</div>
															<VolumeHighIcon size={14} style={{ opacity: 0.5 }} />
														</div>
													</div>
												</div>
											)}
										</motion.div>
									) : (
										<motion.div
											key="standard-view-group"
											initial={{ opacity: 0, y: -5 }}
											animate={{ opacity: 1, y: 0 }}
											exit={{ opacity: 0, y: 5, transition: { duration: 0.1 } }}
											transition={{ duration: 0.2 }}
											style={{ width: "100%" }}
										>
											<div className="main-row">
												<AnimatePresence mode="wait">
													{showLevelCapsule ? (
														<motion.div
															key="level-capsule"
															className="level-capsule"
															initial={{ opacity: 0, scale: 0.96, filter: "blur(4px)" }}
															animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
															exit={{ opacity: 0, transition: { duration: 0.09 } }}
															transition={CONTENT_IN}
															onMouseEnter={() => {
																levelHudHeld.current = true;
															}}
															onMouseLeave={() => {
																levelHudHeld.current = false;
																scheduleLevelHudHide();
															}}
															onClick={(e) => e.stopPropagation()}
														>
															<span className="level-icon" aria-hidden="true">
																{levelHud === "brightness" ? (
																	<Sun size={16} strokeWidth={2.2} />
																) : isMuted || volume === 0 ? (
																	<VolumeX size={16} strokeWidth={2.2} />
																) : volume < 0.5 ? (
																	<Volume1 size={16} strokeWidth={2.2} />
																) : (
																	<Volume2 size={16} strokeWidth={2.2} />
																)}
															</span>
															<input
																type="range"
																className="level-slider"
																min={0}
																max={100}
																aria-label={levelHud === "brightness" ? "Brightness" : "Volume"}
																value={levelPercent}
																style={{ "--level": `${levelPercent}%` } as React.CSSProperties}
																onPointerDown={() => {
																	levelHudHeld.current = true;
																}}
																onPointerUp={() => {
																	levelHudHeld.current = false;
																	scheduleLevelHudHide();
																}}
																onChange={(e) => {
																	const v = Number(e.target.value);
																	if (levelHud === "brightness") handleBrightnessChange(v);
																	else handleVolumeChange(v / 100);
																	scheduleLevelHudHide();
																}}
															/>
															<span className="level-value">{levelPercent}</span>
														</motion.div>
													) : showEngineActivity && presentation.main ? (
														<motion.div
															key={`activity-${presentation.main.id}`}
															className={`activity-wings sig-${presentation.main.signal ?? "none"}`}
															initial={{ opacity: 0, scale: 0.96, filter: "blur(4px)" }}
															animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
															exit={{ opacity: 0, transition: { duration: 0.09 } }}
															transition={reduceMotion ? REDUCED_TRANSITION : CONTENT_IN}
															onClick={(e) => {
																e.stopPropagation();
																handleActivityClick(presentation.main!);
															}}
															role="button"
															aria-label={`${presentation.main.title}${presentation.main.value ? `, ${presentation.main.value}` : ""}`}
														>
															{presentation.main.progress != null && (
																<span
																	className="activity-fill"
																	style={{ width: `${Math.round(presentation.main.progress * 100)}%` }}
																/>
															)}
															<span className="activity-wing left">
																<span className="activity-icon">
																	<ActivityIcon icon={presentation.main.icon} />
																</span>
																<span className="activity-title">{presentation.main.title}</span>
															</span>
															{presentation.main.kind === "clipboard" && presentation.main.action?.startsWith("keep:") ? (
																<span className="activity-wing right">
																	<span className="activity-keep">Keep</span>
																</span>
															) : (
																presentation.main.value && (
																	<span className="activity-wing right">
																		<span className="activity-value">{presentation.main.value}</span>
																	</span>
																)
															)}
														</motion.div>
													) : (showPowerPulse || showLowBatteryPulse) &&
													!isHovered ? (
														<motion.div
																key="pulse-view"
																initial={{ opacity: 0, scale: 0.95, filter: "blur(4px)" }}
																animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
																exit={{ opacity: 0, scale: 1.05, filter: "blur(4px)" }}
																className="power-pulse-content"
															>
																<BatteryIcon
																	charging={isCharging}
																	level={batteryLevel}
																	threshold={lowBatteryThreshold}
																/>
																<span
																	className="label"
																	style={{ color: showLowBatteryPulse ? "#FF453A" : "inherit" }}
																>
																	{showLowBatteryPulse
																		? "Low Battery"
																		: isCharging
																			? "Charging"
																			: "On Battery"}{" "}
																	• {batteryLevel}%
																</span>
															</motion.div>
													) : (
														<motion.div
															key="standard-view"
															className="main-row-inner"
															initial={{ opacity: 0 }}
															animate={{ opacity: 1 }}
															exit={{ opacity: 0 }}
														>
															{/* Left: music on hover while a paused session remains, otherwise status widgets */}
															<div className="side-content left">
																{showCompactMusicIcons && settingsVisualizerEnabled ? (
																	<AnimatePresence>
																		{/* Paused, the flat bars read as a "-----" placeholder. */}
																		{settingsVisualizerEnabled && isPlaying && (
																			<motion.div
																				key="visualizer"
																				initial={{ scale: 0.8, opacity: 0 }}
																				animate={{ scale: 1, opacity: 1 }}
																				exit={{ scale: 0.8, opacity: 0 }}
																			>
																				<Visualizer isPlaying={isPlaying} />
																			</motion.div>
																		)}
																	</AnimatePresence>
																) : !showCompactMusicIcons && isHovered && statusWidgets.left.length > 0 ? (
																	<motion.div
																		key="left-widgets"
																		ref={leftWidgetsRef}
																		className="passive-features-group"
																		initial={{ opacity: 0 }}
																		animate={{ opacity: 1 }}
																		exit={{ opacity: 0 }}
																		transition={{ duration: 0.2 }}
																	>
																		{statusWidgets.left.map(renderStatusWidget)}
																	</motion.div>
																) : null}
															</div>

															{/* Center - Time (always visible) */}
															<div className="time-center" ref={timeCenterRef}>
																<AnimatePresence>
																	{showPanelArrows && (
																		<motion.button
																			key="panel-prev"
																			type="button"
																			className="panel-arrow prev"
																			aria-label="Previous panel"
																			initial={{ opacity: 0, x: 4 }}
																			animate={{ opacity: 1, x: 0 }}
																			exit={{ opacity: 0, x: 4 }}
																			transition={{ duration: 0.15 }}
																			onClick={(e) => {
																				e.stopPropagation();
																				cyclePanel(-1);
																			}}
																		>
																			<ChevronLeft size={12} strokeWidth={2.5} />
																		</motion.button>
																	)}
																</AnimatePresence>
																<div className="time-flip-container" onClick={toggleCalendarMode}>
																	<AnimatePresence initial={false}>
																		{timerSeconds > 0 || isTimerFinished ? (
																			<motion.span
																				key="timer"
																				className={`time compact-timer ${isTimerFinished ? "timer-finished" : ""}`}
																				initial={{ rotateX: -90, opacity: 0 }}
																				animate={{ rotateX: 0, opacity: 1 }}
																				exit={{ rotateX: 90, opacity: 0 }}
																				transition={ISLAND_SPRING}
																			>
																				{isTimerFinished && (
																					<BellRing
																						size={13}
																						strokeWidth={2.5}
																						className="timer-bell"
																					/>
																				)}
																				{formatTimerTime(timerSeconds)}
																			</motion.span>
																		) : (
																			<motion.span
																				key="clock"
																				className="time"
																				initial={{ rotateX: -90, opacity: 0 }}
																				animate={{ rotateX: 0, opacity: 1 }}
																				exit={{ rotateX: 90, opacity: 0 }}
																				transition={ISLAND_SPRING}
																			>
																				{time}
																			</motion.span>
																		)}
																	</AnimatePresence>
																</div>
																<AnimatePresence>
																	{showPanelArrows && (
																		<motion.button
																			key="panel-next"
																			type="button"
																			className="panel-arrow next"
																			aria-label="Next panel"
																			initial={{ opacity: 0, x: -4 }}
																			animate={{ opacity: 1, x: 0 }}
																			exit={{ opacity: 0, x: -4 }}
																			transition={{ duration: 0.15 }}
																			onClick={(e) => {
																				e.stopPropagation();
																				cyclePanel(1);
																			}}
																		>
																			<ChevronRight size={12} strokeWidth={2.5} />
																		</motion.button>
																	)}
																</AnimatePresence>
															</div>

															{/* Right: album art on a retained music session, otherwise status widgets */}
															<div className="side-content right">
																{showCompactMusicIcons && (settingsAlbumArtEnabled || showMusicOnStatusHover) ? (
																	<AnimatePresence mode="wait">
																		<motion.div
																			key="album-art"
																			className="album-art-glow-wrapper"
																			initial={{ opacity: 0, scale: 0.8 }}
																			animate={{ opacity: 1, scale: 1 }}
																			exit={{ opacity: 0, y: -20, scale: 0.8, filter: "blur(8px)" }}
																			transition={{ duration: 0.12 }}
																		>
																			{settingsAlbumArtEnabled && albumArtUrl && settingsCompactGlowEnabled && (
																				<img
																					src={albumArtUrl}
																					alt=""
																					className="album-art-glow-bg"
																					draggable={false}
																				/>
																			)}
																			<button
																				className={`album-art album-art-activity${!isPlaying ? " paused" : ""}${isPlaying && !reduceMotion ? " album-art-spin-playing" : ""}`}
																				aria-label="Open music"
																				onClick={(e) => {
																					e.stopPropagation();
																					openNotch("music");
																				}}
																				onContextMenu={(e) => {
																					e.preventDefault();
																					e.stopPropagation();
																					skipPrevious();
																				}}
																			>
																				<div className="album-art-inner">
																					<AnimatePresence mode="wait" initial={false}>
																						{settingsAlbumArtEnabled && albumArtUrl ? (
																							<motion.img
																								key={`compact-art-${albumArtKey}`}
																								src={albumArtUrl}
																								alt="Art"
																								draggable={false}
																								initial={{ rotateY: 90, opacity: 0 }}
																								animate={{ rotateY: 0, opacity: 1 }}
																								exit={{ rotateY: -90, opacity: 0 }}
																								transition={{ duration: 0.25, ease: "easeInOut" }}
																								style={{
																									width: "100%",
																									height: "100%",
																									objectFit: "cover"
																								}}
																							/>
																						) : (
																							<motion.div
																								key="compact-placeholder"
																								className="album-art-placeholder"
																								initial={{ rotateY: 90, opacity: 0 }}
																								animate={{ rotateY: 0, opacity: 1 }}
																								exit={{ rotateY: -90, opacity: 0 }}
																								transition={{ duration: 0.25, ease: "easeInOut" }}
																							>
																								<MusicNoteIcon className="music-placeholder-svg-small" />
																							</motion.div>
																						)}
																					</AnimatePresence>
																				</div>
																			</button>
																		</motion.div>
																	</AnimatePresence>
																) : !showCompactMusicIcons && isHovered && statusWidgets.right.length > 0 ? (
																	<motion.div
																		key="right-widgets"
																		ref={rightWidgetsRef}
																		className="passive-features-group"
																		initial={{ opacity: 0 }}
																		animate={{ opacity: 1 }}
																		exit={{ opacity: 0 }}
																		transition={{ duration: 0.2 }}
																	>
																		{statusWidgets.right.map(renderStatusWidget)}
																	</motion.div>
																) : null}
															</div>
														</motion.div>
													)}
												</AnimatePresence>
											</div>
										</motion.div>
									)}
								</AnimatePresence>

								{/* Wi-Fi networks, opened from the controls panel's Wi-Fi tile */}
								<AnimatePresence>
									{bloomMode === "wifi" && (
										<motion.div
											key="wifi-view"
											initial={{ opacity: 0 }}
											animate={{ opacity: 1 }}
											exit={{ opacity: 0, filter: "blur(4px)", transition: { duration: 0.1 } }}
											transition={ISLAND_SPRING}
										>
											<WifiPanel
												enabled={wifiEnabled}
												onToggle={toggleWifi}
												onBack={() => setBloomMode("command-center")}
												onPinChange={setNotchPinned}
											/>
										</motion.div>
									)}
								</AnimatePresence>

								{/* Bluetooth devices, opened from the controls panel's Bluetooth tile */}
								<AnimatePresence>
									{bloomMode === "bluetooth" && (
										<motion.div
											key="bluetooth-view"
											initial={{ opacity: 0 }}
											animate={{ opacity: 1 }}
											exit={{ opacity: 0, filter: "blur(4px)", transition: { duration: 0.1 } }}
											transition={ISLAND_SPRING}
										>
											<BluetoothPanel
												enabled={bluetoothEnabled}
												onToggle={toggleBluetooth}
												onBack={() => setBloomMode("command-center")}
												onPinChange={setNotchPinned}
											/>
										</motion.div>
									)}
								</AnimatePresence>

								{/* Command search (Ctrl+Alt+Space) */}
								<AnimatePresence>
									{bloomMode === "search" && isOpen && (
										<motion.div
											className="home-content"
											initial={{ opacity: 0, scale: 0.98, filter: "blur(4px)" }}
											animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
											exit={{ opacity: 0, transition: { duration: 0.1 } }}
											transition={reduceMotion ? REDUCED_TRANSITION : CONTENT_IN}
										>
											<CommandSearch actions={searchActions} onClose={closeSearch} />
										</motion.div>
									)}
								</AnimatePresence>

								{/* Home view */}
								<AnimatePresence>
									{bloomMode === "home" && isOpen && (
										<motion.div
											className="home-content"
											initial={{ opacity: 0, scale: 0.98, filter: "blur(4px)" }}
											animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
											exit={{ opacity: 0, filter: "blur(4px)", transition: { duration: 0.1 } }}
											transition={reduceMotion ? REDUCED_TRANSITION : CONTENT_IN}
										>
											<HomePanel
												media={{
													hasMedia: mediaInfo.has_media,
													title: mediaInfo.title,
													artist: mediaInfo.artist,
													isPlaying,
													art: albumArtUrl,
													positionMs: mediaInfo.position_ms ?? 0,
													durationMs: mediaInfo.duration_ms ?? 0,
													updatedAt: mediaInfo.position_updated_at ?? 0,
													shuffle: mediaInfo.shuffle ?? null,
													repeat: mediaInfo.repeat ?? null,
													sourceLabel: webActive ? webSourceLabel(browserMedia) : null
												}}
												onPrev={skipPrevious}
												onPlayPause={togglePlayPause}
												onNext={skipNext}
												onShuffle={() =>
													spotifyActive
														? spotifySetShuffle(!mediaInfo.shuffle).then(spotifyResult)
														: invoke("media_toggle_shuffle").catch(() => {})
												}
												onRepeat={() =>
													spotifyActive
														? spotifySetRepeat(nextRepeat(mediaInfo.repeat ?? null)).then(spotifyResult)
														: invoke("media_cycle_repeat").catch(() => {})
												}
												onSeek={(ms) =>
													spotifyActive
														? spotifySeek(ms).then(spotifyResult)
														: webActive
															? invoke("browser_media_command", { action: "seek", positionMs: ms }).catch(() => {})
															: invoke("media_seek", { positionMs: ms }).catch(() => {})
												}
												spotify={
													spotifyActive
														? {
																playQueueIndex: (i) => playQueueIndex(i).then(spotifyResult),
																devices: fetchDevices,
																transfer: (id) => transferTo(id).then(spotifyResult),
																search: searchTracks,
																addToQueue: (uri) => addToQueue(uri).then(spotifyResult),
																playNow: (uri) => playNow(uri).then(spotifyResult),
																playlists: fetchPlaylists,
																playPlaylist: (uri) => playContext(uri).then(spotifyResult)
															}
														: null
												}
												activities={allActivities}
												onActivity={handleActivityClick}
												shelfCount={shelfItems.length}
												onOpenShelf={() => openNotch("shelf")}
												spotifyQueue={spotifyActive ? spotifyQueue : webActive ? webQueueForHome(browserMedia) : null}
												onQueueJump={
													webActive
														? (i) => {
																const row = browserMedia?.media?.queue[i];
																if (row) invoke("browser_media_command", { action: "jump", index: row.index }).catch(() => {});
															}
														: undefined
												}
												liked={spotifyActive && spotifyQueue?.current ? spotifyLiked : null}
												onToggleLike={async () => {
													const id = spotifyQueue?.current?.id;
													if (!id || spotifyLiked === null) return;
													if (await setSaved(id, !spotifyLiked)) setSpotifyLiked(!spotifyLiked);
												}}
												onPinChange={setNotchPinned}
												recentCopies={recentCopies}
												onKeepCopy={keepCopy}
												stats={{ cpu: cpuUsage, ram: ramUsage, disk: diskSpace, netUp: netUpSpeed, netDown: netDownSpeed }}
												events={calendarEvents}
												timerText={timerSeconds > 0 || isTimerFinished ? formatTimerTime(timerSeconds) : null}
												battery={batteryLevel}
												charging={isCharging}
												headset={headsetInPill ? { name: headsetInPill.title, value: headsetInPill.value ?? null } : null}
												startTimer={startTimer}
												keepAwake={keepAwake}
												toggleKeepAwake={toggleKeepAwake}
												openSearch={() => {
													invoke("focus_island").catch(() => {});
													setNotchPinned(true);
													setBloomMode("search");
												}}
												snap={snap}
												screenshot={() => systemAction("snipping-tool")}
											/>
										</motion.div>
									)}
								</AnimatePresence>

								{/* Command Center Panel */}
								<AnimatePresence>
									{bloomMode === "command-center" && (
										<motion.div
											className="command-center-content-minimal"
											onClick={(e) => e.stopPropagation()}
											initial={{ opacity: 0 }}
											animate={{ opacity: 1 }}
											exit={{ opacity: 0, filter: "blur(4px)", transition: { duration: 0.1 } }}
											transition={ISLAND_SPRING}
										>
											<CommandCenterGrid
												layout={ccLayout}
												onLayoutChange={saveCcLayout}
												controls={ccControls}
												editing={ccEditing}
												onEditingChange={setCcEditing}
												onHeight={setCcHeight}
												reduceMotion={reduceMotion}
											/>
										</motion.div>
									)}
								</AnimatePresence>

								{/* Announcement Card */}
								<AnimatePresence>
									{bloomMode === "announcement" && announcement && !announcementDismissed && (
										<motion.div
											className={`announcement-content severity-${announcement.severity}`}
											onClick={(e) => e.stopPropagation()}
											initial={{ opacity: 0 }}
											animate={{ opacity: 1 }}
											exit={{
												opacity: 0,
												filter: "blur(4px)",
												transition: { duration: 0.1 }
											}}
											transition={ISLAND_SPRING}
										>
											<div className="announcement-header">
												<div className="announcement-heading">
													<Megaphone size={14} className="announcement-icon" />
													<span className="announcement-title">{announcement.title}</span>
												</div>
												<button
													className="announcement-close"
													onClick={dismissAnnouncement}
													title="Dismiss"
												>
													<X size={13} strokeWidth={2.2} />
												</button>
											</div>
											{announcement.body && (
												<p className="announcement-body">{announcement.body}</p>
											)}
											{announcement.url && (
												<button
													className="announcement-link"
													onClick={() => openUrl(announcement.url!)}
												>
													Learn more
												</button>
											)}
										</motion.div>
									)}
								</AnimatePresence>

								{/* Calendar & Timer Split View */}
								<AnimatePresence>
									{settingsCalendarEnabled && isCalendarMode && (
										<motion.div
											className="calendar-timer-content split-view"
											onClick={(e) =>
												e.stopPropagation()
											} /* Block mode switches when clicking inside */
											initial={{ opacity: 0 }}
											animate={{ opacity: 1 }}
											exit={{ opacity: 0, filter: "blur(4px)", transition: { duration: 0.1 } }}
											transition={ISLAND_SPRING}
										>
											<div className="calendar-column">
												<Calendar />
											</div>

											<div className="timer-column">
												<div className={`timer-section-new state-${timerState}`}>
													<div className="timer-main">
														<div className="timer-status">
															{isEditingTimer
																? "Set duration"
																: isTimerFinished
																	? "Time's up"
																	: timerEndTime
																		? `${timerState === "paused" ? "Paused · " : ""}ends ${timerEndTime}`
																		: "Click to edit"}
														</div>

														<div className={`timer-clock-row ${isEditingTimer ? "editing" : ""}`}>
															<div
																className={`timer-clock ${isEditingTimer && !timerEditValid ? "invalid" : ""}`}
																onClick={beginTimerEdit}
																title={isTimerRunning ? undefined : "Click to set a duration"}
															>
																{minuteDigitItems.map(({ digit, key }) => (
																	<RollDigit key={key} value={digit} compact={clockCompact} />
																))}
																<span className="timer-colon">:</span>
																{secondDigitItems.map(({ digit, key }) => (
																	<RollDigit key={key} value={digit} compact={clockCompact} />
																))}
															</div>
															<span className="timer-edit-underline" aria-hidden="true" />
															{isEditingTimer && (
																<input
																	ref={timerInputRef}
																	className="timer-edit-input"
																	type="text"
																	inputMode="numeric"
																	aria-label="Set timer duration"
																	value={formatTimerDigits(timerEditDigits)}
																	onChange={(e) =>
																		setTimerEditDigits(
																			e.target.value.replace(/\D/g, "").slice(0, 5)
																		)
																	}
																	onKeyDown={(e) => {
																		if (e.key === "Enter") commitTimerEdit(true);
																	}}
																	onBlur={() => commitTimerEdit(false)}
																	onWheel={(e) => e.stopPropagation()}
																/>
															)}
														</div>
													</div>

													<div className="timer-controls-row">
														<span className="timer-controls-spacer" aria-hidden="true" />
														<button
															onClick={handlePrimaryTimerAction}
															onMouseDown={(e) => e.preventDefault()}
															className="timer-btn-play"
															title={primaryTimerLabel}
														>
															{isTimerRunning ? (
																<Pause size={14} strokeWidth={2} fill="currentColor" />
															) : (
																<Play size={14} strokeWidth={2} fill="currentColor" />
															)}
															<span>{primaryTimerLabel}</span>
														</button>
														<button
															onClick={resetTimer}
															aria-label="Reset timer"
															title="Reset timer"
															className="timer-btn-reset"
															disabled={timerSeconds === 0 && !isTimerFinished}
														>
															<RotateCcw size={14} strokeWidth={2.5} />
														</button>
													</div>

													<div className="timer-preset-group">
														{[5, 15, 25, 50].map((mins) => (
															<button
																key={mins}
																onClick={() => startTimer(mins * 60)}
																className={`timer-preset-segment ${lastDurationSeconds === mins * 60 && !isTimerFinished ? "active" : ""}`}
															>
																{mins}m
															</button>
														))}
													</div>
												</div>
											</div>
										</motion.div>
									)}
								</AnimatePresence>

								{/* Shelf Panel */}
								<AnimatePresence>
									{bloomMode === "shelf" && (
										<motion.div
											className="shelf-content"
											onClick={(e) => e.stopPropagation()}
											onWheel={handleShelfWheel}
											initial={{ opacity: 0 }}
											animate={{ opacity: 1 }}
											exit={{ opacity: 0, filter: "blur(4px)", transition: { duration: 0.1 } }}
											transition={ISLAND_SPRING}
										>
											{shelfNotice && <div className="shelf-notice">{shelfNotice}</div>}
											{shelfItems.length === 0 ? (
												<div className="shelf-empty">
													<span>Drop files or selected text here</span>
												</div>
											) : (
												<div
													className={`shelf-items-grid ${shelfOverflowing ? "overflowing" : ""}`}
													ref={shelfGridRef}
												>
													<AnimatePresence mode="popLayout" onExitComplete={measureShelfOverflow}>
														{shelfItems.map((item) => {
															const preview = item.path ? shelfThumbs[item.path] : undefined;
															const thumb = preview?.thumb;
															return (
																<motion.div
																	key={item.id}
																	layout
																	initial={
																		shelfNewIdsRef.current.has(item.id)
																			? { opacity: 0, scale: 0.82 }
																			: false
																	}
																	animate={{ opacity: 1, scale: 1 }}
																	exit={{
																		opacity: 0,
																		scale: 0.82,
																		transition: { duration: 0.16, ease: "easeOut" }
																	}}
																	transition={{
																		type: "spring",
																		stiffness: 520,
																		damping: 38,
																		mass: 0.7
																	}}
																	className={`shelf-tile ${item.type === "text" || (!thumb && preview?.text) ? "is-text" : ""}`}
																	title={
																		item.type === "text" ? item.text?.slice(0, 1000) : item.path
																	}
																	onPointerDown={(e) => handleShelfPointerDown(e, item)}
																	onPointerMove={(e) => handleShelfPointerMove(e, item)}
																	onClick={(e) => handleShelfTileClick(e, item)}
																>
																	<div className="shelf-tile-preview">
																		{item.type === "text" ? (
																			<div className="shelf-tile-text">
																				<Type
																					size={11}
																					strokeWidth={2}
																					className="shelf-tile-text-icon"
																				/>
																				<span className="shelf-tile-text-body">{item.text}</span>
																			</div>
																		) : !thumb && preview?.text ? (
																			// A document or text file: its opening text,
																			// marked with its type's icon.
																			<div className="shelf-tile-text">
																				<ShelfTypeIcon
																					name={item.name}
																					folder={false}
																					size={11}
																					className="shelf-tile-text-icon"
																				/>
																				<span className="shelf-tile-text-body">{preview.text}</span>
																			</div>
																		) : (
																			<>
																				<div className="shelf-tile-placeholder">
																					{preview && !thumb ? (
																						<ShelfTypeIcon
																							name={item.name}
																							folder={preview.folder}
																						/>
																					) : null}
																				</div>
																				{thumb ? (
																					<img src={thumb} alt="" draggable={false} />
																				) : null}
																			</>
																		)}
																	</div>
																	<span className="shelf-tile-name">
																		{item.type === "text"
																			? `Text · ${item.text?.length ?? 0} chars`
																			: item.name}
																	</span>
																	<button
																		className="shelf-tile-remove"
																		title="Remove from shelf"
																		onClick={(e) => {
																			e.stopPropagation();
																			removeShelfItem(item.id);
																		}}
																	>
																		<X size={11} strokeWidth={2.5} />
																	</button>
																</motion.div>
															);
														})}
													</AnimatePresence>
												</div>
											)}
										</motion.div>
									)}
								</AnimatePresence>
							</motion.div>
						)}
					</AnimatePresence>
				</motion.div>
				{/* Bubbles: one row beside the pill, in the order things started,
				    headphones pinned last. The whole group stays centred. */}
				<motion.div
					className="bubble-row"
					ref={bubbleRowRef}
					style={{
						// Vertically centred on the collapsed pill.
						[notchEdge === "bottom" ? "bottom" : "top"]: Math.max(0, pillInset)
					}}
					initial={false}
					animate={{ x: pillTargetWidth / 2 + bubbleShift + 8 }}
					transition={reduceMotion ? REDUCED_TRANSITION : ISLAND_SPRING}
				>
					<AnimatePresence mode="popLayout" onExitComplete={() => reportNotchRect.current()}>
						{visibleBubbles.map((b) => (
							<motion.button
								key={b.id}
								layout
								type="button"
								className={`activity-bubble island-bubble sig-${b.signal ?? "none"}`}
								aria-label={b.label}
								title={b.label}
								// Splits off the pill like a drop, and merges back the same way.
								style={{ width: bubbleSize, height: bubbleSize, minWidth: bubbleSize }}
								initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.35, x: -30, borderRadius: bubbleSize / 3 }}
								animate={{ opacity: 1, scale: 1, x: 0, borderRadius: bubbleSize / 2 }}
								exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.35, x: -30 }}
								transition={reduceMotion ? REDUCED_TRANSITION : ISLAND_SPRING}
								onAnimationComplete={() => reportNotchRect.current()}
								onClick={(e) => {
									e.stopPropagation();
									b.onClick();
								}}
							>
								{b.progress != null && (
									<svg className="bubble-ring" viewBox="0 0 32 32" aria-hidden="true">
										<circle className="bubble-ring-track" cx="16" cy="16" r="14" />
										<circle
											className="bubble-ring-fill"
											cx="16"
											cy="16"
											r="14"
											strokeDasharray={`${Math.max(0, Math.min(1, b.progress)) * 87.96} 87.96`}
										/>
									</svg>
								)}
								{/* Liquid neck: a bridge to the shape on the left that thins
								    and snaps as the bubble separates (and reforms as it merges). */}
								{!reduceMotion && (
									<motion.span
										className="bubble-neck"
										aria-hidden="true"
										style={{ height: bubbleSize * 0.5, top: bubbleSize * 0.25 }}
										initial={{ scaleY: 1, scaleX: 1, opacity: 1 }}
										animate={{ scaleY: 0, scaleX: 0.4, opacity: 0 }}
										exit={{ scaleY: 1, scaleX: 1, opacity: 1 }}
										transition={{ ...ISLAND_SPRING, opacity: { duration: 0.35, delay: 0.05 } }}
									/>
								)}
								{b.spinner && <span className="bubble-spinner" aria-hidden="true" />}
								{b.content}
							</motion.button>
						))}
					</AnimatePresence>
				</motion.div>
			</div>
		</div>
		</MotionConfig>
	);
}

function Calendar() {
	const [date] = useState(new Date());

	const daysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
	const firstDayOfMonth = (year: number, month: number) => new Date(year, month, 1).getDay();

	const currentMonth = date.getMonth();
	const currentYear = date.getFullYear();
	const monthName = date.toLocaleString("default", { month: "long" });

	const totalDays = daysInMonth(currentYear, currentMonth);
	const startDay = firstDayOfMonth(currentYear, currentMonth);
	const days = [];

	// Padding for start of month
	for (let i = 0; i < startDay; i++) {
		days.push(<div key={`empty-${i}`} className="calendar-day empty" />);
	}

	// Actual days
	const today = new Date().getDate();
	const isCurrentMonth =
		new Date().getMonth() === currentMonth && new Date().getFullYear() === currentYear;

	for (let i = 1; i <= totalDays; i++) {
		days.push(
			<div key={i} className={`calendar-day ${isCurrentMonth && i === today ? "today" : ""}`}>
				{i}
			</div>
		);
	}

	return (
		<div className="calendar-container">
			<div className="calendar-header">
				<span className="month-year">
					{monthName} {currentYear}
				</span>
			</div>
			<div className="calendar-grid">
				{["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
					<div key={`${d}-${i}`} className="day-name">
						{d}
					</div>
				))}
				{days}
			</div>
		</div>
	);
}

function BluetoothIcon() {
	return (
		<svg
			width="18"
			height="18"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2.5"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<path d="M6.5 6.5l11 11L12 23V1l5.5 5.5-11 11" />
		</svg>
	);
}

function SettingsIcon() {
	return (
		<svg
			width="14"
			height="14"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2.5"
			strokeLinecap="round"
			strokeLinejoin="round"
			style={{ opacity: 0.9 }}
		>
			<circle cx="12" cy="12" r="3" />
			<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
		</svg>
	);
}

function BrightnessLowIcon() {
	return (
		<svg
			width="12"
			height="12"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			style={{ opacity: 0.5 }}
		>
			<circle cx="12" cy="12" r="5" fill="currentColor" />
		</svg>
	);
}

function MoonIcon() {
	return (
		<svg
			width="18"
			height="18"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2.5"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
		</svg>
	);
}

function DockIcon() {
	return (
		<svg
			width="18"
			height="18"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2.5"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<rect x="2" y="14" width="20" height="8" rx="2" />
			<line x1="6" y1="18" x2="6.01" y2="18" strokeWidth="3.5" strokeLinecap="round" />
			<line x1="10" y1="18" x2="10.01" y2="18" strokeWidth="3.5" strokeLinecap="round" />
			<line x1="14" y1="18" x2="14.01" y2="18" strokeWidth="3.5" strokeLinecap="round" />
			<line x1="18" y1="18" x2="18.01" y2="18" strokeWidth="3.5" strokeLinecap="round" />
		</svg>
	);
}

function NotchIcon() {
	return (
		<svg
			width="18"
			height="18"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2.5"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<path d="M4 3h16a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
			<path d="M9 9v4a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2V9" />
		</svg>
	);
}

function BellIcon() {
	return (
		<svg
			width="14"
			height="14"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2.5"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9z" />
			<path d="M13.73 21a2 2 0 0 1-3.46 0" />
		</svg>
	);
}

function ReloadIcon() {
	return (
		<svg
			width="14"
			height="14"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2.5"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
		</svg>
	);
}

function BatterySaverIcon() {
	return (
		<svg
			width="18"
			height="18"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2.5"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<rect x="2" y="7" width="16" height="10" rx="2" />
			<path d="M22 11v2" />
			<path d="M6 12h4l2-3v6l-2-3H6" />
		</svg>
	);
}

export default App;
