import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
	Heart,
	FileText,
	ListMusic,
	ListPlus,
	MonitorSpeaker,
	Search as SearchIcon,
	Smartphone,
	Speaker,
	Inbox,
	House,
	LayoutGrid,
	Music,
	Pause,
	Play,
	Plus,
	Repeat,
	Repeat1,
	Shuffle,
	SkipBack,
	SkipForward,
	X
} from "lucide-react";
import { ActivityIcon, type Activity } from "../activities";
import { WidgetsPanel } from "./WidgetsPanel";
import type { SpotifyDevice, SpotifyPlaylist, SpotifyQueue, SpotifyTrack } from "../spotify";

export interface HomeMedia {
	hasMedia: boolean;
	title: string;
	artist: string;
	isPlaying: boolean;
	art: string | null;
	positionMs: number;
	durationMs: number;
	updatedAt: number;
	shuffle: boolean | null;
	repeat: string | null;
	/** Where web media plays, e.g. "YouTube · Brave". */
	sourceLabel?: string | null;
}

export interface SpotifyControls {
	playQueueIndex: (index: number) => Promise<string | null>;
	devices: () => Promise<SpotifyDevice[] | null>;
	transfer: (deviceId: string) => Promise<string | null>;
	search: (query: string) => Promise<SpotifyTrack[]>;
	addToQueue: (uri: string) => Promise<string | null>;
	playNow: (uri: string) => Promise<string | null>;
	playlists: () => Promise<SpotifyPlaylist[]>;
	playPlaylist: (uri: string) => Promise<string | null>;
}

type SpotifyPanel = null | "devices" | "search" | "playlists";

