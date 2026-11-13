import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { reorderAnnouncements, reorderInstructions } from "./reorderA11y";
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
import {
	SortableContext,
	arrayMove,
	rectSortingStrategy,
	sortableKeyboardCoordinates,
	useSortable
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronRight, File, Minus, Pencil, Plus, Search, X, AppWindow, Maximize2, Minimize2 } from "lucide-react";

export type CcSize = "small" | "large";

/** One placed control, as saved in `bloom-cc-layout`. */
export interface CcItem {
	id: string;
	kind: string;
	size: CcSize;
	/** App path, file, folder or URL for shortcut controls. */
	target?: string;
	label?: string;
}

/** What a control looks like and does, built by the island each render. */
export interface CcControl {
	label: string;
	icon: ReactNode;
	status?: string;
	active?: boolean;
	/** Signal colour for the "on" state. */
	signal?: "connect" | "focus";
	sizes: CcSize[];
	onClick?: () => void;
	onMore?: () => void;
	onContextMenu?: (e: React.MouseEvent) => void;
	/** Full-width level slider instead of a tile. */
	slider?: {
		value: number;
		max: number;
		step: number;
		onChange: (v: number) => void;
		display: string;
		/** Optional button at the end of the slider (e.g. audio output). */
		extra?: { icon: ReactNode; label: string; onClick: () => void };
	};
	/** A 2x2 tile with its own content (Now Playing). */
	xl?: ReactNode;
}

export const DEFAULT_CC_LAYOUT: CcItem[] = [
	{ id: "wifi", kind: "wifi", size: "large" },
	{ id: "now-playing", kind: "now-playing", size: "large" },
	{ id: "bluetooth", kind: "bluetooth", size: "large" },
	{ id: "dock-mode", kind: "dock-mode", size: "large" },
	{ id: "notch-mode", kind: "notch-mode", size: "large" },
	{ id: "focus", kind: "focus", size: "small" },
	{ id: "battery-saver", kind: "battery-saver", size: "small" },
	{ id: "tray", kind: "tray", size: "small" },
	{ id: "notifications", kind: "notifications", size: "small" },
	{ id: "settings", kind: "settings", size: "small" },
	{ id: "restart", kind: "restart", size: "small" },
	{ id: "volume", kind: "volume", size: "large" },
	{ id: "brightness", kind: "brightness", size: "large" }
];

/** Parses a saved layout, dropping anything malformed; null means "use the default". */
export function parseCcLayout(raw: unknown): CcItem[] | null {
	let value = raw;
	if (typeof value === "string") {
		try {
			value = JSON.parse(value);
		} catch {
			return null;
		}
	}
	if (!Array.isArray(value)) return null;
	const items = value.filter(
		(v): v is CcItem =>
			!!v &&
			typeof v === "object" &&
			typeof v.id === "string" &&
			typeof v.kind === "string" &&
			(v.size === "small" || v.size === "large")
	);
	return items;
}

interface InstalledApp {
	name: string;
	path: string;
}

interface Props {
	layout: CcItem[];
	onLayoutChange: (layout: CcItem[]) => void;
	/** Every built-in control kind, in the order the Add sheet lists them. */
	controls: Record<string, CcControl>;
	editing: boolean;
	onEditingChange: (editing: boolean) => void;
	/** Reports the grid's natural height so the island can size to it. */
	onHeight: (height: number) => void;
	reduceMotion: boolean;
}

const SHORTCUT_KINDS = new Set(["app", "file"]);

function shortcutControl(item: CcItem, icon: string | null | undefined): CcControl {
	return {
		label: item.label ?? item.target ?? "Shortcut",
		status: item.kind === "app" ? "App" : "Open",
		icon: icon ? (
			<img src={icon} alt="" className="cc-shortcut-icon" draggable={false} />
		) : item.kind === "app" ? (
			<AppWindow size={15} />
		) : (
			<File size={15} />
		),
		sizes: ["small", "large"],
		onClick: () => {
			if (item.target) invoke("open_app", { appName: item.target }).catch(() => {});
		}
	};
}

