import { describe, expect, test } from "bun:test";
import { createRequire } from "node:module";

// The extension's shared core (a classic script that also exports for tests).
const require = createRequire(import.meta.url);
const M = require("../extension/dynis-downloads/media-core.js");

const art = (n: string) => `https://cdn.example.com/${n}.jpg`;

describe("which site a page is", () => {
	test("maps hosts to adapters", () => {
		expect(M.siteFor("www.youtube.com")).toBe("youtube");
		expect(M.siteFor("m.youtube.com")).toBe("youtube");
		expect(M.siteFor("music.youtube.com")).toBe("ytmusic");
		expect(M.siteFor("open.spotify.com")).toBe("spotify");
		expect(M.siteFor("music.apple.com")).toBe("applemusic");
		expect(M.siteFor("soundcloud.com")).toBe("soundcloud");
		expect(M.siteFor("example.com")).toBe("generic");
		expect(M.siteFor("youtube.com.evil.example")).toBe("generic");
	});

	test("sites are on by default, except other sites", () => {
		expect(M.isSiteEnabled(null, "youtube")).toBe(true);
		expect(M.isSiteEnabled(null, "generic")).toBe(false);
		expect(M.isSiteEnabled({ sites: { youtube: false } }, "youtube")).toBe(false);
		expect(M.isSiteEnabled({ sites: { youtube: false } }, "spotify")).toBe(true);
	});
});

describe("queue per site (fixtures of what each page gives)", () => {
	test("YouTube playlist: rows after the playing one, thumbnails from the video id", () => {
		const q = M.normalizeQueue("youtube", {
			kind: "queue",
			items: [
				{ title: "Intro", artist: "Band", href: "https://www.youtube.com/watch?v=aaaaaaaaaaa&list=PL1", art: art("1") },
				{ title: "Song A", artist: "Band", href: "https://www.youtube.com/watch?v=bbbbbbbbbbb&list=PL1", selected: true },
				{ title: "  Song   B ", artist: "Band • 1.2M views", href: "https://www.youtube.com/watch?v=ccccccccccc&list=PL1", art: "" },
				{ title: "Song C", artist: "Band", href: "https://www.youtube.com/watch?v=ddddddddddd&list=PL1", art: art("4") }
			]
		});
		expect(q.kind).toBe("queue");
		expect(q.items).toEqual([
			{ title: "Song B", artist: "Band", art: "https://i.ytimg.com/vi/ccccccccccc/mqdefault.jpg", index: 2 },
			{ title: "Song C", artist: "Band", art: art("4"), index: 3 }
		]);
	});

	test("YouTube without a playlist: the up-next suggestions", () => {
		const q = M.normalizeQueue("youtube", {
			kind: "upnext",
			items: [
				{ title: "Autoplay video", artist: "Channel", href: "/watch?v=eeeeeeeeeee" },
				{ title: "Another", artist: "Other", href: "/watch?v=fffffffffff" },
				{ title: "", artist: "No title" }
			]
		});
		expect(q.kind).toBe("upnext");
		expect(q.items.map((i: { title: string }) => i.title)).toEqual(["Autoplay video", "Another"]);
		expect(q.items[0].art).toBe("https://i.ytimg.com/vi/eeeeeeeeeee/mqdefault.jpg");
	});

	test("YouTube Music queue: after the selected row", () => {
		const q = M.normalizeQueue("ytmusic", {
			kind: "queue",
			items: [
				{ title: "Played", artist: "A • Album", selected: false },
				{ title: "Now", artist: "A", selected: true },
				{ title: "Next", artist: "B • Single • 2024", art: art("n") }
			]
		});
		expect(q.items).toEqual([{ title: "Next", artist: "B", art: art("n"), index: 2 }]);
	});

	test("Spotify Web queue panel: the first row is now playing", () => {
		const q = M.normalizeQueue("spotify", {
			kind: "queue",
			firstIsCurrent: true,
			items: [
				{ title: "Now playing", artist: "X" },
				{ title: "Queued", artist: "Y, Z", art: art("q") },
				{ title: "From the playlist", artist: "W" }
			]
		});
		expect(q.items.map((i: { title: string; index: number }) => [i.title, i.index])).toEqual([
			["Queued", 1],
			["From the playlist", 2]
		]);
	});

	test("SoundCloud Next Up: after the active row; Apple Music: after the current one", () => {
		const sc = M.normalizeQueue("soundcloud", {
			kind: "queue",
			items: [
				{ title: "Old", artist: "u1" },
				{ title: "Playing", artist: "u2", selected: true },
				{ title: "Up", artist: "u3", art: "//i1.sndcdn.com/artworks-1-t50x50.jpg" }
			]
		});
		expect(sc.items).toEqual([{ title: "Up", artist: "u3", art: "https://i1.sndcdn.com/artworks-1-t50x50.jpg", index: 2 }]);
		const am = M.normalizeQueue("applemusic", { kind: "queue", items: [{ title: "Next song", artist: "Artist" }] });
		expect(am.items).toHaveLength(1);
	});

	test("no queue on the page, duplicates and limits", () => {
		expect(M.normalizeQueue("spotify", null)).toEqual({ kind: "none", items: [] });
		expect(M.normalizeQueue("generic", { kind: "queue", items: [] })).toEqual({ kind: "none", items: [] });
		const dup = M.normalizeQueue("ytmusic", { kind: "queue", items: [{ title: "Same" }, { title: "Same" }] });
		expect(dup.items).toHaveLength(1);
		const many = M.normalizeQueue("ytmusic", { kind: "queue", items: Array.from({ length: 40 }, (_, i) => ({ title: `S${i}` })) });
		expect(many.items).toHaveLength(10);
		const bad = M.normalizeQueue("ytmusic", { kind: "queue", items: [{ title: "x", art: "javascript:alert(1)" }, { title: "y", art: "http://insecure/a.jpg" }] });
		expect(bad.items.map((i: { art: string | null }) => i.art)).toEqual([null, null]);
	});
});

