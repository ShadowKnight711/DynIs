export interface Announcement {
	id: string;
	severity: "info" | "warning";
	title: string;
	body: string;
	url?: string;
}

const NO_OP = () => {};

/**
 * DynIs has no remote announcement feed (the original Bloom fetched one from
 * its website). The hook keeps its shape so callers compile, but never shows
 * an announcement and makes no network requests.
 */
export function useAnnouncement(): {
	announcement: Announcement | null;
	dismissed: boolean;
	dismiss: () => void;
} {
	return { announcement: null, dismissed: true, dismiss: NO_OP };
}