function Tile({
	item,
	control,
	editing,
	reduceMotion,
	onRemove,
	onToggleSize,
	lifted = false
}: {
	item: CcItem;
	control: CcControl;
	editing: boolean;
	reduceMotion: boolean;
	onRemove: () => void;
	onToggleSize: () => void;
	/** The floating copy that follows the pointer while dragging. */
	lifted?: boolean;
}) {
	const sortable = useSortable({ id: item.id, disabled: !editing || lifted });
	const { attributes, listeners, setNodeRef, transform, isDragging } = sortable;
	// Position-only reflow: never scale a tile toward a differently sized slot.
	const transition = reduceMotion
		? "transform 120ms ease-out"
		: "transform 320ms cubic-bezier(0.2, 0.9, 0.25, 1.06)";
	const size: CcSize = control.slider ? "large" : control.sizes.includes(item.size) ? item.size : control.sizes[0];
	const xl = !!control.xl && size === "large";
	const style: React.CSSProperties = lifted
		? {}
		: { transform: CSS.Translate.toString(transform), transition: transform ? transition : undefined };
	const className = [
		"cc-cell",
		control.slider ? "cc-cell-slider" : xl ? "cc-cell-xl" : size === "large" ? "cc-cell-large" : "cc-cell-small",
		control.active ? "active" : "",
		control.signal ? `signal-${control.signal}` : "",
		lifted ? "cc-lifted" : isDragging ? "cc-placeholder" : editing ? (reduceMotion ? "editing-still" : "editing") : ""
	]
		.filter(Boolean)
		.join(" ");

	const body = control.slider ? (
		<div className="cc-slider-row">
			<span className="cc-slider-icon" aria-hidden="true">
				{control.icon}
			</span>
			<input
				type="range"
				className="level-slider cc-slider"
				min={0}
				max={control.slider.max}
				step={control.slider.step}
				value={control.slider.value}
				disabled={editing}
				aria-label={control.label}
				style={{ "--level": `${(control.slider.value / control.slider.max) * 100}%` } as React.CSSProperties}
				onChange={(e) => control.slider!.onChange(Number(e.target.value))}
				onPointerDown={(e) => e.stopPropagation()}
			/>
			<span className="cc-slider-value">{control.slider.display}</span>
			{control.slider.extra && !editing && (
				<button
					type="button"
					className="cc-slider-output"
					aria-label={control.slider.extra.label}
					title={control.slider.extra.label}
					onPointerDown={(e) => e.stopPropagation()}
					onClick={(e) => {
						e.stopPropagation();
						control.slider!.extra!.onClick();
					}}
				>
					{control.slider.extra.icon}
				</button>
			)}
		</div>
	) : xl ? (
		control.xl
	) : size === "large" ? (
		<>
			<span className="cc-tile-icon" aria-hidden="true">
				{control.icon}
			</span>
			<span className="cc-tile-text">
				<span className="cc-tile-title">{control.label}</span>
				{control.status !== undefined && <span className="cc-tile-status">{control.status}</span>}
			</span>
			{control.onMore && !editing && (
				<button
					type="button"
					className="cc-tile-more"
					aria-label={`${control.label} details`}
					onClick={(e) => {
						e.stopPropagation();
						control.onMore!();
					}}
				>
					<ChevronRight size={14} />
				</button>
			)}
		</>
	) : (
		<span className="cc-tile-icon" aria-hidden="true">
			{control.icon}
		</span>
	);

	return (
		<div
			ref={lifted ? undefined : setNodeRef}
			{...(editing ? { ...attributes, ...listeners } : {})}
			style={style}
			className={className}
			role={editing ? "button" : control.slider || xl ? undefined : "button"}
			tabIndex={editing ? 0 : control.slider || xl ? undefined : 0}
			aria-label={
				control.slider && !editing ? undefined : `${control.label}${control.status ? `: ${control.status}` : ""}`
			}
			title={control.slider ? undefined : control.label}
			onClick={(e) => {
				e.stopPropagation();
				if (!editing) control.onClick?.();
			}}
			onKeyDown={(e) => {
				if (editing && (e.key === "Delete" || e.key === "Backspace")) {
					e.preventDefault();
					onRemove();
				} else if (editing) {
					// Space/Enter/arrows/Esc on the tile itself go to the keyboard reorder.
					if (e.target === e.currentTarget) listeners?.onKeyDown?.(e);
				} else if (!editing && (e.key === "Enter" || e.key === " ")) {
					e.preventDefault();
					control.onClick?.();
				}
			}}
			onContextMenu={editing ? undefined : control.onContextMenu}
		>
			{body}
			{editing && !lifted && !isDragging && (
				<>
					<button
						type="button"
						className="cc-badge cc-badge-remove"
						aria-label={`Remove ${control.label}`}
						onPointerDown={(e) => e.stopPropagation()}
						onClick={(e) => {
							e.stopPropagation();
							onRemove();
						}}
					>
						<Minus size={10} strokeWidth={3} />
					</button>
					{!control.slider && control.sizes.length > 1 && (
						<button
							type="button"
							className="cc-badge cc-badge-size"
							aria-label={`Make ${control.label} ${size === "large" ? "small" : "large"}`}
							onPointerDown={(e) => e.stopPropagation()}
							onClick={(e) => {
								e.stopPropagation();
								onToggleSize();
							}}
						>
							{size === "large" ? (
								<Minimize2 size={10} strokeWidth={2.6} />
							) : (
								<Maximize2 size={10} strokeWidth={2.6} />
							)}
						</button>
					)}
				</>
			)}
		</div>
	);
}

