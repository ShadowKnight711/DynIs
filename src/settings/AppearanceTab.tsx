import { Maximize2 } from "lucide-react";
import { SettingRow } from "./SettingRow";

// DynIs has one look, Dark (the solid Ink island), so there is no theme
// picker (2.0.1). Appearance keeps only the size control.
interface AppearanceTabProps {
	scale: number;
	handleScaleChange: (val: number) => void;
}

export function AppearanceTab({ scale, handleScaleChange }: AppearanceTabProps) {
	return (
		<>
			<div className="setting-group-label">Display</div>
			<div className="setting-group">
				<SettingRow
					icon={Maximize2}
					label="UI & Font Scale"
					desc={`Adjust desktop size (${Math.round(scale * 100)}%)`}
					divider={false}
				>
					<div className="scale-button-container">
						<button
							onClick={() => handleScaleChange(Math.max(0.8, parseFloat((scale - 0.1).toFixed(1))))}
							disabled={scale <= 0.8}
							className="scale-adjust-btn"
							title="Decrease Scale"
							aria-label="Decrease scale"
						>
							—
						</button>
						<span className="scale-display-value">{Math.round(scale * 100)}%</span>
						<button
							onClick={() => handleScaleChange(Math.min(1.3, parseFloat((scale + 0.1).toFixed(1))))}
							disabled={scale >= 1.3}
							className="scale-adjust-btn"
							title="Increase Scale"
							aria-label="Increase scale"
						>
							+
						</button>
					</div>
				</SettingRow>
			</div>
		</>
	);
}
