import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { CheckCircle2, Download, Globe, Music, PlaySquare, Radio, Waves } from "lucide-react";
import { SettingRow } from "./SettingRow";
import { WEB_SITES, parseWebSites, type WebSiteId } from "../webMedia";

const SITES_KEY = "bloom-web-media-sites";

/**
 * Installing the DynIs Downloads & Media extension by hand (Load unpacked /
 * Load Temporary Add-on), with a "Connected" check. Used by setup and by
 * Settings → Browser.
 */
export function ExtensionInstall() {
	const [folder, setFolder] = useState<string | null>(null);
	const [connected, setConnected] = useState(false);
	const [status, setStatus] = useState("");
	const [browsers, setBrowsers] = useState<string[] | null>(null);
	const [pick, setPick] = useState<"chromium" | "firefox">("chromium");

	useEffect(() => {
		invoke<string | null>("extension_folder").then(setFolder).catch(() => setFolder(null));
		invoke<string[]>("detect_browsers")
			.then((list) => {
				setBrowsers(list);
				// Firefox only: start there.
				if (list.length > 0 && list.every((b) => b === "Firefox")) setPick("firefox");
			})
			.catch(() => setBrowsers([]));
		const poll = () => invoke<boolean>("extension_connected").then(setConnected).catch(() => {});
		poll();
		const t = setInterval(poll, 2000);
		return () => clearInterval(t);
	}, []);

	const chromium = (browsers ?? []).filter((b) => b !== "Firefox");
	const hasFirefox = (browsers ?? []).includes("Firefox");
	const chromiumName = chromium.length ? chromium.join(", ").replace(/, ([^,]*)$/, " or $1") : "Brave, Chrome or Edge";

	const install = async () => {
		setStatus("");
		try {
			if (pick === "firefox") {
				const dir = await invoke<string>("open_firefox_extension_install");
				await invoke("clipboard_ignore_next").catch(() => {});
				await writeText(dir).catch(() => {});
				setStatus("Firefox's add-on page and the extension folder are open. The folder path is copied.");
				return;
			}
			if (folder) {
				// DynIs's own copy must not show up in Recent copies.
				await invoke("clipboard_ignore_next").catch(() => {});
				await writeText(folder).catch(() => {});
			}
			const browser = await invoke<string>("open_extension_install");
			const name = browser === "brave.exe" ? "Brave" : browser === "chrome.exe" ? "Chrome" : "Edge";
			setStatus(`${name}'s extensions page and the extension folder are open. The folder path is copied.`);
		} catch (e) {
			setStatus(String(e));
		}
	};

	return (
		<>
			{chromium.length > 0 && hasFirefox && (
				<div className="ob-browser-pick" role="radiogroup" aria-label="Browser">
					<button type="button" role="radio" aria-checked={pick === "chromium"} className={pick === "chromium" ? "active" : ""} onClick={() => setPick("chromium")}>
						{chromium.join(" · ")}
					</button>
					<button type="button" role="radio" aria-checked={pick === "firefox"} className={pick === "firefox" ? "active" : ""} onClick={() => setPick("firefox")}>
						Firefox
					</button>
				</div>
			)}
			{pick === "firefox" ? (
				<>
					<ol className="gs-steps">
						<li>Click "Open Firefox" below.</li>
						<li>Click "Load Temporary Add-on…", paste the copied path, and choose manifest.json.</li>
						<li>In Firefox's Add-ons page, open DynIs Downloads &amp; Media → Permissions and allow the music sites if Firefox asks.</li>
					</ol>
					<p className="gs-muted">
						Firefox removes unsigned add-ons when it restarts. To keep it, sign it for free with your own Mozilla account. DynIs can't do this for you. Steps are in SETTINGS.md, "Firefox: signing the downloads extension".
					</p>
				</>
			) : (
				<ol className="gs-steps">
					<li>Click "Open Browser" below ({chromiumName}).</li>
					<li>Turn on "Developer mode" (top right of the extensions page).</li>
					<li>Click "Load unpacked", paste the copied path, and choose the folder.</li>
					<li>Already installed an older version? Click the reload arrow on its card instead.</li>
				</ol>
			)}
			<p className="gs-muted">
				The browser asks to "read and change your data" on YouTube, YouTube Music, Spotify, Apple Music and SoundCloud. DynIs only reads what's playing there (title, artist, artwork, time and up next) and can press play, pause, next and previous for you. Nothing else is read, and nothing leaves your PC.
			</p>
			<div className="gs-actions">
				<button type="button" className="gs-primary" onClick={install} disabled={pick === "chromium" && !folder}>
					<Download size={15} /> {pick === "firefox" ? "Open Firefox" : "Open Browser"}
				</button>
				{connected ? (
					<span className="gs-connected">
						<CheckCircle2 size={15} /> Connected
					</span>
				) : (
					<span className="gs-muted">Shows "Connected" after your first download or song.</span>
				)}
			</div>
			{status && (
				<p className="gs-muted" role="status">
					{status}
				</p>
			)}
		</>
	);
}

const SITE_ICONS: Record<WebSiteId, typeof Globe> = {
	youtube: PlaySquare,
	ytmusic: Music,
	spotify: Music,
	applemusic: Music,
	soundcloud: Waves,
	generic: Radio
};

const SITE_DESC: Record<WebSiteId, string> = {
	youtube: "Now playing, the playlist or up next, and controls",
	ytmusic: "Now playing, the queue, and controls",
	spotify: "Now playing and controls; the queue while its Queue panel is open",
	applemusic: "Now playing and controls; the queue while it's open",
	soundcloud: "Now playing and controls; Next Up once it's been opened",
	generic: "Any other site that publishes what's playing. Also allow it in the extension's options"
};

/** Settings → Browser: the extension and which sites may show media. */
export function BrowserSettings() {
	const [sites, setSites] = useState(() => {
		try {
			return parseWebSites(localStorage.getItem(SITES_KEY));
		} catch {
			return parseWebSites(null);
		}
	});

	useEffect(() => {
		invoke<Record<string, string>>("load_settings")
			.then((s) => setSites(parseWebSites(s?.[SITES_KEY] ?? null)))
			.catch(() => {});
	}, []);

	const toggle = (id: WebSiteId) => {
		const next = { ...sites, [id]: !sites[id] };
		setSites(next);
		const value = JSON.stringify(next);
		try {
			localStorage.setItem(SITES_KEY, value);
		} catch {
			/* ignore */
		}
		invoke("save_setting", { key: SITES_KEY, value }).catch(() => {});
	};

	return (
		<>
			<div className="setting-group-label">Browser Extension</div>
			<div className="setting-group setting-group--padded">
				<p className="setting-note">
					DynIs Downloads &amp; Media shows your browser downloads and what's playing in your tabs, with its up next list, in the island.
				</p>
				<ExtensionInstall />
			</div>

			<div className="setting-group-label setting-group-label--spaced">Media From Websites</div>
			<div className="setting-group">
				{WEB_SITES.map((s, i) => {
					const Icon = SITE_ICONS[s.id];
					return (
						<SettingRow key={s.id} icon={Icon} label={s.label} desc={SITE_DESC[s.id]} divider={i < WEB_SITES.length - 1}>
							<label className="toggle-switch">
								<input
									type="checkbox"
									checked={sites[s.id]}
									onChange={() => toggle(s.id)}
									aria-label={`Show media from ${s.label}`}
								/>
								<span className="slider"></span>
							</label>
						</SettingRow>
					);
				})}
			</div>
			<p className="setting-note">
				A site turned off here is never read. "Ignore Browser Media" (Notch → Live Activities) hides all browser media.
			</p>
		</>
	);
}