/** Spotify's extra panel inside the music card: devices, search or playlists. */
function SpotifyExtras({ spotify, onPinChange }: { spotify: SpotifyControls; onPinChange: (pinned: boolean) => void }) {
	const [panel, setPanel] = useState<SpotifyPanel>(null);
	const [devices, setDevices] = useState<SpotifyDevice[] | null>(null);
	const [playlists, setPlaylists] = useState<SpotifyPlaylist[] | null>(null);
	const [query, setQuery] = useState("");
	const [results, setResults] = useState<SpotifyTrack[]>([]);
	const [done, setDone] = useState<{ id: string; what: "Added" | "Playing" } | null>(null);

	useEffect(() => {
		if (panel !== "devices") return;
		setDevices(null);
		spotify.devices().then((d) => setDevices(d ?? [])).catch(() => setDevices([]));
	}, [panel, spotify]);

	useEffect(() => {
		// Playlists change rarely: load them once per open of the island.
		if (panel !== "playlists" || playlists !== null) return;
		spotify.playlists().then(setPlaylists).catch(() => setPlaylists([]));
	}, [panel, playlists, spotify]);

	useEffect(() => {
		if (panel !== "search") return;
		const q = query.trim();
		if (!q) {
			setResults([]);
			return;
		}
		// Search as you type, without a request per keystroke.
		const t = setTimeout(() => spotify.search(q).then(setResults).catch(() => setResults([])), 250);
		return () => clearTimeout(t);
	}, [panel, query, spotify]);

	const deviceIcon = (type: string) => (type === "smartphone" ? <Smartphone size={13} /> : type === "computer" ? <MonitorSpeaker size={13} /> : <Speaker size={13} />);
	const tab = (id: Exclude<SpotifyPanel, null>, icon: React.ReactNode, label: string) => (
		<button
			type="button"
			className={`home-chip ${panel === id ? "on" : ""}`}
			aria-pressed={panel === id}
			onClick={() => setPanel(panel === id ? null : id)}
		>
			{icon} {label}
		</button>
	);

	return (
		<div className="home-spotify">
			<div className="home-spotify-tabs">
				{tab("devices", <MonitorSpeaker size={13} />, "Devices")}
				{tab("search", <SearchIcon size={13} />, "Search")}
				{tab("playlists", <ListMusic size={13} />, "Playlists")}
			</div>
			{panel === "devices" && (
				<div className="home-spotify-list" role="list" aria-label="Spotify devices">
					{devices === null ? (
						<span className="home-muted">Looking for devices…</span>
					) : devices.length === 0 ? (
						<span className="home-muted">Open Spotify on a device to see it here.</span>
					) : (
						devices.map((d) => (
							<button
								key={d.id}
								type="button"
								role="listitem"
								className={`home-spotify-row ${d.active ? "on" : ""}`}
								aria-current={d.active ? "true" : undefined}
								aria-label={d.active ? `${d.name}, playing` : `Play on ${d.name}`}
								onClick={() => !d.active && spotify.transfer(d.id).then(() => setPanel(null))}
							>
								{deviceIcon(d.type)}
								<span className="home-queue-name">{d.name}</span>
								{d.active && <span className="home-queue-artist">Playing</span>}
							</button>
						))
					)}
				</div>
			)}
			{panel === "playlists" && (
				<div className="home-spotify-list" role="list" aria-label="Your playlists">
					{playlists === null ? (
						<span className="home-muted">Loading playlists…</span>
					) : playlists.length === 0 ? (
						<span className="home-muted">No playlists yet.</span>
					) : (
						playlists.map((p) => (
							<button
								key={p.id}
								type="button"
								role="listitem"
								className="home-spotify-row"
								aria-label={`Play the playlist ${p.name}`}
								onClick={() =>
									spotify.playPlaylist(p.uri).then((err) => {
										if (!err) setPanel(null);
									})
								}
							>
								{p.art ? <img src={p.art} alt="" /> : <ListMusic size={12} />}
								<span className="home-queue-name">{p.name}</span>
								{p.tracks !== null && <span className="home-queue-artist">{p.tracks} songs</span>}
							</button>
						))
					)}
				</div>
			)}
			{panel === "search" && (
				<div className="home-spotify-list">
					<label className="home-spotify-search">
						<SearchIcon size={13} />
						<input
							value={query}
							placeholder="Search Spotify"
							aria-label="Search Spotify"
							onChange={(e) => setQuery(e.target.value)}
							onPointerDown={(e) => {
								e.stopPropagation();
								const el = e.currentTarget;
								invoke("focus_island").catch(() => {}).finally(() => setTimeout(() => el.focus(), 30));
							}}
							onFocus={() => onPinChange(true)}
							onBlur={() => onPinChange(false)}
							onKeyDown={(e) => {
								if (e.key === "Escape") {
									setPanel(null);
									invoke("restore_foreground").catch(() => {});
								}
							}}
						/>
					</label>
					{results.map((t) => (
						<div key={t.id} className="home-spotify-result">
							<button
								type="button"
								className="home-spotify-row"
								aria-label={`Play ${t.name} by ${t.artist} now`}
								title="Play Now"
								onClick={() =>
									spotify.playNow(t.uri).then((err) => {
										if (!err) setDone({ id: t.id, what: "Playing" });
									})
								}
							>
								{t.art ? <img src={t.art} alt="" /> : <Music size={12} />}
								<span className="home-queue-name">{t.name}</span>
								<span className="home-queue-artist">{done?.id === t.id ? done.what : t.artist}</span>
							</button>
							<button
								type="button"
								className="home-icon-btn"
								aria-label={`Add ${t.name} by ${t.artist} to the queue`}
								title="Add to Queue"
								onClick={() =>
									spotify.addToQueue(t.uri).then((err) => {
										if (!err) setDone({ id: t.id, what: "Added" });
									})
								}
							>
								<ListPlus size={14} />
							</button>
						</div>
					))}
				</div>
			)}
		</div>
	);
}

interface Todo {
	id: string;
	text: string;
	done: boolean;
}

