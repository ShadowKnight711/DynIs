/** The screen edge the island is attached to (`bloom-notch-edge`). */
export type NotchEdge = "top" | "bottom";

/** Unknown values, and the retired "left"/"right" positions, become "top". */
export function parseNotchEdge(value: unknown): NotchEdge {
	return value === "bottom" ? "bottom" : "top";
}

/**
 * The pill's translation for an inward offset from its edge: positive moves it
 * into the screen, negative retracts it into (past) the edge it hangs from.
 */
export function edgeOffset(edge: NotchEdge, inset: number): { x: number; y: number } {
	return edge === "bottom" ? { x: 0, y: -inset } : { x: 0, y: inset };
}

/**
 * Corner radii for a pill attached to `edge`: the two corners against the
 * edge take `edgeRadius` (0 when it merges into the edge), the other two
 * `farRadius`.
 */
export function cornerRadii(edge: NotchEdge, edgeRadius: number, farRadius: number) {
	const top = edge === "top";
	return {
		borderTopLeftRadius: top ? edgeRadius : farRadius,
		borderTopRightRadius: top ? edgeRadius : farRadius,
		borderBottomLeftRadius: top ? farRadius : edgeRadius,
		borderBottomRightRadius: top ? farRadius : edgeRadius
	};
}
