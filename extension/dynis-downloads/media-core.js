// DynIs web media bridge: pure helpers shared by the content script, the
// background script and the unit tests (src/webMediaCore.test.ts). No DOM, no
// browser APIs here. Loaded as a classic script (globalThis.DynIsMedia) in the
// extension and with require() in tests.
//
// Privacy: only media information is read from pages (title, artist or
// channel, artwork address, duration, position, playing state and the
// up-next list). Nothing else is read, and nothing leaves this PC: it goes to
// the DynIs app through native messaging.

(function (root) {
	"use strict";

	/** Protocol version, sent with every message to the app. */
	var PROTOCOL = 1;

	var SITES = ["youtube", "ytmusic", "spotify", "applemusic", "soundcloud", "generic"];

	var SITE_LABELS = {
		youtube: "YouTube",
		ytmusic: "YouTube Music",
		spotify: "Spotify",
		applemusic: "Apple Music",
		soundcloud: "SoundCloud",
		generic: "Web"
	};

	/** Which adapter a page uses. */
	function siteFor(hostname) {
		var h = String(hostname || "").toLowerCase();
		if (h === "music.youtube.com") return "ytmusic";
		if (h === "www.youtube.com" || h === "youtube.com" || h === "m.youtube.com") return "youtube";
		if (h === "open.spotify.com") return "spotify";
		if (h === "music.apple.com" || h === "beta.music.apple.com") return "applemusic";
		if (h === "soundcloud.com" || h === "m.soundcloud.com") return "soundcloud";
		return "generic";
	}

	/** Every site on by default except "Other sites" (needs a permission too). */
	function defaultSites() {
		return { youtube: true, ytmusic: true, spotify: true, applemusic: true, soundcloud: true, generic: false };
	}

	function isSiteEnabled(config, site) {
		var sites = (config && config.sites) || defaultSites();
		if (typeof sites[site] === "boolean") return sites[site];
		return defaultSites()[site] === true;
	}

	/** "3:45" / "1:02:03" → ms. Anything else → null. */
	function parseClock(text) {
		var t = String(text || "").trim().replace(/^-/, "");
		if (!/^\d{1,3}(:\d{1,2}){1,2}$/.test(t)) return null;
		var parts = t.split(":").map(Number);
		var s = 0;
		for (var i = 0; i < parts.length; i++) s = s * 60 + parts[i];
		return s * 1000;
	}

	function cleanText(s, max) {
		var t = String(s == null ? "" : s).replace(/\s+/g, " ").trim();
		var limit = max || 200;
		return t.length > limit ? t.slice(0, limit - 1) + "…" : t;
	}

	/** Only https images reach the island. */
	function cleanArt(url) {
		var u = String(url || "").trim();
		if (/^\/\//.test(u)) u = "https:" + u;
		return /^https:\/\/[^\s"'<>]+$/.test(u) ? u.slice(0, 1000) : null;
	}

	/** The video id from a YouTube watch link. */
	function youtubeId(href) {
		var m = String(href || "").match(/[?&]v=([\w-]{6,20})/) || String(href || "").match(/youtu\.be\/([\w-]{6,20})/);
		return m ? m[1] : null;
	}

	/** A thumbnail address from the video id, for lazily loaded rows. */
	function youtubeThumb(href) {
		var id = youtubeId(href);
		return id ? "https://i.ytimg.com/vi/" + id + "/mqdefault.jpg" : null;
	}

	/** YouTube's channel line sometimes carries "• 1.2M views": keep the name. */
	function cleanArtist(site, s) {
		var t = cleanText(s, 120);
		if (site === "youtube" || site === "ytmusic") t = t.split(/\s[•·]\s/)[0].trim();
		return t;
	}

	var MAX_QUEUE = 10;

	/**
	 * Raw rows read from the page → the up-next list.
	 *   raw.kind: "queue" (a real queue/playlist) or "upnext" (suggestions,
	 *   YouTube without a playlist).
	 *   raw.items: [{ title, artist, art, href, selected }] in page order.
	 * Rows before and including the selected (playing) one are dropped. Each
	 * item keeps `index`, its position in raw.items, for "jump to".
	 */
	function normalizeQueue(site, raw) {
		if (!raw || !Array.isArray(raw.items) || raw.items.length === 0) return { kind: "none", items: [] };
		var kind = raw.kind === "upnext" ? "upnext" : "queue";
		var start = 0;
		for (var i = 0; i < raw.items.length; i++) {
			if (raw.items[i] && raw.items[i].selected) start = i + 1;
		}
		// Spotify's queue page lists "Now playing" first without marking it.
		if (site === "spotify" && raw.firstIsCurrent && start === 0) start = 1;
		var items = [];
		var seen = {};
		for (var j = start; j < raw.items.length && items.length < MAX_QUEUE; j++) {
			var it = raw.items[j];
			if (!it) continue;
			var title = cleanText(it.title, 160);
			if (!title) continue;
			var key = (it.href || "") + "|" + title;
			if (seen[key]) continue;
			seen[key] = true;
			items.push({
				title: title,
				artist: cleanArtist(site, it.artist),
				art: cleanArt(it.art) || (site === "youtube" ? youtubeThumb(it.href) : null),
				index: j
			});
		}
		return { kind: items.length ? kind : "none", items: items };
	}

	/**
	 * Everything the content script read → the state sent to the app.
	 * raw: { site, title, artist, art, durationMs, positionMs, playing,
	 *        canNext, canPrev, canSeek, queue }
	 */
	function buildState(raw, now) {
		if (!raw || !raw.site) return null;
		var title = cleanText(raw.title, 200);
		if (!title) return null;
		var duration = Number(raw.durationMs);
		var position = Number(raw.positionMs);
		var dur = isFinite(duration) && duration > 0 ? Math.round(duration) : null;
		var pos = isFinite(position) && position >= 0 ? Math.round(position) : null;
		if (dur !== null && pos !== null && pos > dur) pos = dur;
		var queue = normalizeQueue(raw.site, raw.queue);
		return {
			site: raw.site,
			source: SITE_LABELS[raw.site] || "Web",
			title: title,
			artist: cleanArtist(raw.site, raw.artist),
			art: cleanArt(raw.art),
			durationMs: dur,
			positionMs: pos,
			positionAt: typeof now === "number" ? now : Date.now(),
			playing: !!raw.playing,
			canNext: !!raw.canNext || queue.items.length > 0,
			canPrev: raw.canPrev !== false,
			canSeek: !!raw.canSeek && dur !== null,
			queueKind: queue.kind,
			queue: queue.items
		};
	}

	/** True when two states differ in anything but the clock position. */
	function stateChanged(a, b) {
		if (!a || !b) return a !== b;
		var keys = ["site", "title", "artist", "art", "durationMs", "playing", "canNext", "canPrev", "canSeek", "queueKind"];
		for (var i = 0; i < keys.length; i++) if (a[keys[i]] !== b[keys[i]]) return true;
		if (a.queue.length !== b.queue.length) return true;
		for (var j = 0; j < a.queue.length; j++) {
			if (a.queue[j].title !== b.queue[j].title || a.queue[j].artist !== b.queue[j].artist || a.queue[j].art !== b.queue[j].art) return true;
		}
		return false;
	}

	/**
	 * Which tab reports: the one playing that started most recently, else the
	 * one that played most recently. tabs: [{ tabId, state, lastPlayingAt }].
	 */
	function pickActiveTab(tabs) {
		var best = null;
		for (var i = 0; i < tabs.length; i++) {
			var t = tabs[i];
			if (!t || !t.state) continue;
			if (!best) {
				best = t;
				continue;
			}
			var tp = !!t.state.playing;
			var bp = !!best.state.playing;
			if (tp !== bp) {
				if (tp) best = t;
			} else if ((t.lastPlayingAt || 0) > (best.lastPlayingAt || 0)) {
				best = t;
			}
		}
		return best;
	}

	/** "Previous": restart the song when more than 3 s in, else go back. */
	function previousAction(positionMs) {
		return Number(positionMs) > 3000 ? "restart" : "previous";
	}

	var ACTIONS = ["play", "pause", "toggle", "next", "previous", "seek", "jump"];

	/** A command from the app, checked. Returns null when malformed. */
	function parseCommand(msg) {
		if (!msg || msg.type !== "command" || ACTIONS.indexOf(msg.action) < 0) return null;
		var cmd = { action: msg.action };
		if (msg.action === "seek") {
			var p = Number(msg.positionMs);
			if (!isFinite(p) || p < 0) return null;
			cmd.positionMs = Math.round(p);
		}
		if (msg.action === "jump") {
			var i = Number(msg.index);
			if (!isFinite(i) || i < 0 || Math.floor(i) !== i) return null;
			cmd.index = i;
		}
		return cmd;
	}

	/** A config message from the app → { sites }. */
	function parseConfig(msg) {
		if (!msg || msg.type !== "config" || typeof msg.sites !== "object" || !msg.sites) return null;
		var sites = defaultSites();
		for (var i = 0; i < SITES.length; i++) {
			if (typeof msg.sites[SITES[i]] === "boolean") sites[SITES[i]] = msg.sites[SITES[i]];
		}
		return { sites: sites };
	}

	/** The message the background sends the app. */
	function mediaMessage(state, browser) {
		return { type: "media", protocol: PROTOCOL, browser: cleanText(browser, 40) || "Browser", media: state || null };
	}

	/** The browser's name from its user agent (Brave is told apart by the caller). */
	function browserName(userAgent, isBrave) {
		var ua = String(userAgent || "");
		if (isBrave) return "Brave";
		if (/Firefox\//.test(ua)) return "Firefox";
		if (/Edg\//.test(ua)) return "Edge";
		if (/OPR\//.test(ua)) return "Opera";
		if (/Vivaldi\//.test(ua)) return "Vivaldi";
		if (/Chrome\//.test(ua)) return "Chrome";
		return "Browser";
	}

	var api = {
		PROTOCOL: PROTOCOL,
		SITES: SITES,
		SITE_LABELS: SITE_LABELS,
		siteFor: siteFor,
		defaultSites: defaultSites,
		isSiteEnabled: isSiteEnabled,
		parseClock: parseClock,
		cleanText: cleanText,
		cleanArt: cleanArt,
		youtubeId: youtubeId,
		youtubeThumb: youtubeThumb,
		normalizeQueue: normalizeQueue,
		buildState: buildState,
		stateChanged: stateChanged,
		pickActiveTab: pickActiveTab,
		previousAction: previousAction,
		parseCommand: parseCommand,
		parseConfig: parseConfig,
		mediaMessage: mediaMessage,
		browserName: browserName
	};
	root.DynIsMedia = api;
	if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
