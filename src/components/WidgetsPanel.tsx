import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
	DndContext,
	DragOverlay,
	KeyboardSensor,
	PointerSensor,
	closestCenter,
	useSensor,
	useSensors,
	type DragEndEvent,
	type DragStartEvent
} from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
	AppWindow,
	ArrowUpDown,
	BatteryCharging,
	BatteryMedium,
	Cloud,
	CloudRain,
	CloudSnow,
	Coffee,
	Columns2,
	Cpu,
	HardDrive,
	Headphones,
	Image as ImageIcon,
	Lock,
	Maximize2,
	MemoryStick,
	Minimize2,
	Minus,
	Music,
	Pause,
	Pencil,
	Play,
	Plus,
	RotateCcw,
	Scissors,
	Search,
	SkipBack,
	SkipForward,
	Sun,
	Sunrise,
	Sunset
} from "lucide-react";
import { CATALOG, CATEGORIES, DEFAULT_LAYOUT, addedSingles, moonName, moonPhase, parseLayout, type WidgetItem, type WidgetSize } from "../widgetsLayout";
import { reorderAnnouncements, reorderInstructions } from "./reorderA11y";
import { aqiLabel, getAirQuality, getWeather, peekWeather, quoteOfTheDay, type WeatherData } from "./widgetData";

// ── What the island passes in ──
export interface WidgetData {
	cpu: number;
	ram: number;
	disk: number;
	netUp: number;
	netDown: number;
	events: { id: string; title: string; start: string; allDay: boolean }[];
	shelfCount: number;
	onOpenShelf: () => void;
	timerText: string | null;
	battery: number;
	charging: boolean;
	headset: { name: string; value: string | null } | null;
	media: { hasMedia: boolean; title: string; artist: string; art: string | null; isPlaying: boolean };
	onPlayPause: () => void;
	onPrev: () => void;
	onNext: () => void;
	startTimer: (seconds: number) => void;
	keepAwake: boolean;
	toggleKeepAwake: () => void;
	openSearch: () => void;
	snap: (layout: string) => void;
	screenshot: () => void;
	onPinChange: (pinned: boolean) => void;
}

const ZONES = ["UTC", "Europe/London", "Europe/Berlin", "America/New_York", "America/Los_Angeles", "Asia/Dubai", "Asia/Kolkata", "Asia/Singapore", "Asia/Tokyo", "Australia/Sydney"];

function saveLayout(layout: WidgetItem[]) {
	const json = JSON.stringify(layout);
	try {
		localStorage.setItem("bloom-widgets-layout", json);
	} catch {
		/* ignore */
	}
	invoke("save_setting", { key: "bloom-widgets-layout", value: json }).catch(() => {});
}

const fmtRate = (b: number) =>
	b < 1024 ? `${Math.round(b)} B/s` : b < 1048576 ? `${Math.round(b / 1024)} KB/s` : `${(b / 1048576).toFixed(1)} MB/s`;
const fmtGB = (b: number) => `${Math.round(b / 1073741824)} GB`;
function wxIcon(code: number) {
	if (code >= 71 && code <= 86) return CloudSnow;
	if (code >= 51) return CloudRain;
	if (code >= 2) return Cloud;
	return Sun;
}

/** Loading skeleton, and "Couldn't load · Retry". */
function Skeleton() {
	return (
		<div className="widget-skeleton" aria-label="Loading">
			<span />
			<span />
		</div>
	);
}
function Failed({ retry, what }: { retry: () => void; what: string }) {
	return (
		<span className="home-muted">
			Couldn't load {what}.{" "}
			<button type="button" className="home-see-all" onClick={retry}>
				Retry
			</button>
		</span>
	);
}

/** Weather data with a 10 s timeout, a skeleton and Retry. */
function useWeatherState() {
	const [data, setData] = useState<WeatherData | null>(peekWeather);
	const [failed, setFailed] = useState(false);
	const [attempt, setAttempt] = useState(0);
	useEffect(() => {
		let cancelled = false;
		setFailed(false);
		const timeout = setTimeout(() => !cancelled && setFailed(true), 10000);
		getWeather(attempt > 0)
			.then((d) => {
				if (!cancelled) {
					setData(d);
					clearTimeout(timeout);
				}
			})
			.catch(() => !cancelled && setFailed(true));
		return () => {
			cancelled = true;
			clearTimeout(timeout);
		};
	}, [attempt]);
	return { data, failed: failed && !data, retry: () => setAttempt((a) => a + 1) };
}

// ── Widget bodies ──
function WeatherHourly({ size }: { size: WidgetSize }) {
	const { data, failed, retry } = useWeatherState();
	if (failed) return <Failed retry={retry} what="weather" />;
	if (!data) return <Skeleton />;
	return (
		<>
			<span className="widget-title">{data.city || "Weather"}</span>
			<div className="widget-hours">
				{(size === "large" ? data.hourly : data.hourly.slice(0, 3)).map((h) => {
					const Icon = wxIcon(h.code);
					return (
						<div key={h.time} className="widget-hour">
							<span>{h.time}</span>
							<Icon size={15} />
							<span className="widget-hour-temp">{h.temp}°</span>
						</div>
					);
				})}
			</div>
		</>
	);
}