describe("state sent to the app", () => {
	test("builds a bounded state with the queue", () => {
		const s = M.buildState(
			{
				site: "ytmusic",
				title: "  Song ",
				artist: "Artist • Album",
				art: art("a"),
				durationMs: 200_000.4,
				positionMs: 250_000,
				playing: true,
				canNext: false,
				canSeek: true,
				queue: { kind: "queue", items: [{ title: "Now", selected: true }, { title: "Next" }] }
			},
			1234
		);
		expect(s).toMatchObject({
			site: "ytmusic",
			source: "YouTube Music",
			title: "Song",
			artist: "Artist",
			durationMs: 200_000,
			positionMs: 200_000, // never past the end
			positionAt: 1234,
			playing: true,
			canNext: true, // a queue means there is a next song
			canSeek: true,
			queueKind: "queue"
		});
		expect(s.queue).toHaveLength(1);
		expect(M.buildState({ site: "youtube", title: " " })).toBeNull();
		expect(M.buildState({ site: "youtube", title: "Live", durationMs: Infinity, canSeek: true })).toMatchObject({ durationMs: null, canSeek: false });
	});

	test("only real changes are sent (not the moving clock)", () => {
		const a = M.buildState({ site: "youtube", title: "A", positionMs: 1000, playing: true }, 1);
		const b = M.buildState({ site: "youtube", title: "A", positionMs: 9000, playing: true }, 2);
		expect(M.stateChanged(a, b)).toBe(false);
		expect(M.stateChanged(a, { ...b, playing: false })).toBe(true);
		expect(M.stateChanged(a, null)).toBe(true);
		expect(M.stateChanged(null, null)).toBe(false);
	});

	test("only the tab playing most recently reports", () => {
		const st = (playing: boolean) => ({ playing });
		const pick = M.pickActiveTab([
			{ tabId: 1, state: st(true), lastPlayingAt: 100 },
			{ tabId: 2, state: st(true), lastPlayingAt: 300 },
			{ tabId: 3, state: st(false), lastPlayingAt: 900 }
		]);
		expect(pick.tabId).toBe(2);
		expect(M.pickActiveTab([{ tabId: 3, state: st(false), lastPlayingAt: 900 }, { tabId: 4, state: st(false), lastPlayingAt: 50 }]).tabId).toBe(3);
		expect(M.pickActiveTab([])).toBeNull();
	});

	test("the message carries the protocol and browser", () => {
		expect(M.mediaMessage(null, "Brave")).toEqual({ type: "media", protocol: 1, browser: "Brave", media: null });
		expect(M.browserName("Mozilla/5.0 … Firefox/128.0", false)).toBe("Firefox");
		expect(M.browserName("… Chrome/130 Safari/537.36 Edg/130", false)).toBe("Edge");
		expect(M.browserName("… Chrome/130 Safari/537.36", true)).toBe("Brave");
		expect(M.browserName("… Chrome/130 Safari/537.36", false)).toBe("Chrome");
	});
});

