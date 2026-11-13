import {
	PanelTop,
	Move,
	Calendar,
	BellRing,
	Music,
	Minimize2,
	LayoutList,
	Sparkles,
	Circle,
	CloudSun,
	Timer,
	Archive,
	X
} from "lucide-react";
import { SettingRow } from "./SettingRow";
import { ActivitiesSettings } from "./ActivitiesSettings";
import { CalendarSettings } from "./CalendarSettings";
import { SpotifySettings } from "./SpotifySettings";
import { StatusWidgetConfig } from "../components/StatusWidgetConfig";
import type { WidgetConfig } from "./types";
import { has, isLinux } from "../platform";

/** What each notch behaviour does, shown under "Notch Behavior". */
export function notchBehaviorDesc(mode: string): string {
	switch (mode) {
		case "overlay":
			return "Always visible, floating over windows";
		case "fixed":
			return "Always visible, with space reserved for it on the screen";
		case "peek":
			return "Hidden until media, alerts or the screen edge bring it out";
		default:
			return "Floats over windows and steps aside for maximized and full-screen apps";
	}
}

interface NotchTabProps {
	notchMode: string;
	setNotchModeValue: (mode: string) => void;
	notchEdge: string;
	setNotchEdgeValue: (edge: string) => void;
	islandStyle: string;
	setIslandStyleValue: (style: string) => void;
	islandMaterial: string;
	setIslandMaterialValue: (material: string) => void;
	notchEdgeDelay: number;
	handleNotchEdgeDelayChange: (val: number) => void;
	calendarEnabled: boolean;
	toggleCalendar: () => void;
	notchRememberPanel: boolean;
	toggleNotchRememberPanel: () => void;
	notchDefaultPanel: "home" | "calendar" | "command-center";
	changeNotchDefaultPanel: (panel: "home" | "calendar" | "command-center") => void;
	timerSoundEnabled: boolean;
	toggleTimerSound: () => void;
	musicModeEnabled: boolean;
	toggleMusicMode: () => void;
	musicCompactNotch: boolean;
	toggleMusicCompactNotch: () => void;
	shelfPersist: boolean;
	toggleShelfPersist: () => void;
	mediaLayout: "classic" | "compact";
	toggleMediaLayout: (layout: "classic" | "compact") => void;
	mediaAmbienceEnabled: boolean;
	toggleAmbience: () => void;
	mediaCompactGlowEnabled: boolean;
	toggleCompactGlow: () => void;
	weatherEnabled: boolean;
	toggleWeather: () => void;
	tempUnitFahrenheit: boolean;
	toggleTempUnit: () => void;
	cityName: string;
	setCityName: (name: string) => void;
	citySearchResults: Array<{ name: string; country: string; latitude: number; longitude: number }>;
	showCityDropdown: boolean;
	setShowCityDropdown: (show: boolean) => void;
	selectCity: (city: {
		name: string;
		country: string;
		latitude: number;
		longitude: number;
	}) => void;
	handleCityClear: () => void;
	statusWidgets: WidgetConfig;
	handleWidgetsChange: (config: WidgetConfig) => void;
}

