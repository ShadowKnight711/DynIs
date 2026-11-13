import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Bell, ClipboardCheck, Download, FileCode, Globe, Headphones } from "lucide-react";
import { SettingRow } from "./SettingRow";
import { has, type Feature } from "../platform";

interface Module {
	key: string;
	label: string;
	desc: string;
	icon: typeof Bell;
	/** Used when the setting has never been saved. */
	default: boolean;
	/** Hidden when the platform can't offer it. */
	needs?: Feature;
}

const ALL_MODULES: Module[] = [
	{
		key: "bloom-activity-bluetooth",
		label: "Headphones & Bluetooth",
		desc: "Show the device and its battery when it connects",
		icon: Headphones,
		default: true,
		needs: "headphones"
	},
	{
		key: "bloom-activity-downloads",
		label: "Downloads",
		desc: "Show downloads in progress from your Downloads folder",
		icon: Download,
		default: true
	},
	{
		key: "bloom-activity-idm",
		label: "Downloads from IDM",
		desc: "Show Internet Download Manager downloads with their progress",
		icon: Download,
		default: true,
		needs: "idm"
	},
	{
		key: "bloom-activity-clipboard",
		label: "Clipboard to Shelf",
		desc: "Add what you copy to the shelf (skips password managers)",
		icon: ClipboardCheck,
		default: false
	},
	{
		key: "bloom-activity-notifications",
		label: "Notifications",
		desc: "Show other apps' notifications in the island",
		icon: Bell,
		default: false,
		needs: "notifications"
	},
	{
		key: "bloom-media-ignore-browsers",
		label: "Ignore Browser Media",
		desc: "Don't show songs and videos playing in web browsers",
		icon: Globe,
		default: false
	},
	{
		key: "bloom-activity-custom",
		label: "Script Activities",
		desc: "Show statuses your own scripts write (see SETTINGS.md)",
		icon: FileCode,
		default: true
	}
];

const MODULES = ALL_MODULES.filter((m) => !m.needs || has(m.needs));

function read(key: string, fallback: boolean): boolean {
	try {
		const v = localStorage.getItem(key);
		return v === null ? fallback : v === "true";
	} catch {
		return fallback;
	}
}

/** Settings → Notch → Live Activities: one switch per Island Engine module. */
export function ActivitiesSettings() {
	const [values, setValues] = useState<Record<string, boolean>>(() =>
		Object.fromEntries(MODULES.map((m) => [m.key, read(m.key, m.default)]))
	);
	const [notifStatus, setNotifStatus] = useState("");

	useEffect(() => {
		invoke<Record<string, string>>("load_settings")
			.then((s) =>
				setValues((prev) => {
					const next = { ...prev };
					for (const m of MODULES) if (s && s[m.key] !== undefined) next[m.key] = s[m.key] === "true";
					return next;
				})
			)
			.catch(() => {});
	}, []);

	useEffect(() => {
		if (!values["bloom-activity-notifications"]) {
			setNotifStatus("");
			return;
		}
		const poll = () => invoke<string>("notifications_status").then(setNotifStatus).catch(() => {});
		poll();
		const t = setInterval(poll, 2000);
		return () => clearInterval(t);
	}, [values]);

	const toggle = (key: string) => {
		const next = !values[key];
		setValues((prev) => ({ ...prev, [key]: next }));
		try {
			localStorage.setItem(key, String(next));
		} catch {
			/* ignore */
		}
		invoke("save_setting", { key, value: String(next) }).catch(() => {});
	};

	return (
		<>
			<div className="setting-group-label setting-group-label--spaced">Live Activities</div>
			<div className="setting-group">
				{MODULES.map((m, i) => {
					const desc =
						m.key === "bloom-activity-notifications" && values[m.key] && notifStatus.startsWith("unavailable")
							? "Couldn't read Windows notifications on this PC"
							: m.desc;
					return (
						<SettingRow
							key={m.key}
							icon={m.icon}
							label={m.label}
							desc={desc}
							divider={i < MODULES.length - 1}
						>
							<label className="toggle-switch">
								<input
									type="checkbox"
									checked={values[m.key]}
									onChange={() => toggle(m.key)}
									aria-label={m.label}
								/>
								<span className="slider"></span>
							</label>
						</SettingRow>
					);
				})}
			</div>
		</>
	);
}
