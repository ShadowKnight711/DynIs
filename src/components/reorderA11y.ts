import type { Announcements, ScreenReaderInstructions } from "@dnd-kit/core";

/**
 * Keyboard reorder for the Widgets and Control Center editors:
 * focus a tile, Space or Enter to pick it up, arrow keys to move,
 * Space or Enter to drop, Esc to cancel. Spoken by screen readers.
 */
export const reorderInstructions: ScreenReaderInstructions = {
	draggable: "To move this tile, press Space or Enter. Use the arrow keys to move it, Space or Enter to drop it, or Escape to cancel."
};

export function reorderAnnouncements(ids: string[], nameOf: (id: string) => string): Announcements {
	const pos = (id: string | number) => `position ${ids.indexOf(String(id)) + 1} of ${ids.length}`;
	return {
		onDragStart: ({ active }) => `Picked up ${nameOf(String(active.id))}, ${pos(active.id)}.`,
		onDragOver: ({ active, over }) => (over ? `${nameOf(String(active.id))} moved to ${pos(over.id)}.` : undefined),
		onDragEnd: ({ active, over }) =>
			over ? `Dropped ${nameOf(String(active.id))} at ${pos(over.id)}.` : `Dropped ${nameOf(String(active.id))}.`,
		onDragCancel: ({ active }) => `Move cancelled. ${nameOf(String(active.id))} is back where it was.`
	};
}
