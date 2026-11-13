import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { ArrowLeft, CheckCircle2, Sparkles } from "lucide-react";
import { ActivitiesSettings } from "./ActivitiesSettings";
import { CalendarSettings } from "./CalendarSettings";
import { SpotifySettings } from "./SpotifySettings";
import { ExtensionInstall } from "./BrowserSettings";
import { has } from "../platform";

export const ONBOARDING_VERSION = "2.0.0";
const STEP_KEY = "bloom-onboarding-step";

type Step = "welcome" | "extension" | "calendar" | "spotify" | "activities" | "island" | "finish";
const STEPS: Step[] = (
	["welcome", "extension", "calendar", "spotify", "activities", "island", "finish"] as Step[]
).filter((s) => s !== "spotify" || has("spotify"));

interface Props {
	islandStyle: string;
	setIslandStyleValue: (style: string) => void;
	islandMaterial: string;
	setIslandMaterialValue: (material: string) => void;
	notchEdge: string;
	setNotchEdgeValue: (edge: string) => void;
	onDone: () => void;
}

function savedStep(): number {
	try {
		const i = STEPS.indexOf((localStorage.getItem(STEP_KEY) ?? "") as Step);
		return i >= 0 ? i : 0;
	} catch {
		return 0;
	}
}

/** First-run setup, one focused step per screen (Mac setup-assistant style). */
export function Onboarding(props: Props) {
	const [index, setIndex] = useState(savedStep);
	const [dir, setDir] = useState(1);
	const reduce = useReducedMotion() ?? false;
	const step = STEPS[index];

	// Resume where you left off if DynIs is quit mid-setup.
	useEffect(() => {
		try {
			localStorage.setItem(STEP_KEY, step);
		} catch {
			/* ignore */
		}
	}, [step]);

	const go = (delta: number) => {
		setDir(delta);
		setIndex((i) => Math.max(0, Math.min(STEPS.length - 1, i + delta)));
	};

	const finish = async () => {
		try {
			localStorage.removeItem(STEP_KEY);
		} catch {
			/* ignore */
		}
		await invoke("finish_onboarding").catch(() => {});
		props.onDone();
	};

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			const typing = (e.target as HTMLElement)?.tagName === "INPUT";
			if (e.key === "Enter" && !typing) {
				e.preventDefault();
				if (step === "finish") finish();
				else go(1);
			} else if (e.key === "Escape" && index > 0) {
				e.preventDefault();
				go(-1);
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	});

	const optional = step === "extension" || step === "calendar" || step === "spotify";
	const primary =
		step === "welcome" ? "Get Started" : step === "finish" ? "Start DynIs" : "Continue";

	return (
		<div className="ob">
			<div className="ob-stage">
				<AnimatePresence mode="wait" custom={dir}>
					<motion.div
						key={step}
						className="ob-page"
						initial={reduce ? { opacity: 0 } : { opacity: 0, x: 40 * dir, filter: "blur(4px)" }}
						animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
						exit={reduce ? { opacity: 0 } : { opacity: 0, x: -40 * dir, filter: "blur(4px)" }}
						transition={reduce ? { duration: 0.12 } : { type: "spring", stiffness: 420, damping: 34, mass: 0.9 }}
					>
						{step === "welcome" && <Welcome />}
						{step === "extension" && <ExtensionStep />}
						{step === "calendar" && (
							<>
								<h1>Connect Google Calendar</h1>
								<p className="ob-lead">See your next events in the island and get a heads-up before they start.</p>
								<div className="ob-body">
									<CalendarSettings />
									<GoogleGuide />
								</div>
							</>
						)}
						{step === "spotify" && (
							<>
								<h1>Connect Spotify</h1>
								<p className="ob-lead">
									See what's up next, like songs, play your playlists, switch devices and add to the queue, right from the island. Optional: skip it if you don't use Spotify.
								</p>
								<div className="ob-body">
									<SpotifySettings compact />
								</div>
							</>
						)}
						{step === "activities" && (
							<>
								<h1>Live Activities</h1>
								<p className="ob-lead">Choose what the island can show you. Private ones start off.</p>
								<div className="ob-body">
									<ActivitiesSettings />
								</div>
							</>
						)}
						{step === "island" && <IslandStep {...props} />}
						{step === "finish" && (
							<div className="ob-center">
								<CheckCircle2 size={44} className="ob-hero-icon ok" />
								<h1>You're all set</h1>
								<p className="ob-lead">
									DynIs will appear at the {props.notchEdge === "bottom" ? "bottom" : "top"} of your screen.
									Change anything later in Settings.
								</p>
							</div>
						)}
					</motion.div>
				</AnimatePresence>
			</div>

			<footer className="ob-footer">
				<div className="ob-left">
					{index > 0 && (
						<button type="button" className="ob-back" onClick={() => go(-1)} aria-label="Back">
							<ArrowLeft size={15} /> Back
						</button>
					)}
				</div>
				<div className="ob-dots" aria-label={`Step ${index + 1} of ${STEPS.length}`}>
					{STEPS.map((s, i) => (
						<span key={s} className={`ob-dot ${i === index ? "on" : i < index ? "done" : ""}`} />
					))}
				</div>
				<div className="ob-right">
					{optional && (
						<button type="button" className="ob-skip" onClick={() => go(1)}>
							Set Up Later
						</button>
					)}
					<button
						type="button"
						className="ob-primary"
						onClick={() => (step === "finish" ? finish() : go(1))}
					>
						{primary}
					</button>
				</div>
			</footer>
		</div>
	);
}