function WeatherNow() {
	const { data, failed, retry } = useWeatherState();
	if (failed) return <Failed retry={retry} what="weather" />;
	if (!data) return <Skeleton />;
	const Icon = wxIcon(data.now.code);
	const today = data.daily[0];
	return (
		<>
			<span className="widget-title">{data.city || "Now"}</span>
			<span className="widget-big">
				<Icon size={18} /> {data.now.temp}°
			</span>
			{today && <span className="widget-sub">H {today.max}° · L {today.min}°</span>}
		</>
	);
}

function Forecast({ size }: { size: WidgetSize }) {
	const { data, failed, retry } = useWeatherState();
	if (failed) return <Failed retry={retry} what="the forecast" />;
	if (!data) return <Skeleton />;
	return (
		<>
			<span className="widget-title">5-Day Forecast</span>
			<div className="widget-hours">
				{data.daily.slice(0, size === "large" ? 5 : 3).map((d) => {
					const Icon = wxIcon(d.code);
					return (
						<div key={d.date} className="widget-hour">
							<span>{new Date(d.date).toLocaleDateString([], { weekday: "short" })}</span>
							<Icon size={15} />
							<span className="widget-hour-temp">{d.max}°</span>
							<span className="widget-sub">{d.min}°</span>
						</div>
					);
				})}
			</div>
		</>
	);
}

function SunTimes() {
	const { data, failed, retry } = useWeatherState();
	if (failed) return <Failed retry={retry} what="sun times" />;
	if (!data || !data.daily[0]) return <Skeleton />;
	const t = (s: string) => new Date(s).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
	return (
		<>
			<span className="widget-title">Sun</span>
			<span className="widget-device">
				<Sunrise size={14} /> Sunrise <span className="widget-accent">{t(data.daily[0].sunrise)}</span>
			</span>
			<span className="widget-device">
				<Sunset size={14} /> Sunset <span className="widget-accent">{t(data.daily[0].sunset)}</span>
			</span>
		</>
	);
}

function AirQuality() {
	const [aqi, setAqi] = useState<number | null>(null);
	const [failed, setFailed] = useState(false);
	const [attempt, setAttempt] = useState(0);
	useEffect(() => {
		let cancelled = false;
		setFailed(false);
		const timeout = setTimeout(() => !cancelled && setFailed(true), 10000);
		getAirQuality()
			.then((v) => {
				if (!cancelled) {
					setAqi(v);
					clearTimeout(timeout);
				}
			})
			.catch(() => !cancelled && setFailed(true));
		return () => {
			cancelled = true;
			clearTimeout(timeout);
		};
	}, [attempt]);
	if (failed && aqi === null) return <Failed retry={() => setAttempt((a) => a + 1)} what="air quality" />;
	if (aqi === null) return <Skeleton />;
	return (
		<>
			<span className="widget-title">Air Quality</span>
			<span className="widget-big">{aqi}</span>
			<span className="widget-sub">{aqiLabel(aqi)} · European AQI</span>
		</>
	);
}

function Moon() {
	const p = moonPhase(new Date());
	const lit = Math.round((1 - Math.abs(1 - 2 * p)) * 100);
	return (
		<>
			<span className="widget-title">Moon</span>
			<span className="widget-moon" aria-hidden="true" style={{ "--lit": `${p < 0.5 ? 100 - lit : lit - 100}%` } as React.CSSProperties} />
			<span className="widget-sub">
				{moonName(p)} · {lit}%
			</span>
		</>
	);
}

/** Re-renders only itself every `ms` (clocks and progress). */
function useNow(ms: number) {
	const [now, setNow] = useState(() => new Date());
	useEffect(() => {
		const t = setInterval(() => setNow(new Date()), ms);
		return () => clearInterval(t);
	}, [ms]);
	return now;
}

const Clock = memo(function Clock({ analog }: { analog: boolean }) {
	const now = useNow(analog ? 1000 : 15000);
	if (!analog) {
		return (
			<>
				<span className="widget-title">{now.toLocaleDateString([], { weekday: "long" })}</span>
				<span className="widget-big">{now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
			</>
		);
	}
	const h = ((now.getHours() % 12) + now.getMinutes() / 60) * 30;
	const m = now.getMinutes() * 6;
	const s = now.getSeconds() * 6;
	return (
		<svg viewBox="0 0 100 100" className="widget-analog" role="img" aria-label={now.toLocaleTimeString()}>
			<circle cx="50" cy="50" r="46" />
			{Array.from({ length: 12 }, (_, i) => (
				<line key={i} x1="50" y1="8" x2="50" y2="14" transform={`rotate(${i * 30} 50 50)`} />
			))}
			<line className="hand-h" x1="50" y1="50" x2="50" y2="28" transform={`rotate(${h} 50 50)`} />
			<line className="hand-m" x1="50" y1="50" x2="50" y2="16" transform={`rotate(${m} 50 50)`} />
			<line className="hand-s" x1="50" y1="54" x2="50" y2="14" transform={`rotate(${s} 50 50)`} />
		</svg>
	);
});

const WorldClock = memo(function WorldClock({ zone }: { zone: string }) {
	const now = useNow(15000);
	let time = "—";
	try {
		time = now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone: zone });
	} catch {
		/* bad zone */
	}
	return (
		<>
			<span className="widget-title">{zone.split("/").pop()?.replace(/_/g, " ")}</span>
			<span className="widget-big">{time}</span>
		</>
	);
});