interface Props {
	media: HomeMedia;
	onPrev: () => void;
	onPlayPause: () => void;
	onNext: () => void;
	onShuffle: () => void;
	onRepeat: () => void;
	/** Seek the current song (ms). */
	onSeek: (ms: number) => void;
	/** Spotify controls when Spotify is the active player (needs a connection). */
	spotify: SpotifyControls | null;
	activities: Activity[];
	onActivity: (a: Activity) => void;
	shelfCount: number;
	onOpenShelf: () => void;
	spotifyQueue: SpotifyQueue | null;
	liked: boolean | null;
	onToggleLike: () => void;
	/** Jump to an up-next row of a web player (browser extension). */
	onQueueJump?: (index: number) => void;
	/** Keeps the island open while typing a to-do. */
	onPinChange: (pinned: boolean) => void;
	recentCopies: { id: string; preview: string; detail: string | null; image: boolean; files: string[] }[];
	stats: { cpu: number; ram: number; disk: number; netUp: number; netDown: number };
	events: { id: string; title: string; start: string; allDay: boolean }[];
	timerText: string | null;
	battery: number;
	charging: boolean;
	headset: { name: string; value: string | null } | null;
	onKeepCopy: (id: string) => void;
	startTimer: (seconds: number) => void;
	keepAwake: boolean;
	toggleKeepAwake: () => void;
	openSearch: () => void;
	snap: (layout: string) => void;
	screenshot: () => void;
}

const fmt = (ms: number) => {
	const t = Math.max(0, Math.floor(ms / 1000));
	const h = Math.floor(t / 3600);
	const m = Math.floor((t % 3600) / 60);
	const s = String(t % 60).padStart(2, "0");
	return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
};

function loadTodos(): Todo[] {
	try {
		const raw = JSON.parse(localStorage.getItem("bloom-todos") || "[]");
		return Array.isArray(raw) ? raw.filter((t) => t && typeof t.text === "string") : [];
	} catch {
		return [];
	}
}

function saveTodos(todos: Todo[]) {
	const json = JSON.stringify(todos);
	try {
		localStorage.setItem("bloom-todos", json);
	} catch {
		/* ignore */
	}
	invoke("save_setting", { key: "bloom-todos", value: json }).catch(() => {});
}

