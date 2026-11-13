import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { CheckCircle2, Download, Sparkles } from "lucide-react";
import { ActivitiesSettings } from "./ActivitiesSettings";
import { has } from "../platform";

export const GET_STARTED_KEY = "bloom-get-started-seen";

interface Props {
	islandStyle: string;
	setIslandStyleValue: (style: string) => void;
	islandMaterial: string;
	setIslandMaterialValue: (material: string) => void;
	onDone: () => void;
}

/** First page after updating: style, live activities, browser extension. */
export function GetStarted(props: Props) {
	const [folder, setFolder] = useState<string | null>(null);
	const [connected, setConnected] = useState(false);
	const [status, setStatus] = useState("");

	useEffect(() => {
		invoke<string | null>("extension_folder").then(setFolder).catch(() => setFolder(null));
		const poll = () => invoke<boolean>("extension_connected").then(setConnected).catch(() => {});
		poll();
		const t = setInterval(poll, 2000);
		return () => clearInterval(t);
	}, []);

	const install = async () => {
		if (folder) {
			// DynIs's own copy must not show up in Recent copies.
			await invoke("clipboard_ignore_next").catch(() => {});
			await writeText(folder).catch(() => {});
		}
		try {
			const browser = await invoke<string>("open_extension_install");
			setStatus(
				`${browser === "brave.exe" ? "Brave" : browser === "chrome.exe" ? "Chrome" : "Edge"} and the extension folder are open. The folder path is copied.`
			);
		} catch (e) {
			setStatus(String(e));
		}
	};

	return (
		<div className="get-started">
			<div className="gs-hero">
				<Sparkles size={22} />
				<h1>Welcome to DynIs</h1>
				<p>Three quick choices, then you're set. You can change all of them later.</p>
			</div>

			<section className="gs-card">
				<h2>1. Island style</h2>
				<div className="gs-choices">
					{[
						["pill", "Capsule", "Floats just below the edge"],
						["notch", "Classic", "Attached to the edge, like a notch"]
					].map(([value, label, desc]) => (
						<button
							key={value}
							type="button"
							className={`gs-choice ${props.islandStyle === value ? "selected" : ""}`}
							aria-pressed={props.islandStyle === value}
							onClick={() => props.setIslandStyleValue(value)}
						>
							<span className={`gs-preview gs-preview-${value}`} aria-hidden="true" />
							<span className="gs-choice-label">{label}</span>
							<span className="gs-choice-desc">{desc}</span>
						</button>
					))}
				</div>
				{props.islandStyle === "pill" && (
					<label className="gs-inline">
						<span>Material</span>
						<select
							className="settings-select"
							value={props.islandMaterial}
							onChange={(e) => props.setIslandMaterialValue(e.target.value)}
						>
							<option value="ink">Ink</option>
							<option value="glass">Glass</option>
							{has("live-blur") && <option value="glass-live">Glass (live blur)</option>}
						</select>
					</label>
				)}
			</section>

			<section className="gs-card">
				<h2>2. Live Activities</h2>
				<ActivitiesSettings />
			</section>

			<section className="gs-card">
				<h2>3. Exact download progress</h2>
				<p className="gs-text">
					Add the DynIs Downloads extension to Brave, Chrome or Edge to see each download's exact
					progress. It only talks to DynIs on this PC.
				</p>
				<ol className="gs-steps">
					<li>Click "Install browser extension" below.</li>
					<li>In the extensions page, turn on "Developer mode" (top right).</li>
					<li>Click "Load unpacked", paste the copied folder path, and select the folder.</li>
				</ol>
				<div className="gs-actions">
					<button type="button" className="gs-primary" onClick={install} disabled={!folder}>
						<Download size={15} />
						Install Browser Extension
					</button>
					{connected ? (
						<span className="gs-connected">
							<CheckCircle2 size={15} /> Connected
						</span>
					) : (
						<span className="gs-muted">Not connected yet. Start a download after installing.</span>
					)}
				</div>
				{status && <p className="gs-muted">{status}</p>}
				{!folder && <p className="gs-muted">The extension folder wasn't found in this install.</p>}
			</section>

			<div className="gs-footer">
				<button type="button" className="gs-primary" onClick={props.onDone}>
					Continue
				</button>
			</div>
		</div>
	);
}