function Progress({ label, pct, sub }: { label: string; pct: number; sub: string }) {
	return (
		<>
			<span className="widget-title">
				{label} <span className="widget-accent">{Math.round(pct)}%</span>
			</span>
			<span className="widget-bar large" aria-hidden="true">
				<span style={{ width: `${pct}%` }} />
			</span>
			<span className="widget-sub">{sub}</span>
		</>
	);
}

const DayProgress = memo(function DayProgress() {
	const now = useNow(60000);
	const start = new Date(now);
	start.setHours(0, 0, 0, 0);
	const pct = ((now.getTime() - start.getTime()) / 86400000) * 100;
	const left = 24 - (now.getHours() + now.getMinutes() / 60);
	return <Progress label="Today" pct={pct} sub={`${Math.floor(left)} h ${Math.round((left % 1) * 60)} min left`} />;
});

const YearProgress = memo(function YearProgress() {
	const now = useNow(3600000);
	const start = new Date(now.getFullYear(), 0, 1).getTime();
	const end = new Date(now.getFullYear() + 1, 0, 1).getTime();
	const pct = ((now.getTime() - start) / (end - start)) * 100;
	return <Progress label={String(now.getFullYear())} pct={pct} sub={`${Math.ceil((end - now.getTime()) / 86400000)} days left`} />;
});

const MonthProgress = memo(function MonthProgress() {
	const now = useNow(3600000);
	const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
	const day = now.getDate();
	return (
		<>
			<span className="widget-title">
				{now.toLocaleDateString([], { month: "long" })} <span className="widget-accent">{Math.round((day / days) * 100)}%</span>
			</span>
			<div className="widget-dots" aria-hidden="true">
				{Array.from({ length: days }, (_, i) => (
					<span key={i} className={`widget-dot ${i + 1 < day ? "past" : i + 1 === day ? "today" : ""}`} />
				))}
			</div>
		</>
	);
});

const CalMonth = memo(function CalMonth() {
	const now = useNow(3600000);
	const first = new Date(now.getFullYear(), now.getMonth(), 1);
	const offset = (first.getDay() + 6) % 7;
	const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
	return (
		<>
			<span className="widget-title">{now.toLocaleDateString([], { month: "long", year: "numeric" })}</span>
			<div className="widget-cal">
				{["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
					<span key={`h${i}`} className="widget-cal-head">
						{d}
					</span>
				))}
				{Array.from({ length: offset }, (_, i) => (
					<span key={`e${i}`} />
				))}
				{Array.from({ length: days }, (_, i) => (
					<span key={i} className={i + 1 === now.getDate() ? "today" : ""}>
						{i + 1}
					</span>
				))}
			</div>
		</>
	);
});

function Countdown({ item, editing, setOpts }: { item: WidgetItem; editing: boolean; setOpts: (o: Record<string, unknown>) => void }) {
	const now = useNow(3600000);
	const name = String(item.opts?.name ?? "Holiday");
	const date = String(item.opts?.date ?? `${now.getFullYear()}-12-25`);
	const target = new Date(`${date}T00:00:00`);
	const days = Math.ceil((target.getTime() - now.getTime()) / 86400000);
	if (editing) {
		return (
			<div className="widget-form" onPointerDown={(e) => e.stopPropagation()}>
				<input aria-label="Countdown name" value={name} onChange={(e) => setOpts({ ...item.opts, name: e.target.value })} />
				<input aria-label="Countdown date" type="date" value={date} onChange={(e) => setOpts({ ...item.opts, date: e.target.value })} />
			</div>
		);
	}
	return (
		<>
			<span className="widget-title" title={name}>
				{name}
			</span>
			<span className="widget-big">{Number.isFinite(days) ? Math.max(0, days) : "—"}</span>
			<span className="widget-sub">{days === 1 ? "day left" : "days left"}</span>
		</>
	);
}

function Note({ item, setOpts, d }: { item: WidgetItem; setOpts: (o: Record<string, unknown>) => void; d: WidgetData }) {
	const [text, setText] = useState(String(item.opts?.text ?? ""));
	const save = useRef<ReturnType<typeof setTimeout> | null>(null);
	return (
		<>
			<span className="widget-title">Note</span>
			<textarea
				className="widget-note"
				aria-label="Quick note"
				placeholder="Write something…"
				value={text}
				onPointerDown={(e) => {
					e.stopPropagation();
					const el = e.currentTarget;
					invoke("focus_island").catch(() => {}).finally(() => setTimeout(() => el.focus(), 30));
				}}
				onFocus={() => d.onPinChange(true)}
				onBlur={() => {
					d.onPinChange(false);
					setOpts({ ...item.opts, text });
				}}
				onChange={(e) => {
					setText(e.target.value);
					if (save.current) clearTimeout(save.current);
					const v = e.target.value;
					save.current = setTimeout(() => setOpts({ ...item.opts, text: v }), 600);
				}}
			/>
		</>
	);
}