describe("commands from the island", () => {
	test("are checked before running", () => {
		expect(M.parseCommand({ type: "command", action: "next" })).toEqual({ action: "next" });
		expect(M.parseCommand({ type: "command", action: "seek", positionMs: 61_000.6 })).toEqual({ action: "seek", positionMs: 61_001 });
		expect(M.parseCommand({ type: "command", action: "seek", positionMs: -5 })).toBeNull();
		expect(M.parseCommand({ type: "command", action: "jump", index: 2 })).toEqual({ action: "jump", index: 2 });
		expect(M.parseCommand({ type: "command", action: "jump", index: 1.5 })).toBeNull();
		expect(M.parseCommand({ type: "command", action: "eval" })).toBeNull();
		expect(M.parseCommand({ type: "config" })).toBeNull();
	});

	test("previous restarts the song after 3 s, else goes back", () => {
		expect(M.previousAction(3001)).toBe("restart");
		expect(M.previousAction(3000)).toBe("previous");
		expect(M.previousAction(0)).toBe("previous");
	});

	test("config keeps known sites only", () => {
		expect(M.parseConfig({ type: "config", sites: { youtube: false, evil: true } })).toEqual({
			sites: { youtube: false, ytmusic: true, spotify: true, applemusic: true, soundcloud: true, generic: false }
		});
		expect(M.parseConfig({ type: "config" })).toBeNull();
	});

	test("clock text and links", () => {
		expect(M.parseClock("3:45")).toBe(225_000);
		expect(M.parseClock("1:02:03")).toBe(3_723_000);
		expect(M.parseClock("-0:30")).toBe(30_000);
		expect(M.parseClock("LIVE")).toBeNull();
		expect(M.youtubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1")).toBe("dQw4w9WgXcQ");
		expect(M.youtubeId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
		expect(M.youtubeId("https://example.com")).toBeNull();
	});
});

describe("both browser builds", () => {
	test("Chromium and Firefox ship the same scripts and version", async () => {
		const { readFileSync } = await import("node:fs");
		const read = (p: string) => readFileSync(new URL(`../extension/${p}`, import.meta.url), "utf8");
		for (const f of ["media-core.js", "content.js", "background.js", "options.js", "options.html"]) {
			expect(read(`dynis-downloads-firefox/${f}`)).toBe(read(`dynis-downloads/${f}`));
		}
		const c = JSON.parse(read("dynis-downloads/manifest.json"));
		const f = JSON.parse(read("dynis-downloads-firefox/manifest.json"));
		expect(f.version).toBe(c.version);
		expect(f.browser_specific_settings.gecko.id).toBe("downloads@dynis.kevin");
		// Content scripts only on the media sites; everything else is optional.
		expect(c.content_scripts[0].matches.every((m: string) => /^https:\/\/(www|music|open|soundcloud)\./.test(m) || m === "https://soundcloud.com/*")).toBe(true);
		expect(c.host_permissions).toBeUndefined();
		expect(c.optional_host_permissions).toEqual(["<all_urls>"]);
	});
});
