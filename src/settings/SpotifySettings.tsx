import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Check, Copy, KeyRound, LogIn, LogOut, Music } from "lucide-react";
import { SettingRow } from "./SettingRow";
import {
	connectSpotify,
	disconnectSpotify,
	isValidClientId,
	spotifyConnected,
	SPOTIFY_CHANGED_EVENT,
	SPOTIFY_REDIRECT
} from "../spotify";

function read(key: string) {
	try {
		return localStorage.getItem(key) ?? "";
	} catch {
		return "";
	}
}

/** A sign-in error in words, with what to do. */
export function spotifyErrorHelp(text: string): string {
	const t = text.toLowerCase();
	if (t.includes("redirect")) return `Add ${SPOTIFY_REDIRECT} exactly under Redirect URIs in your Spotify app, click Save, then try again.`;
	if (t.includes("not registered") || t.includes("user management"))
		return "Add the email of this Spotify account under User Management in your Spotify app's Settings, then try again.";
	if (t.includes("invalid_client") || t.includes("invalid client")) return "Spotify didn't accept that Client ID. Copy it again from your app's Settings.";
	if (t.includes("access_denied")) return "Sign-in was cancelled in the browser. Click Connect to try again.";
	if (t.includes("timed out")) return "Sign-in took too long. Click Connect and approve in the browser within 3 minutes.";
	return text;
}

function save(key: string, value: string) {
	try {
		localStorage.setItem(key, value);
	} catch {
		/* ignore */
	}
	invoke("save_setting", { key, value }).catch(() => {});
}

