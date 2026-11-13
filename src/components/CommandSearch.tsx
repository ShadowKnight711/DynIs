import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Search } from "lucide-react";

export interface SearchAction {
	id: string;
	label: string;
	/** Extra words that should also match ("caffeine" for Keep Awake). */
	keywords?: string;
	icon: ReactNode;
	/** Windows-style shortcut hint, if any. */
	hint?: string;
	run: () => void;
}

interface Props {
	actions: SearchAction[];
	onClose: () => void;
}

/** Ctrl+Alt+Space: type to find an action, Enter runs it, Esc closes. */
export function CommandSearch({ actions, onClose }: Props) {
	const [query, setQuery] = useState("");
	const [index, setIndex] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		const t = setTimeout(() => inputRef.current?.focus(), 30);
		return () => clearTimeout(t);
	}, []);

	const results = useMemo(() => {
		const q = query.trim().toLowerCase();
		const list = q
			? actions.filter((a) => `${a.label} ${a.keywords ?? ""}`.toLowerCase().includes(q))
			: actions;
		return list.slice(0, 6);
	}, [actions, query]);

	useEffect(() => setIndex(0), [query]);

	const run = (a: SearchAction | undefined) => {
		if (!a) return;
		a.run();
		onClose();
	};

	return (
		<div className="cmd-search" onClick={(e) => e.stopPropagation()}>
			<div className="cmd-field">
				<Search size={15} aria-hidden="true" />
				<input
					ref={inputRef}
					value={query}
					placeholder="Search actions"
					aria-label="Search actions"
					onChange={(e) => setQuery(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Escape") {
							e.preventDefault();
							onClose();
						} else if (e.key === "ArrowDown") {
							e.preventDefault();
							setIndex((i) => Math.min(i + 1, results.length - 1));
						} else if (e.key === "ArrowUp") {
							e.preventDefault();
							setIndex((i) => Math.max(i - 1, 0));
						} else if (e.key === "Enter") {
							e.preventDefault();
							run(results[index]);
						}
					}}
				/>
				<kbd className="cmd-esc">Esc</kbd>
			</div>
			<div className="cmd-results" role="listbox" aria-label="Actions">
				{results.length === 0 && <span className="cmd-empty">No matching action</span>}
				{results.map((a, i) => (
					<button
						key={a.id}
						type="button"
						role="option"
						aria-selected={i === index}
						className={`cmd-row ${i === index ? "selected" : ""}`}
						onMouseEnter={() => setIndex(i)}
						onClick={() => run(a)}
					>
						<span className="cmd-icon" aria-hidden="true">
							{a.icon}
						</span>
						<span className="cmd-label">{a.label}</span>
						{a.hint && <kbd className="cmd-hint">{a.hint}</kbd>}
					</button>
				))}
			</div>
		</div>
	);
}
