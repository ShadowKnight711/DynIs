import { StrictMode, Suspense, lazy, useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { Effect } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { X, Settings, Palette, PanelTop, Monitor, Layers, Info, Megaphone, Globe } from "lucide-react";
import {
	useSettings,
	GeneralTab,
	AppearanceTab,
	NotchTab,
	DockTab,
	OverlaysTab,
	AboutTab,
	BrowserSettings
} from "./settings/index";
import type { SettingsTab } from "./settings/index";
import { useAnnouncement } from "./hooks/useAnnouncement";
import { initTheme } from "./theme";
import { GET_STARTED_KEY } from "./settings/GetStarted";
// Setup runs once, so it loads on demand instead of with every Settings open.
const Onboarding = lazy(() => import("./settings/Onboarding").then((m) => ({ default: m.Onboarding })));
const ONBOARDING_VERSION = "2.0.0";
import "./Settings.css";
import { has } from "./platform";

const appWindow = getCurrentWebviewWindow();

const ALL_TABS: { id: SettingsTab; label: string; icon: typeof Settings }[] = [
	{ id: "general", label: "General", icon: Settings },
	{ id: "appearance", label: "Appearance", icon: Palette },
	{ id: "notch", label: "Notch", icon: PanelTop },
	{ id: "browser", label: "Browser", icon: Globe },
	{ id: "dock", label: "Dock", icon: Monitor },
	{ id: "overlays", label: "Overlays", icon: Layers },
	{ id: "about", label: "About", icon: Info }
];

// No Dock tab on macOS (it has its own Dock).
const TABS = ALL_TABS.filter((t) => t.id !== "dock" || has("dock"));

function SettingsApp() {
	const [activeTab, setActiveTab] = useState<SettingsTab>("general");
	const settings = useSettings();
	// First-run setup (2.0): shown until finished, and again from About.
	const [showGetStarted, setShowGetStarted] = useState(() => {
		try {
			return localStorage.getItem("bloom-onboarding-complete") !== ONBOARDING_VERSION;
		} catch {
			return false;
		}
	});
	useEffect(() => {
		invoke<Record<string, string>>("load_settings")
			.then((s) => {
				const done = s?.["bloom-onboarding-complete"] === ONBOARDING_VERSION;
				try {
					if (done) localStorage.setItem("bloom-onboarding-complete", ONBOARDING_VERSION);
				} catch {
					/* ignore */
				}
				setShowGetStarted(!done);
			})
			.catch(() => {});
	}, []);
	const finishGetStarted = () => {
		try {
			localStorage.setItem(GET_STARTED_KEY, "1");
			localStorage.setItem("bloom-onboarding-complete", ONBOARDING_VERSION);
		} catch {
			/* ignore */
		}
		setShowGetStarted(false);
	};
	const { announcement, dismissed, dismiss } = useAnnouncement();

	useEffect(() => {
		return initTheme();
	}, []);

	useEffect(() => {
		const preventContext = (e: MouseEvent) => e.preventDefault();
		document.addEventListener("contextmenu", preventContext as any);

		appWindow
			.setEffects({
				effects: ["mica" as Effect],
				state: "active" as any
			})
			.catch(() => {});

		return () => {
			document.removeEventListener("contextmenu", preventContext as any);
		};
	}, []);

	useEffect(() => {
		invoke("resize_settings_window", {
			width: 620 * settings.scale,
			height: 480 * settings.scale
		}).catch(console.error);
	}, [settings.scale]);

	const handleClose = async (e: React.MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();
		try {
			await appWindow.hide();
		} catch {}
	};

	if (showGetStarted) {
		return (
			<div className="settings-container onboarding-mode" style={{ zoom: settings.scale }}>
				<div className="title-bar" data-tauri-drag-region>
					<span className="title-text" data-tauri-drag-region>
						DynIs Setup
					</span>
				</div>
				<Suspense fallback={null}>
				<Onboarding
					islandStyle={settings.islandStyle}
					setIslandStyleValue={settings.setIslandStyleValue}
					islandMaterial={settings.islandMaterial}
					setIslandMaterialValue={settings.setIslandMaterialValue}
					notchEdge={settings.notchEdge}
					setNotchEdgeValue={settings.setNotchEdgeValue}
					onDone={finishGetStarted}
				/>
				</Suspense>
			</div>
		);
	}

	return (
		<div className="settings-container" style={{ zoom: settings.scale }}>
			<div className="title-bar" data-tauri-drag-region>
				<span className="title-text" data-tauri-drag-region>
					Settings
				</span>
				<button className="close-btn" onClick={handleClose} title="Close Settings">
					<X size={12} strokeWidth={1.5} className="close-btn-icon" />
				</button>
			</div>

			<div className="settings-body">
				<div className="settings-sidebar">
					{TABS.map(({ id, label, icon: Icon }) => (
						<button
							key={id}
							className={`sidebar-tab ${activeTab === id ? "active" : ""}`}
							onClick={() => setActiveTab(id)}
						>
							<div className="sidebar-tab-icon">
								<Icon size={14} strokeWidth={1.5} />
							</div>
							<span>{label}</span>
						</button>
					))}
				</div>

				<div className="settings-content">
					{settings.saveError && (
						<div className="settings-save-error" role="alert">
							<span>Changes could not be saved. Your saved settings have been restored.</span>
							<button onClick={settings.dismissSaveError} aria-label="Dismiss save error">
								<X size={14} strokeWidth={2} />
							</button>
						</div>
					)}
					{announcement && !dismissed && (
						<div className={`announcement-banner severity-${announcement.severity}`}>
							<Megaphone size={14} className="announcement-banner-icon" />
							<div className="announcement-banner-text">
								<span className="announcement-banner-title">{announcement.title}</span>
								{announcement.body && (
									<span className="announcement-banner-body">{announcement.body}</span>
								)}
							</div>
							{announcement.url && (
								<button
									className="announcement-banner-link"
									onClick={() => openUrl(announcement.url!)}
								>
									Learn more
								</button>
							)}
							<button className="announcement-banner-close" onClick={dismiss} title="Dismiss">
								<X size={12} strokeWidth={2.2} />
							</button>
						</div>
					)}
					{!showGetStarted && activeTab === "general" && (
						<GeneralTab
							autostart={settings.autostart}
							toggleAutostart={settings.toggleAutostart}
							timeFormat24h={settings.timeFormat24h}
							toggleTimeFormat24h={settings.toggleTimeFormat24h}
							lowBatteryThreshold={settings.lowBatteryThreshold}
							handleThresholdChange={settings.handleThresholdChange}
							restartBloom={settings.restartBloom}
							resetToDefaults={settings.resetToDefaults}
							quitBloom={settings.quitBloom}
						/>
					)}
					{!showGetStarted && activeTab === "appearance" && (
						<AppearanceTab
							scale={settings.scale}
							handleScaleChange={settings.handleScaleChange}
						/>
					)}
					{!showGetStarted && activeTab === "notch" && (
						<NotchTab
							notchMode={settings.notchMode}
							setNotchModeValue={settings.setNotchModeValue}
							notchEdge={settings.notchEdge}
							setNotchEdgeValue={settings.setNotchEdgeValue}
							islandStyle={settings.islandStyle}
							setIslandStyleValue={settings.setIslandStyleValue}
							islandMaterial={settings.islandMaterial}
							setIslandMaterialValue={settings.setIslandMaterialValue}
							notchEdgeDelay={settings.notchEdgeDelay}
							handleNotchEdgeDelayChange={settings.handleNotchEdgeDelayChange}
							calendarEnabled={settings.calendarEnabled}
							toggleCalendar={settings.toggleCalendar}
							notchRememberPanel={settings.notchRememberPanel}
							toggleNotchRememberPanel={settings.toggleNotchRememberPanel}
							notchDefaultPanel={settings.notchDefaultPanel}
							changeNotchDefaultPanel={settings.changeNotchDefaultPanel}
							timerSoundEnabled={settings.timerSoundEnabled}
							toggleTimerSound={settings.toggleTimerSound}
							musicModeEnabled={settings.musicModeEnabled}
							toggleMusicMode={settings.toggleMusicMode}
							musicCompactNotch={settings.musicCompactNotch}
							toggleMusicCompactNotch={settings.toggleMusicCompactNotch}
							shelfPersist={settings.shelfPersist}
							toggleShelfPersist={settings.toggleShelfPersist}
							mediaLayout={settings.mediaLayout}
							toggleMediaLayout={settings.toggleMediaLayout}
							mediaAmbienceEnabled={settings.mediaAmbienceEnabled}
							toggleAmbience={settings.toggleAmbience}
							mediaCompactGlowEnabled={settings.mediaCompactGlowEnabled}
							toggleCompactGlow={settings.toggleCompactGlow}
							weatherEnabled={settings.weatherEnabled}
							toggleWeather={settings.toggleWeather}
							tempUnitFahrenheit={settings.tempUnitFahrenheit}
							toggleTempUnit={settings.toggleTempUnit}
							cityName={settings.cityName}
							setCityName={settings.setCityName}
							citySearchResults={settings.citySearchResults}
							showCityDropdown={settings.showCityDropdown}
							setShowCityDropdown={settings.setShowCityDropdown}
							selectCity={settings.selectCity}
							handleCityClear={settings.handleCityClear}
							statusWidgets={settings.statusWidgets}
							handleWidgetsChange={settings.handleWidgetsChange}
						/>
					)}
					{!showGetStarted && activeTab === "browser" && <BrowserSettings />}
					{!showGetStarted && activeTab === "dock" && (
						<DockTab
							dockEnabled={settings.dockEnabled}
							toggleDock={settings.toggleDock}
							dockMode={settings.dockMode}
							setDockModeValue={settings.setDockModeValue}
							dockEdgeDelay={settings.dockEdgeDelay}
							handleDockEdgeDelayChange={settings.handleDockEdgeDelayChange}
							dockPreviewEnabled={settings.dockPreviewEnabled}
							toggleDockPreview={settings.toggleDockPreview}
							dockIconOnly={settings.dockIconOnly}
							toggleDockIconOnly={settings.toggleDockIconOnly}
							dockSeparatorEnabled={settings.dockSeparatorEnabled}
							toggleDockSeparator={settings.toggleDockSeparator}
							dockAdaptive={settings.dockAdaptive}
							toggleDockAdaptive={settings.toggleDockAdaptive}
							dockWinNumberEnabled={settings.dockWinNumberEnabled}
							toggleDockWinNumber={settings.toggleDockWinNumber}
							dockExtrasPosition={settings.dockExtrasPosition}
							handleDockExtrasPositionChange={settings.handleDockExtrasPositionChange}
							dockExtrasDrives={settings.dockExtrasDrives}
							toggleDockExtrasDrives={settings.toggleDockExtrasDrives}
							dockExtrasHiddenDrives={settings.dockExtrasHiddenDrives}
							toggleDockExtrasDrive={settings.toggleDockExtrasDrive}
							dockExtrasRecycleBin={settings.dockExtrasRecycleBin}
							toggleDockExtrasRecycleBin={settings.toggleDockExtrasRecycleBin}
							dockTaskView={settings.dockTaskView}
							toggleDockTaskView={settings.toggleDockTaskView}
							dockExtrasFolders={settings.dockExtrasFolders}
							toggleDockExtraFolder={settings.toggleDockExtraFolder}
							dockExtrasCustomFolders={settings.dockExtrasCustomFolders}
							handleAddDockExtraFolder={settings.handleAddDockExtraFolder}
							handleRemoveDockExtraFolder={settings.handleRemoveDockExtraFolder}
							startIcon={settings.startIcon}
							handleStartIconChange={settings.handleStartIconChange}
						/>
					)}
					{!showGetStarted && activeTab === "overlays" && (
						<OverlaysTab
							volumeOverlayEnabled={settings.volumeOverlayEnabled}
							toggleVolumeOverlay={settings.toggleVolumeOverlay}
							volumeEdgeEnabled={settings.volumeEdgeEnabled}
							toggleVolumeEdge={settings.toggleVolumeEdge}
							brightnessOverlayEnabled={settings.brightnessOverlayEnabled}
							toggleBrightnessOverlay={settings.toggleBrightnessOverlay}
							brightnessEdgeEnabled={settings.brightnessEdgeEnabled}
							toggleBrightnessEdge={settings.toggleBrightnessEdge}
						/>
					)}
					{!showGetStarted && activeTab === "about" && (
						<AboutTab
							appVersion={settings.appVersion}
							exportStatus={settings.exportStatus}
							importStatus={settings.importStatus}
							handleExportSettings={settings.handleExportSettings}
							handleImportSettings={settings.handleImportSettings}
							onGetStarted={() => setShowGetStarted(true)}
						/>
					)}
				</div>
			</div>
		</div>
	);
}

createRoot(document.getElementById("root") as HTMLElement).render(
	<StrictMode>
		<SettingsApp />
	</StrictMode>
);