export function NotchTab({
	notchMode,
	setNotchModeValue,
	notchEdge,
	setNotchEdgeValue,
	islandStyle,
	setIslandStyleValue,
	islandMaterial,
	setIslandMaterialValue,
	notchEdgeDelay,
	handleNotchEdgeDelayChange,
	calendarEnabled,
	toggleCalendar,
	notchRememberPanel,
	toggleNotchRememberPanel,
	notchDefaultPanel,
	changeNotchDefaultPanel,
	timerSoundEnabled,
	toggleTimerSound,
	musicModeEnabled,
	toggleMusicMode,
	musicCompactNotch,
	toggleMusicCompactNotch,
	shelfPersist,
	toggleShelfPersist,
	mediaLayout,
	toggleMediaLayout,
	mediaAmbienceEnabled,
	toggleAmbience,
	mediaCompactGlowEnabled,
	toggleCompactGlow,
	weatherEnabled,
	toggleWeather,
	tempUnitFahrenheit,
	toggleTempUnit,
	cityName,
	setCityName,
	citySearchResults,
	showCityDropdown,
	setShowCityDropdown,
	selectCity,
	handleCityClear,
	statusWidgets,
	handleWidgetsChange
}: NotchTabProps) {
	return (
		<>
			<div className="setting-group-label">Notch</div>
			<div className="setting-group">
				<SettingRow icon={PanelTop} label="Notch Behavior" desc={notchBehaviorDesc(notchMode)}>
					<select
						className="settings-select"
						value={notchMode === "fixed" ? "overlay" : notchMode}
						onChange={(e) => setNotchModeValue(e.target.value)}
					>
						<option value="smart">Smart</option>
						<option value="overlay">Overlay</option>
						<option value="peek">Peek</option>
					</select>
				</SettingRow>

				{/* Linux never reserves screen space (Smart and Overlay only). */}
				{(notchMode === "overlay" || notchMode === "fixed") && !isLinux && (
					<SettingRow
						icon={PanelTop}
						label="Reserve Space (Windows Stay Below the Island)"
						desc={`Keeps a strip at the ${notchEdge === "bottom" ? "bottom" : "top"} of the screen for the island. Maximized windows won't cover that strip, so they're shorter than the screen.`}
					>
						<label className="toggle-switch">
							<input
								type="checkbox"
								aria-label="Reserve space for the island"
								checked={notchMode === "fixed"}
								onChange={(e) => setNotchModeValue(e.target.checked ? "fixed" : "overlay")}
							/>
							<span className="slider"></span>
						</label>
					</SettingRow>
				)}

				<SettingRow icon={PanelTop} label="Island Style" desc="Floating capsule or the classic notch">
					<select
						className="settings-select"
						value={islandStyle}
						onChange={(e) => setIslandStyleValue(e.target.value)}
					>
						<option value="pill">Capsule</option>
						<option value="notch">Classic</option>
					</select>
				</SettingRow>

				{islandStyle === "pill" && (
					<SettingRow icon={Sparkles} label="Island Material" desc="Solid ink or frosted glass">
						<select
							className="settings-select"
							value={islandMaterial}
							onChange={(e) => setIslandMaterialValue(e.target.value)}
						>
							<option value="ink">Ink</option>
							<option value="glass">Glass</option>
							{has("live-blur") && <option value="glass-live">Glass (live blur)</option>}
						</select>
					</SettingRow>
				)}
				{islandStyle === "pill" && islandMaterial === "glass-live" && (
					<p className="setting-note">
						Live blur hides DynIs from screenshots, recordings and screen sharing while it's on.
						Choose Ink or Glass to show DynIs in them again.
					</p>
				)}

				<SettingRow icon={Move} label="Position" desc="Screen edge the island sits on">
					<select
						className="settings-select"
						value={notchEdge}
						onChange={(e) => setNotchEdgeValue(e.target.value)}
					>
						<option value="top">Top</option>
						<option value="bottom">Bottom</option>
					</select>
				</SettingRow>

				{(notchMode === "smart" || notchMode === "peek") && (
					<SettingRow
						icon={Timer}
						label="Peek Delay"
						desc={
							notchEdgeDelay === 0
								? "Reveal instantly on top-edge contact"
								: `Rest on the top edge for ${notchEdgeDelay}ms to reveal`
						}
					>
						<input
							type="range"
							min="0"
							max="800"
							step="50"
							value={notchEdgeDelay}
							onChange={(e) => handleNotchEdgeDelayChange(parseInt(e.target.value))}
							className="settings-slider"
						/>
					</SettingRow>
				)}

				<SettingRow
					icon={PanelTop}
					label="Remember Last Panel"
					desc="Reopen the panel you last used; turn off to choose a fixed default"
				>
					<label className="toggle-switch">
						<input type="checkbox" checked={notchRememberPanel} onChange={toggleNotchRememberPanel} />
						<span className="slider"></span>
					</label>
				</SettingRow>

				{!notchRememberPanel && (
					<SettingRow icon={PanelTop} label="Default Panel" desc="Open this panel when you click the notch">
						<select
							className="settings-select"
							value={calendarEnabled || notchDefaultPanel !== "calendar" ? notchDefaultPanel : "home"}
							onChange={(e) =>
								changeNotchDefaultPanel(e.target.value as "home" | "calendar" | "command-center")
							}
						>
							<option value="home">Home</option>
							<option value="calendar" disabled={!calendarEnabled}>Calendar</option>
							<option value="command-center">Command Center</option>
						</select>
					</SettingRow>
				)}

				<SettingRow icon={Calendar} label="Calendar & Timer" desc="Enable productivity split-view">
					<label className="toggle-switch">
						<input type="checkbox" checked={calendarEnabled} onChange={toggleCalendar} />
						<span className="slider"></span>
					</label>
				</SettingRow>

				{calendarEnabled && (
					<SettingRow
						icon={BellRing}
						label="Timer Sound"
						desc="Play a chime when the timer finishes"
					>
						<label className="toggle-switch">
							<input type="checkbox" checked={timerSoundEnabled} onChange={toggleTimerSound} />
							<span className="slider"></span>
						</label>
					</SettingRow>
				)}

				<SettingRow icon={Music} label="Music Mode" desc="Interactive live music widget">
					<label className="toggle-switch">
						<input type="checkbox" checked={musicModeEnabled} onChange={toggleMusicMode} />
						<span className="slider"></span>
					</label>
				</SettingRow>

				{musicModeEnabled && (
					<>
						<SettingRow
							icon={Minimize2}
							label="Compact Mode"
							desc="Show visualizer & artwork when collapsed"
						>
							<label className="toggle-switch">
								<input
									type="checkbox"
									checked={musicCompactNotch}
									onChange={toggleMusicCompactNotch}
								/>
								<span className="slider"></span>
							</label>
						</SettingRow>

						<SettingRow icon={LayoutList} label="Media Layout" desc="Choose expanded player style">
							<div className="unit-toggle-minimal wide">
								<span
									className={mediaLayout === "classic" ? "active" : ""}
									onClick={() => toggleMediaLayout("classic")}
								>
									Classic
								</span>
								<span
									className={mediaLayout === "compact" ? "active" : ""}
									onClick={() => toggleMediaLayout("compact")}
								>
									Compact
								</span>
							</div>
						</SettingRow>

						<SettingRow
							icon={Sparkles}
							label="Ambient Glow"
							desc="Colored glow behind expanded album art"
						>
							<label className="toggle-switch">
								<input type="checkbox" checked={mediaAmbienceEnabled} onChange={toggleAmbience} />
								<span className="slider"></span>
							</label>
						</SettingRow>

						<SettingRow
							icon={Circle}
							label="Compact Glow"
							desc="Glow around collapsed thumbnail"
							divider={false}
						>
							<label className="toggle-switch">
								<input
									type="checkbox"
									checked={mediaCompactGlowEnabled}
									onChange={toggleCompactGlow}
								/>
								<span className="slider"></span>
							</label>
						</SettingRow>
					</>
				)}
			</div>

			<div className="setting-group-label">Shelf</div>
			<div className="setting-group">
				<SettingRow
					icon={Archive}
					label="Keep Items"
					desc="Keep shelf items after DynIs closes"
					divider={false}
				>
					<label className="toggle-switch">
						<input type="checkbox" checked={shelfPersist} onChange={toggleShelfPersist} />
						<span className="slider"></span>
					</label>
				</SettingRow>
			</div>

			<div className="setting-group-label">Weather</div>
			<div className="setting-group">
				<SettingRow
					icon={CloudSun}
					label="Weather Status"
					desc={cityName || "Auto-detect location"}
				>
					<div className="weather-controls">
						<div className="unit-toggle-minimal" onClick={toggleTempUnit}>
							<span className={!tempUnitFahrenheit ? "active" : ""}>C</span>
							<span className={tempUnitFahrenheit ? "active" : ""}>F</span>
						</div>
						<label className="toggle-switch">
							<input type="checkbox" checked={weatherEnabled} onChange={toggleWeather} />
							<span className="slider"></span>
						</label>
					</div>
				</SettingRow>

				{weatherEnabled && (
					<div className="manual-city-input">
						<div className="city-input-row">
							<input
								type="text"
								placeholder="Search city..."
								value={cityName}
								onChange={(e) => setCityName(e.target.value)}
								onFocus={() => citySearchResults.length > 0 && setShowCityDropdown(true)}
								onKeyDown={(e) => {
									if (e.key === "Enter" && citySearchResults.length > 0) {
										e.preventDefault();
										selectCity(citySearchResults[0]);
									}
									if (e.key === "Escape") {
										setShowCityDropdown(false);
									}
								}}
								onBlur={() => setTimeout(() => setShowCityDropdown(false), 150)}
							/>
							{cityName && (
								<button
									className="city-clear-btn"
									onMouseDown={(e) => {
										e.preventDefault();
										handleCityClear();
									}}
									title="Clear city"
								>
									<X size={10} strokeWidth={2.5} />
								</button>
							)}
						</div>
						{showCityDropdown && citySearchResults.length > 0 && (
							<div className="city-dropdown">
								{citySearchResults.map((city) => (
									<button
										key={`${city.name}-${city.latitude}`}
										className="city-dropdown-item"
										onMouseDown={(e) => {
											e.preventDefault();
											selectCity(city);
										}}
									>
										<span className="city-dropdown-name">{city.name}</span>
										<span className="city-dropdown-country">{city.country}</span>
									</button>
								))}
							</div>
						)}
					</div>
				)}
			</div>

			<div className="setting-group-label">Widgets</div>
			<div className="setting-group">
				<StatusWidgetConfig value={statusWidgets} onChange={handleWidgetsChange} />
			</div>
			<ActivitiesSettings />
			<CalendarSettings />
			{has("spotify") && <SpotifySettings />}
		</>
	);
}