function Welcome() {
	return (
		<div className="ob-center">
			<Sparkles size={44} className="ob-hero-icon" />
			<h1>Welcome to DynIs</h1>
			<p className="ob-lead">A living island for Windows: music, downloads, timers and more, right where you look.</p>
		</div>
	);
}

function ExtensionStep() {
	return (
		<>
			<h1>Browser downloads &amp; media</h1>
			<p className="ob-lead">
				See each download's exact progress, and what's playing on YouTube, YouTube Music, Spotify, Apple Music and SoundCloud with its up next list. Works in Brave, Chrome, Edge and Firefox. Optional.
			</p>
			<div className="ob-body">
				<ExtensionInstall />
			</div>
		</>
	);
}

function GoogleGuide() {
	return (
		<details className="ob-guide">
			<summary>How to get a Client ID (about 5 minutes)</summary>
			<ol className="gs-steps">
				<li>Open console.cloud.google.com and create a project named "DynIs".</li>
				<li>APIs &amp; Services → Library → enable "Google Calendar API".</li>
				<li>OAuth consent screen: External, app name "DynIs", add yourself as a test user.</li>
				<li>Credentials → Create credentials → OAuth client ID → Desktop app.</li>
				<li>Paste the Client ID and secret above, then click Connect.</li>
			</ol>
			<div className="sp-errors">
				<span className="sp-errors-title">If something goes wrong</span>
				<dl>
					<dt>"Access blocked: DynIs has not completed the Google verification process"</dt>
					<dd>Add your Google account under OAuth consent screen → Test users, then connect again.</dd>
					<dt>"Error 400: redirect_uri_mismatch"</dt>
					<dd>The OAuth client must be of type "Desktop app". Create a new one of that type and paste its ID and secret.</dd>
					<dt>"Google Calendar API has not been used in project…"</dt>
					<dd>Enable "Google Calendar API" in APIs &amp; Services → Library for the same project.</dd>
				</dl>
			</div>
		</details>
	);
}

function IslandStep(props: Props) {
	return (
		<>
			<h1>Choose your island</h1>
			<p className="ob-lead">Pick how DynIs looks. You can switch any time.</p>
			<div className="ob-body">
				<div className="gs-choices">
					{[
						["notch", "Classic", "Fused to the screen edge, like a Mac notch"],
						["pill", "Capsule", "A floating pill just below the edge"]
					].map(([value, label, desc]) => (
						<button
							key={value}
							type="button"
							className={`gs-choice ob-choice ${props.islandStyle === value ? "selected" : ""}`}
							aria-pressed={props.islandStyle === value}
							onClick={() => props.setIslandStyleValue(value)}
						>
							<span className={`gs-preview gs-preview-${value} ob-preview`} aria-hidden="true" />
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
				{props.islandStyle === "pill" && props.islandMaterial === "glass-live" && (
					<p className="gs-muted">Live blur hides DynIs from screenshots and screen sharing while it's on.</p>
				)}
				<label className="gs-inline">
					<span>Position</span>
					<select
						className="settings-select"
						value={props.notchEdge}
						onChange={(e) => props.setNotchEdgeValue(e.target.value)}
					>
						<option value="top">Top</option>
						<option value="bottom">Bottom</option>
					</select>
				</label>
			</div>
		</>
	);
}
