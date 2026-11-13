# DynIs 2.0.0 design audit

Checked against Apple's Human Interface Guidelines principles, as summarised by the
apple-design skill (its full reference pages weren't available on this PC, so
findings below are judgement against those rules, not page quotes).
Surfaces: island (Classic/Capsule), activities and bubbles, Home, Widgets and
editor, Control Center and editor, command search, Settings, setup flow,
About/changelog, tray.

Severity: **C** critical · **H** high · **M** medium · **L** low. Status: ✅ fixed in 2.0.0, ⏳ open.

## Accessibility

| # | Where | Rule | Sev | Fix | Status |
|---|---|---|---|---|---|
| A1 | `App.css` (day names, calendar days, old CC titles/status 7.5–10px, timer labels), `Overlay.css`, `Dock.css`, `QuickPanel.css`, `Settings.css`, `ink.css` badge | Minimum text size (desktop ≥10pt; DynIs token ≥11px) | C | 23 declarations raised to 11px (decorative "•" separator exempt) | ✅ |
| A2 | `App.tsx` timer reset button | Icon-only control needs a name | C | `aria-label` + tooltip "Reset timer"; duplicate `title` removed | ✅ |
| A3 | All icon-only buttons in island, editors, Home | Icon-only control needs a name | C | Re-scanned: every icon-only `<button>` now has `aria-label` (+ `title`) | ✅ |
| A4 | Secondary text `--label-2` rgba(235,235,245,.6) | Contrast ≥4.5:1 | — | On Ink #000 ≈ 6.2:1; on tile fill (≈#262628) ≈ 4.9:1; on Glass (≥72% dark) over white wallpaper ≈ 4.6:1 | ✅ passes |
| A5 | Increased contrast | Answer for "more contrast" | H | `prefers-contrast: more`: label-2 → 86%, hairline 40%, tile outlines | ✅ |
| A6 | Reduced transparency / transparency effects off | Solid Ink fallback | — | Already in place (Glass, Glass live) | ✅ |
| A7 | Reduced motion | Fades only | — | Springs swap to 120 ms fades; jiggle, spinner, disc, liquid edge stop | ✅ |
| A8 | Hit targets | ≥28 default, ≥20 min | — | Badges 20px (minimum), others 28–48px | ✅ passes |
| A9 | Keyboard: setup, editors | Full keyboard path, visible focus | M | Setup: Enter/Esc; editors: Tab + Delete; focus rings 2px 60% white | ✅ |
| A10 | Keyboard reorder in editors | Reorder without a mouse | L | Focus a tile, Space/Enter to pick up, arrows to move, Space/Enter to drop, Esc to cancel; spoken announcements (Widgets and Control Center) | ✅ |

## Conventions

| # | Where | Rule | Sev | Fix | Status |
|---|---|---|---|---|---|
| B1 | Tray during setup | Only relevant actions | M | "Open Setup" + "Quit DynIs" until setup is done, then the full menu | ✅ |
| B2 | Setup | Skippable, short, honest | — | Optional steps have "Set Up Later"; resume on relaunch; purpose line per step | ✅ |
| B3 | `CommandCenterGrid.tsx` empty state | Platform wording ("click", not "tap") | H | "No controls yet. Click Edit Controls, then Add." | ✅ |

## Visual craft

| # | Where | Rule | Sev | Fix | Status |
|---|---|---|---|---|---|
| C1 | Colour meanings | One colour = one meaning | — | green connected/charging/done · orange timer · red alert/low · purple focus · blue transfers · album colour music. No conflicts found in island surfaces | ✅ passes |
| C2 | Settings selections used the old accent blue | Blue means "transfer" in DynIs | L | Switches green (system on); chips and dock cards use a neutral selected state | ✅ |
| C3 | Spring values | Consistent motion | L | All island springs use 420/34/0.9; reduced motion still swaps to fades | ✅ |
| C4 | Long text | Truncate with ellipsis | — | Titles, artists, copies, events, widgets use ellipsis | ✅ |

## Interaction & writing

| # | Where | Rule | Sev | Fix | Status |
|---|---|---|---|---|---|
| D1 | Google Calendar errors | Say what went wrong and how to fix it | M | Messages now name the problem and the next step (check Client ID/secret, Sign Out then Connect, click Connect again) | ✅ |
| D2 | Extension install errors | Same | M | "The extension folder is missing. Reinstall DynIs…", "Brave, Chrome or Edge wasn't found on this PC." | ✅ |
| D3 | Weather widget | Loading shows something; errors offer a fix | — | 10 s timeout, "Couldn't load weather · Retry" | ✅ |
| D4 | Buttons | Title-style capitalisation | M | "Set Up Later", "Open Browser", "Install Browser Extension", "Run Setup Again", "Sign Out", "See All" | ✅ |
| D5 | Jargon in UI | No internal terms | — | No AUMID/GSMTC/PKCE/native host/wpndatabase in user-facing text | ✅ passes |

## Widgets (from Kevin's screenshot)

| # | Where | Rule | Sev | Fix | Status |
|---|---|---|---|---|---|
| E1 | Open panel on Glass | Content must stay legible; no page showing through | H | Open surface 96% near-black on Glass and Ink | ✅ |
| E2 | Widgets grid | Use the space; consistent rhythm | M | 3 equal columns, dense flow, 8px gap | ✅ |
| E3 | Cards | One card style | M | Radius 16, padding 12, neutral 6% fill (no blue weather card) | ✅ |
| E4 | System values ("121 GB…") | No truncated numbers | M | "Disk free 121 GB"; network ↓ with ↑ underneath; rounded rates | ✅ |
| E5 | Next events without a calendar | Offer the fix in place | M | "No calendar" + Connect Calendar button | ✅ |
| E6 | Tabs | Only the selection is filled | L | Inactive tabs are text with hover | ✅ |
| E7 | Motion | Transform/opacity only | L | Music progress now animates with transform instead of width | ✅ |

**Counts:** Critical 3 (all fixed) · High 3 (all fixed) · Medium 9 (all fixed) · Low 5 (all fixed). Nothing open.
