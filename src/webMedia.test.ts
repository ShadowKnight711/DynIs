import { describe, expect, test } from "bun:test";
import {
	chooseMedia,
	isBrowserSource,
	parseWebSites,
	webQueueForHome,
	webSourceLabel,
	webToMediaInfo,
	type MediaInfoLike,
	type WebMediaState
} from "./webMedia";

const web = (playing: boolean, extra: Partial<WebMediaState["media"] & object> = {}): WebMediaState => ({
	updated: 1,
	connected: true,
	browser: "Brave",
	media: {
		site: "youtube",
		source: "YouTube",
		title: "Video",
		artist: "Channel",
		art: "https://i.ytimg.com/vi/x/mqdefault.jpg",
		durationMs: 60_000,
		positionMs: 5_000,
		positionAt: 1000,
		playing,
		canNext: true,
		canPrev: true,
		canSeek: true,
		queueKind: "upnext",
		queue: [{ title: "Next video", artist: "Other", art: null, index: 3 }],
		...extra
	}
});

const sys = (source: string, playing: boolean): MediaInfoLike => ({
	title: "Song",
	artist: "Artist",
	is_playing: playing,
	has_media: true,
	source_app: source
});

describe("choosing what the island shows", () => {
	test("the extension wins over the browser's own media session", () => {
		expect(chooseMedia(sys("Brave", true), 10, web(true), 5, false)).toBe("web");
		expect(chooseMedia(sys("msedge.exe", false), 10, web(false), 5, false)).toBe("web");
		expect(chooseMedia(null, 0, web(false), 0, false)).toBe("web");
	});

	test("another app playing keeps the island unless the tab started later", () => {
		expect(chooseMedia(sys("Spotify.exe", true), 100, web(false), 0, false)).toBe("system");
		expect(chooseMedia(sys("Spotify.exe", true), 100, web(true), 50, false)).toBe("system");
		expect(chooseMedia(sys("Spotify.exe", true), 100, web(true), 200, false)).toBe("web");
		expect(chooseMedia(sys("Spotify.exe", false), 100, web(true), 50, false)).toBe("web");
		expect(chooseMedia(sys("Spotify.exe", false), 100, web(false), 50, false)).toBe("system");
	});

	test("Ignore Browser Media turns the extension off; so does a closed browser", () => {
		expect(chooseMedia(sys("Brave", true), 1, web(true), 2, true)).toBe("system");
		expect(chooseMedia(sys("Brave", true), 1, { ...web(true), connected: false }, 2, false)).toBe("system");
		expect(chooseMedia(sys("Brave", true), 1, null, 2, false)).toBe("system");
	});

	test("recognises browsers' media sessions", () => {
		for (const id of ["Brave", "Chrome", "MSEdge", "308046B0AF4A39CB", "firefox.exe", "Opera"]) {
			expect(isBrowserSource(id)).toBe(true);
		}
		expect(isBrowserSource("Spotify.exe")).toBe(false);
		expect(isBrowserSource(undefined)).toBe(false);
	});
});

describe("web media in the island", () => {
	test("becomes the island's media with a source label", () => {
		const info = webToMediaInfo(web(true))!;
		expect(info).toMatchObject({
			title: "Video",
			artist: "Channel",
			is_playing: true,
			has_media: true,
			artwork: ["https://i.ytimg.com/vi/x/mqdefault.jpg"],
			position_ms: 5000,
			duration_ms: 60_000,
			seek_enabled: true,
			position_updated_at: 1000,
			shuffle: null,
			repeat: null,
			source_app: "web:YouTube · Brave"
		});
		expect(webSourceLabel(web(true))).toBe("YouTube · Brave");
		expect(webToMediaInfo({ ...web(true), media: null })).toBeNull();
	});

	test("up next rows keep the page index for jumping", () => {
		const q = webQueueForHome(web(true))!;
		expect(q.next).toEqual([{ id: "web-3-0", uri: "", name: "Next video", artist: "Other", art: null }]);
		expect(webQueueForHome(web(true, { queue: [] }))).toBeNull();
	});

	test("per-site settings default to on, except other sites", () => {
		expect(parseWebSites(null)).toEqual({ youtube: true, ytmusic: true, spotify: true, applemusic: true, soundcloud: true, generic: false });
		expect(parseWebSites('{"youtube":false,"generic":true}')).toMatchObject({ youtube: false, generic: true, spotify: true });
		expect(parseWebSites("broken")).toMatchObject({ youtube: true });
	});
});