/** Copies the redirect address, which must match exactly. */
function CopyRedirect() {
	const [copied, setCopied] = useState(false);
	const copy = async () => {
		await invoke("clipboard_ignore_next").catch(() => {});
		await writeText(SPOTIFY_REDIRECT).catch(() => {});
		setCopied(true);
		setTimeout(() => setCopied(false), 1600);
	};
	return (
		<span className="sp-copy">
			<code>{SPOTIFY_REDIRECT}</code>
			<button type="button" className="settings-button" onClick={copy} aria-label="Copy the Redirect URI">
				{copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copied" : "Copy"}
			</button>
		</span>
	);
}

/**
 * The steps to create a Spotify app and get its Client ID, with the usual
 * errors and their fixes. Open in setup, folded away in Settings.
 */
export function SpotifyGuide({ open = false }: { open?: boolean }) {
	return (
		<details className="ob-guide sp-guide" open={open}>
			<summary>How to connect Spotify (about 3 minutes)</summary>
			<ol className="gs-steps">
				<li>
					Go to <strong>developer.spotify.com/dashboard</strong> and log in with your Spotify account.
				</li>
				<li>
					Click <strong>Create app</strong>. Any name and description work, for example "DynIs".
				</li>
				<li>
					Under <strong>Redirect URIs</strong>, paste this address exactly and click Add:
					<CopyRedirect />
				</li>
				<li>
					Under "Which API/SDKs are you planning to use?", tick <strong>Web API</strong>, accept the terms, and click <strong>Save</strong>.
				</li>
				<li>
					Open the app's <strong>Settings</strong> and copy the <strong>Client ID</strong>. No secret is needed.
				</li>
				<li>
					Paste it into DynIs, click <strong>Connect</strong>, and approve in the browser window that opens.
				</li>
			</ol>
			<p className="gs-muted">
				Reading (Up Next, likes, playlists) works on Spotify Free. Controlling playback from DynIs (skip, seek, shuffle, devices, play) needs Spotify Premium; that's Spotify's rule. To disconnect, go to Settings → Notch → Spotify → Disconnect.
			</p>
			<div className="sp-errors">
				<span className="sp-errors-title">If something goes wrong</span>
				<dl>
					<dt>"INVALID_CLIENT: Invalid redirect URI"</dt>
					<dd>The Redirect URI in your Spotify app must match exactly, including http, 127.0.0.1 and the port. Copy it again with the button above, add it, and click Save.</dd>
					<dt>"User not registered in the Developer Dashboard"</dt>
					<dd>
						New Spotify apps are in development mode. Open your app → Settings → <strong>User Management</strong> and add the email of the Spotify account that signs in. Do this for each friend who uses your Client ID; development mode allows only a small number of users.
					</dd>
					<dt>"INVALID_CLIENT: Invalid client"</dt>
					<dd>The Client ID was copied incompletely. It's 32 letters and numbers.</dd>
					<dt>"Port 47819 is busy"</dt>
					<dd>Another app uses that port. Close it, or restart your PC, then click Connect again.</dd>
				</dl>
			</div>
		</details>
	);
}

/** Settings → Notch → Spotify (and the setup step): Client ID, connect, disconnect. */
export function SpotifySettings({ compact = false }: { compact?: boolean }) {
	const [clientId, setClientId] = useState(() => read("bloom-spotify-client-id"));
	const [connected, setConnected] = useState(false);
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState("");

	useEffect(() => {
		invoke<Record<string, string>>("load_settings")
			.then((s) => {
				const id = s?.["bloom-spotify-client-id"];
				if (id) {
					setClientId(id);
					try {
						localStorage.setItem("bloom-spotify-client-id", id);
					} catch {
						/* ignore */
					}
				}
			})
			.catch(() => {})
			.finally(() => spotifyConnected().then(setConnected).catch(() => {}));
		// The island disconnects by itself when Spotify revokes access.
		const un = listen<boolean>(SPOTIFY_CHANGED_EVENT, (e) => setConnected(!!e.payload));
		return () => {
			un.then((fn) => fn());
		};
	}, []);

	const connect = async () => {
		if (!isValidClientId(clientId)) {
			setMessage("A Client ID is 32 letters and numbers. Copy it from your app's Settings at developer.spotify.com.");
			return;
		}
		save("bloom-spotify-client-id", clientId.trim());
		setBusy(true);
		setMessage("Finish signing in in your browser…");
		try {
			await connectSpotify();
			setConnected(true);
			setMessage("Connected. Up Next, likes and devices show in Home when Spotify is playing.");
		} catch (e) {
			const text = String(e).replace(/^Error:\s*/, "");
			setMessage(spotifyErrorHelp(text));
		} finally {
			setBusy(false);
		}
	};

	const disconnect = async () => {
		setBusy(true);
		await disconnectSpotify();
		setConnected(false);
		setBusy(false);
		setMessage("Disconnected. DynIs no longer has access to your Spotify account.");
	};

	return (
		<>
			{!compact && <div className="setting-group-label setting-group-label--spaced">Spotify</div>}
			<div className="setting-group">
				<SettingRow
					icon={Music}
					label={connected ? "Connected" : "Not connected"}
					desc="Up Next, likes, shuffle and repeat, seeking, devices and adding to the queue. Controlling playback needs Spotify Premium; reading works on Free."
				>
					{connected ? (
						<button type="button" className="settings-button" onClick={disconnect} disabled={busy}>
							<LogOut size={13} /> Disconnect
						</button>
					) : (
						<button type="button" className="settings-button" onClick={connect} disabled={busy || !clientId.trim()}>
							<LogIn size={13} /> Connect
						</button>
					)}
				</SettingRow>
				{!connected && (
					<SettingRow icon={KeyRound} label="Client ID" desc="From your app at developer.spotify.com" divider={false}>
						<input
							className="settings-input"
							value={clientId}
							placeholder="32 letters and numbers"
							onChange={(e) => setClientId(e.target.value)}
							aria-label="Spotify Client ID"
						/>
					</SettingRow>
				)}
			</div>
			{!connected && <SpotifyGuide open={compact} />}
			{message && <p className="setting-note">{message}</p>}
		</>
	);
}
