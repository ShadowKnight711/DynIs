import { useState } from "react";
import { FileDown, ScrollText, Sparkles, Upload } from "lucide-react";
import changelog from "../../CHANGELOG.md?raw";
import { openUrl } from "@tauri-apps/plugin-opener";
import { GithubIcon } from "../icons";
import { SettingRow } from "./SettingRow";

interface AboutTabProps {
	appVersion: string;
	exportStatus: string;
	importStatus: string;
	handleExportSettings: () => void;
	handleImportSettings: () => void;
	onGetStarted: () => void;
}

export function AboutTab({
	appVersion,
	exportStatus,
	importStatus,
	handleExportSettings,
	handleImportSettings,
	onGetStarted
}: AboutTabProps) {
	const getExportLabel = () => {
		if (exportStatus === "exporting") return "Exporting...";
		if (exportStatus === "success") return "Exported!";
		if (exportStatus === "error") return "Export failed. Try again.";
		return "Export Settings";
	};

	const getImportLabel = () => {
		if (importStatus === "importing") return "Importing...";
		if (importStatus === "success") return "Imported!";
		if (importStatus === "error") return "Import failed. Check the file and try again.";
		return "Import Settings";
	};

	return (
		<div className="about-tab-container">
			<div className="about-header">
				<img src="/bloom.png" className="about-logo" alt="DynIs Logo" draggable={false} />
				<h1 className="about-title">DynIs</h1>
				<p className="about-version">Version {appVersion}</p>
				<p className="about-made-by">Made by Kevin</p>
				<p className="about-credit">
					Based on{" "}
					<button
						className="about-author"
						onClick={() => openUrl("https://github.com/SehajveerSingh2005/bloom")}
						title="Bloom on GitHub"
					>
						<GithubIcon size={12} />
						<span>Bloom</span>
					</button>{" "}
					by Sehajveer Singh · Licensed under{" "}
					<button
						className="about-author"
						onClick={() => openUrl("https://www.gnu.org/licenses/gpl-3.0.html")}
						title="GNU General Public License v3"
					>
						<span>GPLv3</span>
					</button>
				</p>
			</div>

			<div className="setting-group-label">What's new</div>
			<div className="setting-group about-changelog">
				<Changelog version={appVersion} />
			</div>

			<div className="setting-group-label setting-group-label--spaced">Setup</div>
			<div className="setting-group">
				<SettingRow
					icon={Sparkles}
					label="Run Setup Again"
					desc="Island style, live activities, browser extension and calendar"
					action
					divider={false}
					onClick={onGetStarted}
				/>
			</div>

			<div className="setting-group-label setting-group-label--spaced">Data</div>
			<div className="setting-group">
				<SettingRow
					icon={FileDown}
					label={getExportLabel()}
					desc="Save settings to a file"
					action
					onClick={handleExportSettings}
				/>
				<SettingRow
					icon={Upload}
					label={getImportLabel()}
					desc="Load settings from a file"
					action
					divider={false}
					onClick={handleImportSettings}
				/>
			</div>
		</div>
	);
}

interface Release {
	version: string;
	title: string;
	items: string[];
}

/** Parses CHANGELOG.md ("## 1.2.3 (date)" headings with "- " items). */
function parseChangelog(md: string): { releases: Release[]; footer: string } {
	const releases: Release[] = [];
	let footer = "";
	let inFooter = false;
	for (const line of md.split(/\r?\n/)) {
		if (line.startsWith("## ")) {
			const title = line.slice(3).trim();
			releases.push({ version: title.split(" ")[0], title, items: [] });
		} else if (line.startsWith("- ") && releases.length > 0 && !inFooter) {
			releases[releases.length - 1].items.push(line.slice(2));
		} else if (line.trim() === "---") {
			inFooter = true;
		} else if (inFooter && line.trim()) {
			footer += (footer ? " " : "") + line.trim();
		}
	}
	return { releases, footer };
}

function Changelog({ version }: { version: string }) {
	const { releases, footer } = parseChangelog(changelog);
	const [open, setOpen] = useState<string | null>(version || releases[0]?.version || null);
	return (
		<div className="changelog">
			{releases.map((r) => (
				<div key={r.title} className="changelog-release">
					<button
						type="button"
						className="changelog-head"
						aria-expanded={open === r.version}
						onClick={() => setOpen(open === r.version ? null : r.version)}
					>
						<ScrollText size={14} />
						<span>{r.title}</span>
						{r.version === version && <span className="changelog-current">Current</span>}
					</button>
					{open === r.version && (
						<ul className="changelog-items">
							{r.items.map((it) => (
								<li key={it}>{it}</li>
							))}
						</ul>
					)}
				</div>
			))}
			{footer && <p className="changelog-footer">{footer}</p>}
		</div>
	);
}