export function CommandCenterGrid({
	layout,
	onLayoutChange,
	controls,
	editing,
	onEditingChange,
	onHeight,
	reduceMotion
}: Props) {
	const rootRef = useRef<HTMLDivElement>(null);
	const [sheet, setSheet] = useState<null | "add" | "apps">(null);
	const [apps, setApps] = useState<InstalledApp[]>([]);
	const [query, setQuery] = useState("");
	const [icons, setIcons] = useState<Record<string, string | null>>({});

	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
		useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
	);

	// Icons for app/file shortcuts.
	useEffect(() => {
		for (const item of layout) {
			if (!SHORTCUT_KINDS.has(item.kind) || !item.target || item.target in icons) continue;
			const target = item.target;
			setIcons((prev) => ({ ...prev, [target]: null }));
			invoke<string | null>("get_app_icon", { path: target, name: item.label ?? null, hwnd: null })
				.then((icon) => setIcons((prev) => ({ ...prev, [target]: icon })))
				.catch(() => {});
		}
	}, [layout, icons]);

	// Report the natural height whenever the content changes.
	useLayoutEffect(() => {
		const el = rootRef.current;
		if (!el) return;
		const report = () => onHeight(el.scrollHeight);
		report();
		const observer = new ResizeObserver(report);
		observer.observe(el);
		return () => observer.disconnect();
	}, [onHeight, sheet]);

	useEffect(() => {
		if (!editing) setSheet(null);
	}, [editing]);

	const resolved = useMemo(
		() =>
			layout
				.map((item) => ({
					item,
					control: SHORTCUT_KINDS.has(item.kind)
						? shortcutControl(item, item.target ? icons[item.target] : null)
						: controls[item.kind]
				}))
				.filter((r): r is { item: CcItem; control: CcControl } => !!r.control),
		[layout, controls, icons]
	);

	const update = (next: CcItem[]) => onLayoutChange(next);
	const [activeId, setActiveId] = useState<string | null>(null);
	const onDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id));
	const onDragEnd = (e: DragEndEvent) => {
		setActiveId(null);
		if (!e.over || e.active.id === e.over.id) return;
		const from = layout.findIndex((i) => i.id === e.active.id);
		const to = layout.findIndex((i) => i.id === e.over!.id);
		if (from >= 0 && to >= 0) update(arrayMove(layout, from, to));
	};
	const addItem = (item: Omit<CcItem, "id">) => {
		const id = `${item.kind}-${Date.now().toString(36)}`;
		update([...layout, { ...item, id }]);
		setSheet(null);
	};

	const placedKinds = new Set(layout.map((i) => i.kind));
	const addable = Object.entries(controls).filter(([kind]) => !placedKinds.has(kind));

	const openApps = () => {
		setSheet("apps");
		setQuery("");
		if (apps.length === 0) {
			invoke<InstalledApp[]>("get_installed_apps")
				.then((list) =>
					setApps([...list].sort((a, b) => a.name.localeCompare(b.name)))
				)
				.catch(() => {});
		}
	};
	const pickFile = async (directory: boolean) => {
		try {
			const picked = await openDialog({ directory, multiple: false });
			if (typeof picked === "string" && picked) {
				const name = picked.split(/[\\/]/).filter(Boolean).pop() ?? picked;
				addItem({ kind: "file", size: "small", target: picked, label: name });
			}
		} catch {
			/* dialog cancelled or unavailable */
		}
	};

	return (
		<div
			ref={rootRef}
			className="cc-grid-root"
			onContextMenu={(e) => {
				if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains("cc-grid")) {
					e.preventDefault();
					onEditingChange(true);
				}
			}}
		>
			{editing && (
				<div className="cc-grid-header">
					<span className="cc-grid-title">Edit Controls</span>
				</div>
			)}

			{sheet === "add" && (
				<div className="cc-sheet" onClick={(e) => e.stopPropagation()}>
					{addable.map(([kind, control]) => (
						<button
							key={kind}
							type="button"
							className="cc-sheet-item"
							onClick={() =>
								addItem({ kind, size: control.slider ? "large" : control.sizes[0] })
							}
						>
							<span className="cc-tile-icon" aria-hidden="true">
								{control.icon}
							</span>
							<span>{control.label}</span>
						</button>
					))}
					<button type="button" className="cc-sheet-item" onClick={openApps}>
						<span className="cc-tile-icon" aria-hidden="true">
							<AppWindow size={15} />
						</span>
						<span>App shortcut…</span>
					</button>
					<button type="button" className="cc-sheet-item" onClick={() => pickFile(false)}>
						<span className="cc-tile-icon" aria-hidden="true">
							<File size={15} />
						</span>
						<span>File shortcut…</span>
					</button>
					<button type="button" className="cc-sheet-item" onClick={() => pickFile(true)}>
						<span className="cc-tile-icon" aria-hidden="true">
							<File size={15} />
						</span>
						<span>Folder shortcut…</span>
					</button>
				</div>
			)}

			{sheet === "apps" && (
				<div className="cc-sheet cc-sheet-apps" onClick={(e) => e.stopPropagation()}>
					<div className="cc-search">
						<Search size={13} aria-hidden="true" />
						<input
							autoFocus
							placeholder="Search apps"
							aria-label="Search apps"
							value={query}
							onChange={(e) => setQuery(e.target.value)}
						/>
						<button type="button" aria-label="Close" onClick={() => setSheet("add")}>
							<X size={13} />
						</button>
					</div>
					<div className="cc-app-list">
						{apps
							.filter((a) => a.name.toLowerCase().includes(query.toLowerCase()))
							.slice(0, 60)
							.map((a) => (
								<button
									key={a.path}
									type="button"
									className="cc-sheet-item"
									onClick={() => addItem({ kind: "app", size: "small", target: a.path, label: a.name })}
								>
									<span>{a.name}</span>
								</button>
							))}
						{apps.length === 0 && <span className="cc-empty">Loading apps…</span>}
					</div>
				</div>
			)}

			<DndContext
				sensors={sensors}
				collisionDetection={closestCenter}
				accessibility={{
					screenReaderInstructions: reorderInstructions,
					announcements: reorderAnnouncements(
						resolved.map((r) => r.item.id),
						(id) => resolved.find((r) => r.item.id === id)?.control.label ?? "Control"
					)
				}}
				onDragStart={onDragStart}
				onDragEnd={onDragEnd}
				onDragCancel={() => setActiveId(null)}
			>
				<SortableContext items={resolved.map((r) => r.item.id)} strategy={rectSortingStrategy}>
					<div className="cc-grid">
						{resolved.map(({ item, control }) => (
							<Tile
								key={item.id}
								item={item}
								control={control}
								editing={editing}
								reduceMotion={reduceMotion}
								onRemove={() => update(layout.filter((i) => i.id !== item.id))}
								onToggleSize={() =>
									update(
										layout.map((i) =>
											i.id === item.id ? { ...i, size: i.size === "large" ? "small" : "large" } : i
										)
									)
								}
							/>
						))}
						{resolved.length === 0 && (
							<span className="cc-empty">No controls yet. Click Edit Controls, then Add.</span>
						)}
					</div>
				</SortableContext>
				{/* The lifted tile: a copy at its own size that follows the pointer.
				    Portaled to the body so the island's transform/zoom can't offset it. */}
				{createPortal(
				<DragOverlay
					dropAnimation={
						reduceMotion ? null : { duration: 260, easing: "cubic-bezier(0.2, 0.9, 0.25, 1.06)" }
					}
				>
					{activeId
						? (() => {
								const found = resolved.find((r) => r.item.id === activeId);
								return found ? (
									<Tile
										item={found.item}
										control={found.control}
										editing={editing}
										reduceMotion={reduceMotion}
										onRemove={() => {}}
										onToggleSize={() => {}}
										lifted
									/>
								) : null;
							})()
						: null}
				</DragOverlay>,
				document.body
				)}
			</DndContext>

			<div className="cc-edit-pill-row">
				{editing && (
					<button
						type="button"
						className="cc-edit-pill"
						aria-label="Add control"
						onClick={(e) => {
							e.stopPropagation();
							setSheet(sheet ? null : "add");
						}}
					>
						<Plus size={13} />
						Add
					</button>
				)}
				<button
					type="button"
					className={`cc-edit-pill ${editing ? "primary" : ""}`}
					onClick={(e) => {
						e.stopPropagation();
						onEditingChange(!editing);
					}}
				>
					{editing ? (
						"Done"
					) : (
						<>
							<Pencil size={12} />
							Edit Controls
						</>
					)}
				</button>
			</div>
		</div>
	);
}