function Stopwatch() {
	const [start, setStart] = useState<number | null>(null);
	const [acc, setAcc] = useState(0);
	const [, tick] = useState(0);
	useEffect(() => {
		if (start === null) return;
		const t = setInterval(() => tick((n) => n + 1), 100);
		return () => clearInterval(t);
	}, [start]);
	const ms = acc + (start !== null ? Date.now() - start : 0);
	const s = Math.floor(ms / 1000);
	const text = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}.${Math.floor((ms % 1000) / 100)}`;
	return (
		<>
			<span className="widget-title">Stopwatch</span>
			<span className="widget-big">{text}</span>
			<div className="widget-row">
				<button
					type="button"
					className="widget-icon-btn"
					aria-label={start === null ? "Start stopwatch" : "Stop stopwatch"}
					title={start === null ? "Start" : "Stop"}
					onClick={() => {
						if (start === null) setStart(Date.now());
						else {
							setAcc(acc + Date.now() - start);
							setStart(null);
						}
					}}
				>
					{start === null ? <Play size={14} /> : <Pause size={14} />}
				</button>
				<button type="button" className="widget-icon-btn" aria-label="Reset stopwatch" title="Reset" onClick={() => {
					setStart(null);
					setAcc(0);
				}}>
					<RotateCcw size={14} />
				</button>
			</div>
		</>
	);
}

/** A tiny line graph of the last values. */
function Sparkline({ values, max, transfer }: { values: number[]; max: number; transfer?: boolean }) {
	const w = 100;
	const h = 30;
	const pts = values.map((v, i) => `${(i / Math.max(1, values.length - 1)) * w},${h - (Math.min(v, max) / max) * h}`).join(" ");
	return (
		<svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={`widget-spark ${transfer ? "transfer" : ""}`} aria-hidden="true">
			<polyline points={pts} />
		</svg>
	);
}

function useHistory(value: number, size = 30) {
	const ref = useRef<number[]>([]);
	const last = useRef<number | null>(null);
	if (last.current !== value) {
		ref.current = [...ref.current, value].slice(-size);
		last.current = value;
	}
	return ref.current;
}

function CpuGraph({ cpu }: { cpu: number }) {
	const hist = useHistory(cpu);
	return (
		<>
			<span className="widget-title">
				CPU <span className="widget-accent">{Math.round(cpu)}%</span>
			</span>
			<Sparkline values={hist} max={100} />
		</>
	);
}

function NetGraph({ down, up }: { down: number; up: number }) {
	const hist = useHistory(down);
	const max = Math.max(1024, ...hist);
	return (
		<>
			<span className="widget-title">
				Network <span className="widget-accent">↓{fmtRate(down)}</span>
			</span>
			<Sparkline values={hist} max={max} transfer />
			<span className="widget-sub">↑{fmtRate(up)}</span>
		</>
	);
}

function Storage({ size }: { size: WidgetSize }) {
	const [drives, setDrives] = useState<{ root: string; free: number; total: number }[] | null>(null);
	useEffect(() => {
		invoke<{ root: string; free: number; total: number }[]>("widget_drives").then(setDrives).catch(() => setDrives([]));
	}, []);
	if (!drives) return <Skeleton />;
	return (
		<>
			<span className="widget-title">Storage</span>
			<div className="widget-list">
				{drives.slice(0, size === "large" ? 4 : 2).map((d) => (
					<div key={d.root} className="widget-drive">
						<span className="widget-device">
							<HardDrive size={13} /> {d.root.replace("\\", "")}
							<span className="widget-accent">{fmtGB(d.free)} free</span>
						</span>
						<span className="widget-bar" aria-hidden="true">
							<span style={{ width: `${d.total ? ((d.total - d.free) / d.total) * 100 : 0}%` }} />
						</span>
					</div>
				))}
			</div>
		</>
	);
}

const Uptime = memo(function Uptime() {
	const [ms, setMs] = useState<number | null>(null);
	useEffect(() => {
		const read = () => invoke<number>("widget_uptime").then(setMs).catch(() => {});
		read();
		const t = setInterval(read, 60000);
		return () => clearInterval(t);
	}, []);
	if (ms === null) return <Skeleton />;
	const mins = Math.floor(ms / 60000);
	const days = Math.floor(mins / 1440);
	const hours = Math.floor((mins % 1440) / 60);
	return (
		<>
			<span className="widget-title">Uptime</span>
			<span className="widget-big">{days > 0 ? `${days}d ${hours}h` : `${hours}h ${mins % 60}m`}</span>
			<span className="widget-sub">since Windows started</span>
		</>
	);
});

function QuickActions({ d, size }: { d: WidgetData; size: WidgetSize }) {
	const actions: [string, ReactNode, () => void, boolean?][] = [
		["Keep Awake", <Coffee size={15} />, d.toggleKeepAwake, d.keepAwake],
		["Snap", <Columns2 size={15} />, () => d.snap("left")],
		["Search", <Search size={15} />, d.openSearch],
		["Screenshot", <Scissors size={15} />, d.screenshot],
		["Lock", <Lock size={15} />, () => invoke("widget_lock_pc").catch(() => {})]
	];
	return (
		<>
			<span className="widget-title">Quick Actions</span>
			<div className={`widget-actions ${size}`}>
				{(size === "large" ? actions : actions.slice(0, 4)).map(([label, icon, run, on]) => (
					<button
						key={label}
						type="button"
						className={`widget-action ${on ? "on" : ""}`}
						aria-label={label}
						aria-pressed={on === undefined ? undefined : on}
						title={label}
						onClick={run}
					>
						{icon}
						{size === "large" && <span>{label}</span>}
					</button>
				))}
			</div>
		</>
	);
}

function AppLauncher({ item, editing, setOpts, size }: { item: WidgetItem; editing: boolean; setOpts: (o: Record<string, unknown>) => void; size: WidgetSize }) {
	const apps = (item.opts?.apps as { name: string; path: string }[] | undefined) ?? [];
	const [icons, setIcons] = useState<Record<string, string | null>>({});
	const [picking, setPicking] = useState(false);
	const [all, setAll] = useState<{ name: string; path: string }[]>([]);
	const [q, setQ] = useState("");
	useEffect(() => {
		for (const a of apps) {
			if (a.path in icons) continue;
			invoke<string | null>("get_app_icon", { path: a.path, name: a.name, hwnd: null })
				.then((ic) => setIcons((p) => ({ ...p, [a.path]: ic })))
				.catch(() => {});
		}
	}, [apps, icons]);
	const max = size === "large" ? 6 : 4;
	return (
		<>
			<span className="widget-title">Apps</span>
			<div className="widget-apps">
				{apps.slice(0, max).map((a) => (
					<button
						key={a.path}
						type="button"
						className="widget-app"
						aria-label={editing ? `Remove ${a.name}` : `Open ${a.name}`}
						title={a.name}
						onPointerDown={(e) => editing && e.stopPropagation()}
						onClick={() =>
							editing
								? setOpts({ ...item.opts, apps: apps.filter((x) => x.path !== a.path) })
								: invoke("open_app", { appName: a.path }).catch(() => {})
						}
					>
						{icons[a.path] ? <img src={icons[a.path]!} alt="" /> : <AppWindow size={16} />}
					</button>
				))}
				{editing && apps.length < max && (
					<button
						type="button"
						className="widget-app add"
						aria-label="Pin an app"
						title="Pin an app"
						onPointerDown={(e) => e.stopPropagation()}
						onClick={() => {
							setPicking(true);
							if (all.length === 0)
								invoke<{ name: string; path: string }[]>("get_installed_apps")
									.then((l) => setAll([...l].sort((x, y) => x.name.localeCompare(y.name))))
									.catch(() => {});
						}}
					>
						<Plus size={14} />
					</button>
				)}
				{!editing && apps.length === 0 && <span className="home-muted">Pin apps in Edit Widgets</span>}
			</div>
			{editing && picking && (
				<div className="widget-picker" onPointerDown={(e) => e.stopPropagation()}>
					<input aria-label="Search apps" placeholder="Search apps" value={q} onChange={(e) => setQ(e.target.value)} />
					<div className="widget-picker-list">
						{all
							.filter((a) => a.name.toLowerCase().includes(q.toLowerCase()))
							.slice(0, 30)
							.map((a) => (
								<button
									key={a.path}
									type="button"
									onClick={() => {
										setOpts({ ...item.opts, apps: [...apps, { name: a.name, path: a.path }] });
										setPicking(false);
									}}
								>
									{a.name}
								</button>
							))}
					</div>
				</div>
			)}
		</>
	);
}

function Photo({ item, editing, setOpts }: { item: WidgetItem; editing: boolean; setOpts: (o: Record<string, unknown>) => void }) {
	const path = item.opts?.path as string | undefined;
	const [src, setSrc] = useState<string | null>(null);
	const [error, setError] = useState("");
	useEffect(() => {
		if (!path) return;
		invoke<string>("widget_image", { path }).then(setSrc).catch((e) => setError(String(e)));
	}, [path]);
	const choose = async () => {
		const picked = await openDialog({ multiple: false, filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp"] }] }).catch(() => null);
		if (typeof picked === "string") {
			setError("");
			setOpts({ ...item.opts, path: picked });
		}
	};
	if (src && !editing) return <img className="widget-photo" src={src} alt="" draggable={false} />;
	return (
		<div className="widget-cta column">
			<ImageIcon size={18} />
			{error && <span className="home-muted">{error}</span>}
			<button type="button" className="widget-cta-btn" onPointerDown={(e) => e.stopPropagation()} onClick={choose}>
				{path ? "Change Photo" : "Choose Photo"}
			</button>
		</div>
	);
}

function body(item: WidgetItem, d: WidgetData, editing: boolean, setOpts: (o: Record<string, unknown>) => void): ReactNode {
	switch (item.kind) {
		case "weather":
			return <WeatherHourly size={item.size} />;
		case "weathernow":
			return <WeatherNow />;
		case "forecast":
			return <Forecast size={item.size} />;
		case "sun":
			return <SunTimes />;
		case "air":
			return <AirQuality />;
		case "moon":
			return <Moon />;
		case "clock":
			return editing ? (
				<label className="widget-form" onPointerDown={(e) => e.stopPropagation()}>
					<span className="widget-title">Clock</span>
					<select aria-label="Clock style" value={item.opts?.analog ? "analog" : "digital"} onChange={(e) => setOpts({ ...item.opts, analog: e.target.value === "analog" })}>
						<option value="digital">Digital</option>
						<option value="analog">Analog</option>
					</select>
				</label>
			) : (
				<Clock analog={!!item.opts?.analog} />
			);
		case "worldclock":
			return editing ? (
				<label className="widget-form" onPointerDown={(e) => e.stopPropagation()}>
					<span className="widget-title">World Clock</span>
					<select aria-label="City" value={String(item.opts?.zone ?? "UTC")} onChange={(e) => setOpts({ ...item.opts, zone: e.target.value })}>
						{ZONES.map((z) => (
							<option key={z} value={z}>
								{z.split("/").pop()?.replace(/_/g, " ")}
							</option>
						))}
					</select>
				</label>
			) : (
				<WorldClock zone={String(item.opts?.zone ?? "UTC")} />
			);
		case "calmonth":
			return <CalMonth />;
		case "month":
			return <MonthProgress />;
		case "day":
			return <DayProgress />;
		case "year":
			return <YearProgress />;
		case "countdown":
			return <Countdown item={item} editing={editing} setOpts={setOpts} />;
		case "todos": {
			let todos: { id: string; text: string; done: boolean }[] = [];
			try {
				todos = JSON.parse(localStorage.getItem("bloom-todos") || "[]");
			} catch {
				/* none */
			}
			const open = todos.filter((t) => !t.done);
			return (
				<>
					<span className="widget-title">
						To-Do <span className="widget-accent">{open.length}</span>
					</span>
					{open.length === 0 ? (
						<span className="home-muted">All done</span>
					) : (
						<ul className="widget-list">
							{open.slice(0, item.size === "large" ? 5 : 3).map((t) => (
								<li key={t.id} title={t.text}>
									{t.text}
								</li>
							))}
						</ul>
					)}
				</>
			);
		}
		case "events": {
			const now = Date.now();
			const next = d.events.filter((e) => e.allDay || new Date(e.start).getTime() >= now).slice(0, item.size === "large" ? 4 : 2);
			return (
				<>
					<span className="widget-title">Next Events</span>
					{d.events.length === 0 ? (
						<div className="widget-cta">
							<span className="home-muted">No calendar</span>
							<button type="button" className="widget-cta-btn" onClick={() => invoke("open_settings_window").catch(() => {})}>
								Connect Calendar
							</button>
						</div>
					) : next.length === 0 ? (
						<span className="home-muted">Nothing coming up</span>
					) : (
						<ul className="widget-list">
							{next.map((e) => (
								<li key={e.id} title={e.title}>
									<span>{e.title}</span>
									<span className="widget-accent">
										{e.allDay ? "All day" : new Date(e.start).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
									</span>
								</li>
							))}
						</ul>
					)}
				</>
			);
		}
		case "note":
			return <Note item={item} setOpts={setOpts} d={d} />;
		case "timer":
			return (
				<>
					<span className="widget-title">Timer</span>
					<span className={`widget-big ${d.timerText ? "timer-on" : ""}`}>{d.timerText ?? "Off"}</span>
				</>
			);
		case "pomodoro":
			return (
				<>
					<span className="widget-title">Pomodoro</span>
					{d.timerText ? (
						<span className="widget-big timer-on">{d.timerText}</span>
					) : (
						<button type="button" className="widget-cta-btn" onClick={() => d.startTimer(25 * 60)}>
							Start 25 min
						</button>
					)}
				</>
			);
		case "stopwatch":
			return <Stopwatch />;
		case "nowplaying":
			return d.media.hasMedia ? (
				<div className={`widget-np ${item.size}`}>
					{d.media.art ? <img src={d.media.art} alt="" /> : <span className="widget-np-art"><Music size={16} /></span>}
					<div className="widget-np-text">
						<span className="widget-title" title={d.media.title}>
							{d.media.title}
						</span>
						<span className="widget-sub" title={d.media.artist}>
							{d.media.artist}
						</span>
						<div className="widget-row">
							<button type="button" className="widget-icon-btn" aria-label="Previous track" title="Previous" onClick={d.onPrev}>
								<SkipBack size={14} />
							</button>
							<button type="button" className="widget-icon-btn" aria-label={d.media.isPlaying ? "Pause" : "Play"} title={d.media.isPlaying ? "Pause" : "Play"} onClick={d.onPlayPause}>
								{d.media.isPlaying ? <Pause size={14} /> : <Play size={14} />}
							</button>
							<button type="button" className="widget-icon-btn" aria-label="Next track" title="Next" onClick={d.onNext}>
								<SkipForward size={14} />
							</button>
						</div>
					</div>
				</div>
			) : (
				<>
					<span className="widget-title">Now Playing</span>
					<span className="home-muted">Nothing playing</span>
				</>
			);
		case "shelf":
			return (
				<>
					<span className="widget-title">Shelf</span>
					<button type="button" className="widget-big widget-link" onClick={d.onOpenShelf}>
						{d.shelfCount} <span className="widget-accent">items</span>
					</button>
				</>
			);
		case "system": {
			const stat = (icon: ReactNode, label: string, value: string, fill?: number, second?: string) => (
				<div className="widget-stat" key={label}>
					<span className="widget-stat-head">
						{icon}
						<span>{label}</span>
					</span>
					<span className="widget-stat-value">{value}</span>
					{second && <span className="widget-stat-value secondary">{second}</span>}
					{fill !== undefined && (
						<span className="widget-bar">
							<span style={{ width: `${Math.min(100, Math.max(0, fill))}%` }} />
						</span>
					)}
				</div>
			);
			const all = [
				stat(<Cpu size={13} />, "CPU", `${Math.round(d.cpu)}%`, d.cpu),
				stat(<MemoryStick size={13} />, "RAM", `${Math.round(d.ram)}%`, d.ram),
				stat(<HardDrive size={13} />, "Disk free", `${Math.round(d.disk)} GB`),
				stat(<ArrowUpDown size={13} />, "Network", `↓${fmtRate(d.netDown)}`, undefined, `↑${fmtRate(d.netUp)}`)
			];
			return (
				<>
					<span className="widget-title">System</span>
					<div className={`widget-stats ${item.size}`}>{item.size === "large" ? all : all.slice(0, 2)}</div>
				</>
			);
		}
		case "cpugraph":
			return <CpuGraph cpu={d.cpu} />;
		case "netgraph":
			return <NetGraph down={d.netDown} up={d.netUp} />;
		case "storage":
			return <Storage size={item.size} />;
		case "devices":
			return (
				<>
					<span className="widget-title">Batteries</span>
					<div className="widget-list">
						<span className="widget-device">
							{d.charging ? <BatteryCharging size={14} /> : <BatteryMedium size={14} />} This PC
							<span className={`widget-accent ${d.charging ? "positive" : d.battery <= 20 ? "alert" : ""}`}>{d.battery}%</span>
						</span>
						{d.headset && (
							<span className="widget-device" title={d.headset.name}>
								<Headphones size={14} /> {d.headset.name}
								<span className="widget-accent">{d.headset.value ?? "On"}</span>
							</span>
						)}
					</div>
				</>
			);
		case "uptime":
			return <Uptime />;
		case "actions":
			return <QuickActions d={d} size={item.size} />;
		case "apps":
			return <AppLauncher item={item} editing={editing} setOpts={setOpts} size={item.size} />;
		case "quote": {
			const [text, who] = quoteOfTheDay();
			return (
				<>
					<span className="widget-title">Quote of the Day</span>
					<span className="widget-quote">“{text}”</span>
					<span className="widget-sub">{who}</span>
				</>
			);
		}
		case "photo":
			return <Photo item={item} editing={editing} setOpts={setOpts} />;
		default:
			return null;
	}
}

function Tile({
	item,
	d,
	editing,
	lifted = false,
	onRemove,
	onResize,
	setOpts
}: {
	item: WidgetItem;
	d: WidgetData;
	editing: boolean;
	lifted?: boolean;
	onRemove: () => void;
	onResize: () => void;
	setOpts: (o: Record<string, unknown>) => void;
}) {
	const { attributes, listeners, setNodeRef, transform, isDragging } = useSortable({ id: item.id, disabled: !editing || lifted });
	const meta = CATALOG[item.kind];
	const style: React.CSSProperties = lifted
		? {}
		: { transform: CSS.Translate.toString(transform), transition: transform ? "transform 320ms cubic-bezier(0.2, 0.9, 0.25, 1.06)" : undefined };
	return (
		<section
			ref={lifted ? undefined : setNodeRef}
			{...(editing ? { ...attributes, ...listeners } : {})}
			onKeyDown={(e) => {
				// Only keys pressed on the tile itself move it (not typing in its fields).
				if (editing && e.target === e.currentTarget) listeners?.onKeyDown?.(e);
			}}
			style={style}
			className={`widget widget-${item.kind} w-${item.size} ${lifted ? "cc-lifted" : isDragging ? "cc-placeholder" : editing ? "widget-editing" : ""}`}
			aria-label={meta.label}
		>
			{body(item, d, editing && !lifted, setOpts)}
			{editing && !lifted && !isDragging && (
				<>
					<button type="button" className="cc-badge cc-badge-remove" aria-label={`Remove ${meta.label}`} title="Remove" onPointerDown={(e) => e.stopPropagation()} onClick={onRemove}>
						<Minus size={10} strokeWidth={3} />
					</button>
					{meta.sizes.length > 1 && (
						<button
							type="button"
							className="cc-badge cc-badge-size"
							aria-label={`Make ${meta.label} ${item.size === "large" ? "small" : "large"}`}
							title={item.size === "large" ? "Make small" : "Make large"}
							onPointerDown={(e) => e.stopPropagation()}
							onClick={onResize}
						>
							{item.size === "large" ? <Minimize2 size={10} strokeWidth={2.6} /> : <Maximize2 size={10} strokeWidth={2.6} />}
						</button>
					)}
				</>
			)}
		</section>
	);
}

/** The Add gallery, grouped by category. */
function Gallery({ layout, onAdd }: { layout: WidgetItem[]; onAdd: (kind: string) => void }) {
	const added = addedSingles(layout);
	return (
		<div className="widget-gallery" role="list" aria-label="Add a widget">
			{CATEGORIES.map((cat) => (
				<div key={cat} className="widget-gallery-group">
					<span className="home-label">{cat}</span>
					{Object.entries(CATALOG)
						.filter(([, m]) => m.category === cat)
						.map(([kind, m]) => {
							const isAdded = added.has(kind);
							return (
								<button key={kind} type="button" role="listitem" className="widget-gallery-item" disabled={isAdded} onClick={() => onAdd(kind)}>
									<span className="widget-gallery-name">{m.label}</span>
									<span className="widget-gallery-desc">{m.desc}</span>
									<span className="widget-gallery-meta">{isAdded ? "Added" : m.sizes.map((s) => (s === "large" ? "Large" : "Small")).join(" · ")}</span>
								</button>
							);
						})}
				</div>
			))}
		</div>
	);
}

/** Home → Widgets: an editable grid, edited like the Command Center. */
export function WidgetsPanel(d: WidgetData) {
	const [layout, setLayout] = useState<WidgetItem[]>(() => parseLayout(localStorage.getItem("bloom-widgets-layout")));
	const [editing, setEditing] = useState(false);
	const [adding, setAdding] = useState(false);
	const [activeId, setActiveId] = useState<string | null>(null);
	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
		useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
	);
	const update = (next: WidgetItem[]) => {
		setLayout(next);
		saveLayout(next);
	};
	const onDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id));
	const onDragEnd = (e: DragEndEvent) => {
		setActiveId(null);
		if (!e.over || e.active.id === e.over.id) return;
		const from = layout.findIndex((w) => w.id === e.active.id);
		const to = layout.findIndex((w) => w.id === e.over!.id);
		if (from >= 0 && to >= 0) update(arrayMove(layout, from, to));
	};
	const active = useMemo(() => layout.find((w) => w.id === activeId) ?? null, [layout, activeId]);
	const setOptsFor = (id: string) => (opts: Record<string, unknown>) => update(layout.map((w) => (w.id === id ? { ...w, opts } : w)));

	return (
		<div className="widgets-board" onClick={(e) => e.stopPropagation()}>
			{adding ? (
				<Gallery
					layout={layout}
					onAdd={(kind) => {
						update([...layout, { id: `${kind}-${Date.now().toString(36)}`, kind, size: CATALOG[kind].sizes[0] }]);
						setAdding(false);
					}}
				/>
			) : (
				<DndContext
					sensors={sensors}
					collisionDetection={closestCenter}
					accessibility={{
						screenReaderInstructions: reorderInstructions,
						announcements: reorderAnnouncements(
							layout.map((w) => w.id),
							(id) => CATALOG[layout.find((w) => w.id === id)?.kind ?? ""]?.label ?? "Widget"
						)
					}}
					onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
					<SortableContext items={layout.map((w) => w.id)} strategy={rectSortingStrategy}>
						<div className="widgets-grid">
							{layout.map((item) => (
								<Tile
									key={item.id}
									item={item}
									d={d}
									editing={editing}
									onRemove={() => update(layout.filter((w) => w.id !== item.id))}
									onResize={() => update(layout.map((w) => (w.id === item.id ? { ...w, size: w.size === "large" ? "small" : "large" } : w)))}
									setOpts={setOptsFor(item.id)}
								/>
							))}
							{layout.length === 0 && <span className="cc-empty">No widgets. Click Edit Widgets, then Add.</span>}
						</div>
					</SortableContext>
					{createPortal(
						<DragOverlay dropAnimation={{ duration: 260, easing: "cubic-bezier(0.2, 0.9, 0.25, 1.06)" }}>
							{active ? <Tile item={active} d={d} editing lifted onRemove={() => {}} onResize={() => {}} setOpts={() => {}} /> : null}
						</DragOverlay>,
						document.body
					)}
				</DndContext>
			)}
			<div className="cc-edit-pill-row">
				{editing && (
					<>
						<button type="button" className="cc-edit-pill" onClick={() => setAdding((a) => !a)}>
							{adding ? "Back" : <><Plus size={13} /> Add</>}
						</button>
						{!adding && (
							<button type="button" className="cc-edit-pill" onClick={() => update(DEFAULT_LAYOUT.map((w) => ({ ...w })))}>
								Reset to Default
							</button>
						)}
					</>
				)}
				<button
					type="button"
					className={`cc-edit-pill ${editing ? "primary" : ""}`}
					onClick={() => {
						setEditing((v) => !v);
						setAdding(false);
					}}
				>
					{editing ? "Done" : <><Pencil size={12} /> Edit Widgets</>}
				</button>
			</div>
		</div>
	);
}
