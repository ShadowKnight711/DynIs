import { describe, expect, test } from "bun:test";
import { DEFAULT_LAYOUT, addedSingles, moonName, moonPhase, parseLayout } from "./widgetsLayout";

describe("widgets layout", () => {
	test("fresh install gets Weather, System, Month in that order", () => {
		expect(parseLayout(null).map((w) => w.kind)).toEqual(["weather", "system", "month"]);
		expect(parseLayout("not json").map((w) => w.kind)).toEqual(["weather", "system", "month"]);
		expect(DEFAULT_LAYOUT.length).toBe(3);
	});

	test("keeps a saved layout and drops unknown kinds", () => {
		const saved = JSON.stringify([
			{ id: "a", kind: "system", size: "large" },
			{ id: "b", kind: "teleporter", size: "small" },
			{ id: "c", kind: "note", size: "small" }
		]);
		expect(parseLayout(saved).map((w) => w.kind)).toEqual(["system", "note"]);
	});

	test("migrates the beta world clock and its zone", () => {
		const [w] = parseLayout([{ id: "clock-1", kind: "clock", size: "small", zone: "Asia/Tokyo" }]);
		expect(w.kind).toBe("worldclock");
		expect(w.opts?.zone).toBe("Asia/Tokyo");
	});

	test("fixes sizes and removes duplicate single widgets and ids", () => {
		const out = parseLayout([
			{ id: "w", kind: "weather", size: "huge" },
			{ id: "w", kind: "weather", size: "small" },
			{ id: "n", kind: "note", size: "large" },
			{ id: "n", kind: "note", size: "small" }
		]);
		expect(out.map((w) => w.kind)).toEqual(["weather", "note", "note"]);
		expect(out[0].size).toBe("large");
		expect(new Set(out.map((w) => w.id)).size).toBe(3);
	});

	test("marks single-instance widgets as added", () => {
		const added = addedSingles(parseLayout(null));
		expect(added.has("weather")).toBe(true);
		expect(added.has("note")).toBe(false);
	});

	test("moon phase is a full moon on a known date", () => {
		// 2024-01-25 was a full moon.
		expect(moonName(moonPhase(new Date(Date.UTC(2024, 0, 25, 18))))).toBe("Full Moon");
	});
});