/** The wide "Home" view: music on the left, the week and to-dos on the right. */
export function HomePanel(props: Props) {
	const { media } = props;
	const [now, setNow] = useState(() => Date.now());
	const [todos, setTodos] = useState<Todo[]>(loadTodos);
	const [draft, setDraft] = useState("");
	const [tab, setTab] = useState<"home" | "widgets">("home");

	useEffect(() => {
		setNow(Date.now());
		const t = setInterval(() => setNow(Date.now()), media.isPlaying ? 1000 : 30000);
		return () => clearInterval(t);
	}, [media.isPlaying]);

	useEffect(() => {
		const onSync = (e: Event) => {
			const detail = (e as CustomEvent).detail;
			if (detail?.key === "bloom-todos") setTodos(loadTodos());
		};
		window.addEventListener("settings-changed", onSync);
		return () => window.removeEventListener("settings-changed", onSync);
	}, []);

	const update = (next: Todo[]) => {
		setTodos(next);
		saveTodos(next);
	};

	// Next 3 events from now (today and later this week).
	const upcoming = props.events
		.filter((ev) => (ev.allDay ? new Date(ev.start).getTime() + 86400000 : new Date(ev.start).getTime()) >= now)
		.slice(0, 3)
		.map((ev) => {
			const d = new Date(ev.start);
			const sameDay = d.toDateString() === new Date(now).toDateString();
			const when = ev.allDay
				? sameDay
					? "Today"
					: d.toLocaleDateString([], { weekday: "short" })
				: sameDay
					? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
					: `${d.toLocaleDateString([], { weekday: "short" })} ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
			return { id: ev.id, title: ev.title, when };
		});

	const elapsed = media.isPlaying && media.updatedAt > 0 ? now - media.updatedAt : 0;
	const pos = Math.min(media.positionMs + elapsed, media.durationMs || Infinity);
	const pct = media.durationMs > 0 ? (pos / media.durationMs) * 100 : 0;

	// Monday-first week containing today.
	const today = new Date(now);
	const monday = new Date(today);
	monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
	const week = Array.from({ length: 7 }, (_, i) => {
		const d = new Date(monday);
		d.setDate(monday.getDate() + i);
		return d;
	});

	return (
		<div
			className="home-panel"
			onClick={(e) => e.stopPropagation()}
			onMouseLeave={() => {
				const active = document.activeElement as HTMLElement | null;
				if (active && active.closest(".home-todo-add") && !draft.trim()) {
					active.blur();
					props.onPinChange(false);
					invoke("restore_foreground").catch(() => {});
				}
			}}
		>
			<div className="home-tabs" role="tablist" aria-label="Island views">
				<button
					type="button"
					role="tab"
					aria-selected={tab === "home"}
					className={`home-tab ${tab === "home" ? "active" : ""}`}
					onClick={() => setTab("home")}
				>
					<House size={13} />
					<span>Home</span>
				</button>
				<button
					type="button"
					role="tab"
					aria-selected={tab === "widgets"}
					className={`home-tab ${tab === "widgets" ? "active" : ""}`}
					onClick={() => setTab("widgets")}
				>
					<LayoutGrid size={13} />
					<span>Widgets</span>
				</button>
				<button
					type="button"
					role="tab"
					aria-selected="false"
					className="home-tab"
					onClick={props.onOpenShelf}
				>
					<Inbox size={13} />
					<span>Shelf{props.shelfCount > 0 ? ` · ${props.shelfCount}` : ""}</span>
				</button>
			</div>

			{tab === "widgets" ? (
				<WidgetsPanel
					{...props.stats}
					events={props.events}
					shelfCount={props.shelfCount}
					onOpenShelf={props.onOpenShelf}
					timerText={props.timerText}
					battery={props.battery}
					charging={props.charging}
					headset={props.headset}
					media={{ hasMedia: media.hasMedia, title: media.title, artist: media.artist, art: media.art, isPlaying: media.isPlaying }}
					onPlayPause={props.onPlayPause}
					onPrev={props.onPrev}
					onNext={props.onNext}
					startTimer={props.startTimer}
					keepAwake={props.keepAwake}
					toggleKeepAwake={props.toggleKeepAwake}
					openSearch={props.openSearch}
					snap={props.snap}
					screenshot={props.screenshot}
					onPinChange={props.onPinChange}
				/>
			) : (
			<div className={`home-grid ${media.hasMedia ? "" : "no-media"}`}>
				{/* Music card */}
				<section className="home-music" aria-label="Now playing">
					{media.hasMedia ? (
						<>
							<div className="home-music-top">
								<div className="home-art">
									{media.art ? <img src={media.art} alt="" draggable={false} /> : <Music size={22} />}
								</div>
								<div className="home-track">
									<span className="home-title" title={media.title}>
										{media.title || "Unknown title"}
									</span>
									<span className="home-artist">{media.artist}</span>
									{media.sourceLabel && <span className="home-source">{media.sourceLabel}</span>}
								</div>
								{props.liked !== null && (
									<button
										type="button"
										className={`home-icon-btn ${props.liked ? "liked" : ""}`}
										aria-label={props.liked ? "Remove from Liked Songs" : "Save to Liked Songs"}
										title={props.liked ? "Remove from Liked Songs" : "Save to Liked Songs"}
										onClick={props.onToggleLike}
									>
										<Heart size={15} fill={props.liked ? "currentColor" : "none"} />
									</button>
								)}
							</div>
							{media.durationMs > 0 && (
								<div className="music-progress">
									<div
										className="music-progress-track seekable"
										role="slider"
										tabIndex={0}
										aria-label="Song position"
										aria-valuemin={0}
										aria-valuemax={Math.round(media.durationMs / 1000)}
										aria-valuenow={Math.round(pos / 1000)}
										aria-valuetext={`${fmt(pos)} of ${fmt(media.durationMs)}`}
										onClick={(e) => {
											const r = e.currentTarget.getBoundingClientRect();
											const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
											props.onSeek(f * media.durationMs);
										}}
										onKeyDown={(e) => {
											if (e.key === "ArrowRight") props.onSeek(Math.min(media.durationMs, pos + 5000));
											if (e.key === "ArrowLeft") props.onSeek(Math.max(0, pos - 5000));
										}}
									>
										<div className="music-progress-fill" style={{ transform: `scaleX(${pct / 100})` }} />
									</div>
									<div className="music-progress-times">
										<span>{fmt(pos)}</span>
										<span>-{fmt(media.durationMs - pos)}</span>
									</div>
								</div>
							)}
							<div className="home-controls">
								{media.shuffle !== null ? (
									<button
										type="button"
										className={`home-icon-btn ${media.shuffle ? "on" : ""}`}
										aria-label={`Shuffle ${media.shuffle ? "on" : "off"}`}
										title="Shuffle"
										onClick={props.onShuffle}
									>
										<Shuffle size={15} />
									</button>
								) : (
									<span className="home-icon-spacer" />
								)}
								<button type="button" className="home-icon-btn" aria-label="Previous track" title="Previous" onClick={props.onPrev}>
									<SkipBack size={17} fill="currentColor" />
								</button>
								<button
									type="button"
									className="home-play"
									aria-label={media.isPlaying ? "Pause" : "Play"}
									title={media.isPlaying ? "Pause" : "Play"}
									onClick={props.onPlayPause}
								>
									{media.isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
								</button>
								<button type="button" className="home-icon-btn" aria-label="Next track" title="Next" onClick={props.onNext}>
									<SkipForward size={17} fill="currentColor" />
								</button>
								{media.repeat !== null ? (
									<button
										type="button"
										className={`home-icon-btn ${media.repeat !== "none" ? "on" : ""}`}
										aria-label={`Repeat ${media.repeat}`}
										title="Repeat"
										onClick={props.onRepeat}
									>
										{media.repeat === "track" ? <Repeat1 size={15} /> : <Repeat size={15} />}
									</button>
								) : (
									<span className="home-icon-spacer" />
								)}
							</div>
							{props.spotifyQueue && props.spotifyQueue.next.length > 0 && (
								<div className="home-queue" aria-label="Up next">
									<span className="home-label">Up Next</span>
									{props.spotifyQueue.next.slice(0, 3).map((t, i) =>
										props.spotify || props.onQueueJump ? (
											<button
												key={`${t.id}-${i}`}
												type="button"
												className="home-queue-row"
												aria-label={`Play ${t.name} by ${t.artist}`}
												title="Play"
												onClick={() => (props.spotify ? props.spotify.playQueueIndex(i) : props.onQueueJump?.(i))}
											>
												{t.art ? <img src={t.art} alt="" /> : <Music size={12} />}
												<span className="home-queue-name">{t.name}</span>
												<span className="home-queue-artist">{t.artist}</span>
											</button>
										) : (
											<div key={`${t.id}-${i}`} className="home-queue-row">
												{t.art ? <img src={t.art} alt="" /> : <Music size={12} />}
												<span className="home-queue-name">{t.name}</span>
												<span className="home-queue-artist">{t.artist}</span>
											</div>
										)
									)}
								</div>
							)}
							{props.spotify && <SpotifyExtras spotify={props.spotify} onPinChange={props.onPinChange} />}
						</>
					) : (
						<div className="home-empty">
							<Music size={15} />
							<span>Nothing playing</span>
						</div>
					)}
				</section>

				{/* Week, to-dos and activities */}
				<section className="home-side">
					<div className="home-week" aria-label="This week">
						<span className="home-month">
							{today.toLocaleDateString([], { month: "short" })}
							<span>{today.getFullYear()}</span>
						</span>
						{week.map((d) => {
							const isToday = d.toDateString() === today.toDateString();
							return (
								<div
									key={d.toISOString()}
									className={`home-day ${isToday ? "today" : ""}`}
									aria-current={isToday ? "date" : undefined}
								>
									<span className="home-day-name">
										{d.toLocaleDateString([], { weekday: "short" }).slice(0, 3)}
									</span>
									<span className="home-day-num">{d.getDate()}</span>
									<span
										className={`home-day-dot ${props.events.some((ev) => new Date(ev.start).toDateString() === d.toDateString()) ? "on" : ""}`}
										aria-hidden="true"
									/>
								</div>
							);
						})}
					</div>

					{upcoming.length > 0 && (
						<div className="home-activities" aria-label="Upcoming events">
							<span className="home-label">Upcoming</span>
							{upcoming.map((ev) => (
								<div key={ev.id} className="home-activity">
									<span className="home-activity-icon">
										<ActivityIcon icon="calendar" size={13} />
									</span>
									<span className="home-activity-title">{ev.title}</span>
									<span className="home-activity-value">{ev.when}</span>
								</div>
							))}
						</div>
					)}

					<div className="home-todos">
						<span className="home-label">To-do</span>
						<form
							className="home-todo-add"
							onSubmit={(e) => {
								e.preventDefault();
								const text = draft.trim();
								if (!text) return;
								update([{ id: Date.now().toString(36), text, done: false }, ...todos]);
								setDraft("");
								// Done typing: give the keyboard back and let the island collapse.
								(document.activeElement as HTMLElement | null)?.blur();
								props.onPinChange(false);
								invoke("restore_foreground").catch(() => {});
							}}
						>
							<input
								value={draft}
								placeholder="Add a to-do"
								aria-label="Add a to-do"
								// The island never takes focus on its own (so it can't steal it
								// from your apps); clicking here hands it the keyboard.
								onPointerDown={(e) => {
									const input = e.currentTarget;
									invoke("focus_island")
										.catch(() => {})
										.finally(() => setTimeout(() => input.focus(), 30));
								}}
								onFocus={() => props.onPinChange(true)}
								onBlur={() => props.onPinChange(false)}
								onKeyDown={(e) => {
									if (e.key === "Escape") {
										e.currentTarget.blur();
										invoke("restore_foreground").catch(() => {});
									}
								}}
								onChange={(e) => setDraft(e.target.value)}
							/>
							<button type="submit" className="home-icon-btn" aria-label="Add to-do" title="Add">
								<Plus size={14} />
							</button>
						</form>
						<div className="home-todo-list">
							{todos.length === 0 && <span className="home-muted">Nothing to do. Enjoy your free time.</span>}
							{todos.slice(0, 6).map((t) => (
								<div key={t.id} className={`home-todo ${t.done ? "done" : ""}`}>
									<input
										type="checkbox"
										checked={t.done}
										aria-label={`Done: ${t.text}`}
										onChange={() => update(todos.map((x) => (x.id === t.id ? { ...x, done: !x.done } : x)))}
									/>
									<span>{t.text}</span>
									<button
										type="button"
										className="home-todo-remove"
										aria-label={`Remove ${t.text}`}
										title="Remove"
										onClick={() => update(todos.filter((x) => x.id !== t.id))}
									>
										<X size={12} />
									</button>
								</div>
							))}
						</div>
					</div>

					{props.recentCopies.length > 0 && (
						<div className="home-activities" aria-label="Recent copies">
							<span className="home-label home-label-row">
								Recent copies
								{props.recentCopies.length > 2 && (
									<button type="button" className="home-see-all" onClick={props.onOpenShelf}>
										See All
									</button>
								)}
							</span>
							{props.recentCopies.slice(0, 2).map((c) => (
								<div key={c.id} className="home-activity">
									<span className="home-activity-icon">
										{c.files.length > 0 ? <FileText size={13} /> : <ActivityIcon icon="clipboard" size={13} />}
									</span>
									<span className="home-activity-title" title={c.detail ?? c.preview}>
										{c.preview}
										{c.detail && <span className="home-activity-detail">{c.detail}</span>}
									</span>
									<button
										type="button"
										className="home-keep"
										aria-label={`Keep ${c.preview} on the shelf`}
										title="Keep on the shelf"
										onClick={() => props.onKeepCopy(c.id)}
									>
										Keep
									</button>
								</div>
							))}
						</div>
					)}

					{props.activities.length > 0 && (
						<div className="home-activities" aria-label="Live activities">
							<span className="home-label">Activities</span>
							{props.activities.slice(0, 4).map((a) => (
								<button
									key={a.id}
									type="button"
									className={`home-activity sig-${a.signal ?? "none"}`}
									onClick={() => props.onActivity(a)}
								>
									<span className="home-activity-icon">
										<ActivityIcon icon={a.icon} size={13} />
									</span>
									<span className="home-activity-title">{a.title}</span>
									{a.value && <span className="home-activity-value">{a.value}</span>}
								</button>
							))}
						</div>
					)}
				</section>
			</div>
			)}
		</div>
	);
}
