import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { CalendarDays, KeyRound, LogIn, LogOut } from "lucide-react";
import { SettingRow } from "./SettingRow";

function read(key: string) {
	try {
		return localStorage.getItem(key) ?? "";
	} catch {
		return "";
	}
}

function save(key: string, value: string) {
	try {
		localStorage.setItem(key, value);
	} catch {
		/* ignore */
	}
	invoke("save_setting", { key, value }).catch(() => {});
}

/** Settings → Notch → Google Calendar: client, connect and sign out. */
export function CalendarSettings() {
	const [clientId, setClientId] = useState(() => read("bloom-google-client-id"));
	const [secret, setSecret] = useState(() => read("bloom-google-client-secret"));
	const [connected, setConnected] = useState(false);
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState("");

	useEffect(() => {
		invoke<Record<string, string>>("load_settings")
			.then((s) => {
				if (s?.["bloom-google-client-id"]) setClientId(s["bloom-google-client-id"]);
				if (s?.["bloom-google-client-secret"]) setSecret(s["bloom-google-client-secret"]);
			})
			.catch(() => {});
		invoke<boolean>("google_connected").then(setConnected).catch(() => {});
	}, []);

	const connect = async () => {
		save("bloom-google-client-id", clientId.trim());
		save("bloom-google-client-secret", secret.trim());
		setBusy(true);
		setMessage("Finish signing in in your browser…");
		try {
			// Give the backend a moment to pick up the saved client.
			await new Promise((r) => setTimeout(r, 300));
			await invoke("google_connect");
			setConnected(true);
			setMessage("Connected. Your events show in the Home view.");
		} catch (e) {
			setMessage(String(e));
		} finally {
			setBusy(false);
		}
	};

	const signOut = async () => {
		setBusy(true);
		await invoke("google_sign_out").catch(() => {});
		setConnected(false);
		setBusy(false);
		setMessage("Signed out. Access was revoked at Google.");
	};

	return (
		<>
			<div className="setting-group-label setting-group-label--spaced">Google Calendar</div>
			<div className="setting-group">
				<SettingRow
					icon={CalendarDays}
					label={connected ? "Connected" : "Not connected"}
					desc="Read-only. Shows your events in the Home view and a heads-up 10 minutes before."
				>
					{connected ? (
						<button type="button" className="settings-button" onClick={signOut} disabled={busy}>
							<LogOut size={13} /> Sign Out
						</button>
					) : (
						<button
							type="button"
							className="settings-button"
							onClick={connect}
							disabled={busy || !clientId.trim()}
						>
							<LogIn size={13} /> Connect
						</button>
					)}
				</SettingRow>
				{!connected && (
					<>
						<SettingRow icon={KeyRound} label="Client ID" desc="From Google Cloud → Credentials (Desktop app)">
							<input
								className="settings-input"
								value={clientId}
								placeholder="….apps.googleusercontent.com"
								onChange={(e) => setClientId(e.target.value)}
								aria-label="Google Client ID"
							/>
						</SettingRow>
						<SettingRow icon={KeyRound} label="Client secret" desc="Shown next to the Client ID" divider={false}>
							<input
								className="settings-input"
								type="password"
								value={secret}
								onChange={(e) => setSecret(e.target.value)}
								aria-label="Google Client secret"
							/>
						</SettingRow>
					</>
				)}
			</div>
			{message && <p className="setting-note">{message}</p>}
		</>
	);
}
