// DynIs web media bridge: content script. Reads now playing and up next from
// the page, and runs play/pause/next/previous/seek/jump commands from the
// island. Reads media information only.
//
// No polling: the script waits for a media element to play, then follows
// media events and (throttled) page changes, and sends the state only when
// it changed. Selectors have fallbacks; when a site changes its page, the
// affected part (usually the queue) is simply left out.

(function () {
	"use strict";
	if (window.__dynisMedia) return;
	window.__dynisMedia = true;

	var M = globalThis.DynIsMedia;
	var runtime = (globalThis.browser && globalThis.browser.runtime) || chrome.runtime;
	var site = M.siteFor(location.hostname);
	var enabled = true;
	var started = false;
	var last = null;
	var queueEls = [];
	var timer = null;
	var observer = null;

	// ── Helpers ──

	function q(sel, rootEl) {
		try {
			return (rootEl || document).querySelector(sel);
		} catch (e) {
			return null;
		}
	}

	function qa(sel, rootEl) {
		try {
			return Array.prototype.slice.call((rootEl || document).querySelectorAll(sel));
		} catch (e) {
			return [];
		}
	}

	/** First match of several selectors. */
	function first(sels, rootEl) {
		for (var i = 0; i < sels.length; i++) {
			var el = q(sels[i], rootEl);
			if (el) return el;
		}
		return null;
	}

	function text(el) {
		return el ? (el.textContent || "").trim() : "";
	}

	function imgSrc(el) {
		if (!el) return null;
		var img = el.tagName === "IMG" ? el : q("img", el);
		if (img && (img.currentSrc || img.src)) return img.currentSrc || img.src;
		var bg = el.style && el.style.backgroundImage;
		var m = bg && bg.match(/url\(["']?([^"')]+)["']?\)/);
		return m ? m[1] : null;
	}

	function visible(el) {
		return !!el && !el.hidden && el.getAttribute("aria-hidden") !== "true" && (el.offsetParent !== null || el.getClientRects().length > 0);
	}

	/** The page's main media element: playing first, then the longest. */
	function mediaEl() {
		var els = qa("video, audio");
		var best = null;
		for (var i = 0; i < els.length; i++) {
			var e = els[i];
			if (!e.currentSrc && !e.src) continue;
			if (!best || (!e.paused && best.paused) || (e.paused === best.paused && (e.duration || 0) > (best.duration || 0))) best = e;
		}
		return best;
	}

	/** What the page published through the Media Session API. */
	function sessionMeta() {
		try {
			var md = navigator.mediaSession && navigator.mediaSession.metadata;
			if (!md || !md.title) return null;
			var art = null;
			var list = md.artwork || [];
			for (var i = 0; i < list.length; i++) if (list[i] && list[i].src) art = list[i].src; // last = largest
			return { title: md.title, artist: md.artist || "", art: art };
		} catch (e) {
			return null;
		}
	}

	function sessionPlaying() {
		try {
			return navigator.mediaSession && navigator.mediaSession.playbackState === "playing";
		} catch (e) {
			return false;
		}
	}

	// ── Site adapters: read ──

	var adapters = {
		youtube: {
			meta: function () {
				return {
					title: text(first(["h1.ytd-watch-metadata yt-formatted-string", "#title h1", "h1.title"])),
					artist: text(first(["ytd-watch-metadata #owner #channel-name a", "#owner-name a", "ytd-channel-name a"])),
					art: M.youtubeThumb(location.href)
				};
			},
			queue: function () {
				var rows = qa("ytd-playlist-panel-renderer#playlist ytd-playlist-panel-video-renderer");
				if (rows.length) {
					return {
						kind: "queue",
						items: rows.map(function (r) {
							var a = q("a#wc-endpoint, a", r);
							return {
								title: text(q("#video-title", r)),
								artist: text(q("#byline, #channel-name", r)),
								art: imgSrc(q("#thumbnail, img", r)),
								href: a && a.href,
								selected: r.hasAttribute("selected"),
								el: a || r
							};
						})
					};
				}
				// No playlist: the up-next / autoplay suggestions.
				var items = qa("ytd-watch-next-secondary-results-renderer ytd-compact-video-renderer, ytd-watch-next-secondary-results-renderer yt-lockup-view-model")
					.slice(0, 5)
					.map(function (r) {
						var a = q("a#thumbnail, a[href*='/watch']", r);
						return {
							title: text(first(["#video-title", "h3 a", "h3", "[class*='metadata'] a"], r)),
							artist: text(first(["ytd-channel-name #text", "#channel-name", "[class*='metadata-row'] span"], r)),
							art: imgSrc(q("img", r)),
							href: a && a.href,
							el: a
						};
					});
				return { kind: "upnext", items: items };
			},
			buttons: {
				next: [".ytp-next-button"],
				prev: [".ytp-prev-button"],
				play: [".ytp-play-button"]
			},
			canSeek: true
		},
		ytmusic: {
			meta: function () {
				var bar = q("ytmusic-player-bar");
				return {
					title: text(q(".title", bar)),
					artist: text(q(".byline", bar)),
					art: imgSrc(q(".image, img", bar))
				};
			},
			queue: function () {
				var rows = qa("ytmusic-player-queue ytmusic-player-queue-item, #queue ytmusic-player-queue-item");
				return {
					kind: "queue",
					items: rows.map(function (r) {
						return {
							title: text(q(".song-title", r)),
							artist: text(q(".byline", r)),
							art: imgSrc(q("img", r)),
							selected: r.hasAttribute("selected") || /playing|paused/.test(r.getAttribute("play-button-state") || ""),
							el: q("ytmusic-play-button-renderer", r) || r
						};
					})
				};
			},
			buttons: {
				next: ["ytmusic-player-bar .next-button", "tp-yt-paper-icon-button.next-button"],
				prev: ["ytmusic-player-bar .previous-button", "tp-yt-paper-icon-button.previous-button"],
				play: ["ytmusic-player-bar #play-pause-button", "#play-pause-button"]
			},
			canSeek: true
		},
		spotify: {
			meta: function () {
				var w = first(["[data-testid='now-playing-widget']", "footer"]);
				return {
					title: text(first(["[data-testid='context-item-info-title']", "[data-testid='context-item-link']"], w)),
					artist: text(first(["[data-testid='context-item-info-subtitles']", "[data-testid='context-item-info-artist']"], w)),
					art: imgSrc(first(["[data-testid='cover-art-image']", "img"], w)),
					positionMs: M.parseClock(text(q("[data-testid='playback-position']"))),
					durationMs: M.parseClock(text(q("[data-testid='playback-duration']"))),
					playing: (function () {
						var b = q("[data-testid='control-button-playpause']");
						return b ? /pause/i.test(b.getAttribute("aria-label") || "") : null;
					})()
				};
			},
			queue: function () {
				// Only while the Queue panel is open (the page has no queue otherwise).
				var panel = first(["[data-testid='queue-page']", "aside[aria-label*='Queue' i]", "[aria-label='Queue']"]);
				if (!panel) return null;
				var rows = qa("[data-testid='tracklist-row']", panel);
				return {
					kind: "queue",
					firstIsCurrent: true,
					items: rows.map(function (r) {
						var artists = qa("a[href*='/artist/']", r).map(text).join(", ");
						return {
							title: text(first(["[data-testid='internal-track-link'] div", "a[href*='/track/']", "[dir='auto']"], r)),
							artist: artists,
							art: imgSrc(q("img", r)),
							el: r
						};
					})
				};
			},
			buttons: {
				next: ["[data-testid='control-button-skip-forward']"],
				prev: ["[data-testid='control-button-skip-back']"],
				play: ["[data-testid='control-button-playpause']"]
			},
			canSeek: true
		},
		applemusic: {
			meta: function () {
				return {};
			},
			queue: function () {
				var rows = qa("[data-testid='upnext-item'], amp-up-next-queue-item, .upnext-item, .queue-item");
				if (!rows.length) return null;
				return {
					kind: "queue",
					items: rows.map(function (r) {
						return {
							title: text(first(["[data-testid='track-title']", ".title", ".song-name"], r)),
							artist: text(first(["[data-testid='track-artist']", ".artist", ".by-line"], r)),
							art: imgSrc(q("img, picture", r)),
							selected: r.classList.contains("is-current") || r.getAttribute("aria-current") === "true",
							el: r
						};
					})
				};
			},
			buttons: {
				next: ["button[data-testid='playback-controls-skip-forward']", "amp-playback-controls-item-skip.next-button button", "button[aria-label='Next']"],
				prev: ["button[data-testid='playback-controls-skip-back']", "amp-playback-controls-item-skip.previous-button button", "button[aria-label='Previous']"],
				play: ["button[data-testid='playback-controls-play-pause']", "amp-playback-controls-play button", "button[aria-label='Play'], button[aria-label='Pause']"]
			},
			canSeek: true
		},
		soundcloud: {
			meta: function () {
				var t = q(".playbackSoundBadge__titleLink");
				return {
					title: t ? t.getAttribute("title") || text(t) : "",
					artist: text(q(".playbackSoundBadge__lightLink")),
					art: imgSrc(q(".playbackSoundBadge .sc-artwork span, .playbackSoundBadge span.sc-artwork")),
					positionMs: M.parseClock(text(q(".playbackTimeline__timePassed span[aria-hidden='true'], .playbackTimeline__timePassed span:last-child"))),
					durationMs: M.parseClock(text(q(".playbackTimeline__duration span[aria-hidden='true'], .playbackTimeline__duration span:last-child"))),
					playing: (function () {
						var b = q(".playControls .playControl");
						return b ? b.classList.contains("playing") : null;
					})()
				};
			},
			queue: function () {
				var rows = qa(".queue__itemWrapper .queueItemView, .queue .queueItemView");
				if (!rows.length) return null;
				return {
					kind: "queue",
					items: rows.map(function (r) {
						return {
							title: text(q(".queueItemView__title a, .queueItemView__title", r)),
							artist: text(q(".queueItemView__username a, .queueItemView__username", r)),
							art: imgSrc(q(".queueItemView__artwork span, .sc-artwork span", r)),
							selected: r.classList.contains("m-active") || r.classList.contains("m-playing"),
							el: q(".queueItemView__play, .sc-button-play", r) || r
						};
					})
				};
			},
			buttons: {
				next: [".playControls .skipControl__next"],
				prev: [".playControls .skipControl__previous"],
				play: [".playControls .playControl"]
			},
			canSeek: true
		},
		generic: {
			meta: function () {
				return {};
			},
			queue: function () {
				return null;
			},
			buttons: { next: [], prev: [], play: [] },
			canSeek: true
		}
	};

	var ad = adapters[site];

	function read() {
		var media = mediaEl();
		var session = sessionMeta();
		var page = {};
		try {
			page = ad.meta() || {};
		} catch (e) {
			page = {};
		}
		var meta = {
			title: (session && session.title) || page.title,
			artist: (session && session.artist) || page.artist,
			art: (session && session.art) || page.art
		};
		var durationMs = media && isFinite(media.duration) && media.duration > 0 ? media.duration * 1000 : page.durationMs;
		var positionMs = media && isFinite(media.currentTime) ? media.currentTime * 1000 : page.positionMs;
		var playing = media ? !media.paused && !media.ended : page.playing != null ? page.playing : sessionPlaying();
		if (site === "spotify" && page.playing != null) playing = page.playing;
		var raw = null;
		try {
			raw = ad.queue();
		} catch (e) {
			raw = null;
		}
		queueEls = raw && raw.items ? raw.items.map(function (i) { return i.el || null; }) : [];
		var nextBtn = first(ad.buttons.next);
		return M.buildState(
			{
				site: site,
				title: meta.title,
				artist: meta.artist,
				art: meta.art,
				durationMs: durationMs,
				positionMs: positionMs,
				playing: playing,
				canNext: visible(nextBtn) || (raw && raw.kind === "upnext" && raw.items.length > 0),
				canPrev: true,
				canSeek: ad.canSeek && (!!media || site === "spotify" || site === "soundcloud"),
				queue: raw
			},
			Date.now()
		);
	}

	function send(force) {
		timer = null;
		if (!enabled) return;
		var state = read();
		if (!force && !M.stateChanged(last, state)) return;
		last = state;
		try {
			runtime.sendMessage({ kind: "state", site: site, state: state });
		} catch (e) {
			/* extension reloaded: ignore */
		}
	}

	/** At most one read every 600 ms while the page keeps changing. */
	function schedule() {
		if (!timer) timer = setTimeout(send, 600);
	}

	function onMediaEvent(e) {
		var t = e.target;
		if (!t || (t.tagName !== "VIDEO" && t.tagName !== "AUDIO")) return;
		if (!started && e.type === "play") start();
		if (!started) return;
		// Play, pause and seek change the position the island counts from.
		if (e.type === "play" || e.type === "pause" || e.type === "seeked" || e.type === "ratechange") {
			clearTimeout(timer);
			timer = setTimeout(function () { send(true); }, 120);
		} else {
			schedule();
		}
	}

	/** Start following the page once something plays. */
	function start() {
		if (started || !enabled) return;
		started = true;
		observer = new MutationObserver(schedule);
		observer.observe(document.body || document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["aria-label", "selected", "class", "title"] });
		send(true);
	}

	function stop() {
		started = false;
		if (observer) observer.disconnect();
		observer = null;
		clearTimeout(timer);
		timer = null;
		if (last) {
			last = null;
			try {
				runtime.sendMessage({ kind: "state", site: site, state: null });
			} catch (e) {
				/* ignore */
			}
		}
	}

	["play", "pause", "seeked", "ratechange", "durationchange", "loadedmetadata", "emptied", "ended"].forEach(function (type) {
		document.addEventListener(type, onMediaEvent, true);
	});
	// Spotify and SoundCloud can play without a media element in the page.
	if (site === "spotify" || site === "soundcloud") {
		document.addEventListener("click", function () {
			if (started || !enabled) return;
			setTimeout(function () {
				var s = read();
				if (!started && s && s.playing) start();
			}, 800);
		}, true);
	}
	window.addEventListener("pagehide", function () { stop(); });

	// ── Commands ──

	function click(sels) {
		var b = first(sels);
		if (b && !b.disabled) {
			b.click();
			return true;
		}
		return false;
	}

	function seekTo(ms) {
		var media = mediaEl();
		if (media && isFinite(media.duration)) {
			media.currentTime = Math.max(0, Math.min(media.duration, ms / 1000));
			return true;
		}
		// No media element (Spotify, SoundCloud): click the progress bar.
		var bar = first(["[data-testid='playback-progressbar']", ".playbackTimeline__progressWrapper"]);
		var dur = last && last.durationMs;
		if (!bar || !dur) return false;
		var r = bar.getBoundingClientRect();
		var x = r.left + (r.width * Math.max(0, Math.min(1, ms / dur)));
		var y = r.top + r.height / 2;
		["pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach(function (type) {
			var Ev = type.indexOf("pointer") === 0 && typeof PointerEvent !== "undefined" ? PointerEvent : MouseEvent;
			bar.dispatchEvent(new Ev(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }));
		});
		return true;
	}

	function playPause(want) {
		var media = mediaEl();
		var playing = last ? last.playing : media ? !media.paused : false;
		if (want === "play" && playing) return true;
		if (want === "pause" && !playing) return true;
		if (click(ad.buttons.play)) return true;
		if (media) {
			if (media.paused) media.play().catch(function () {});
			else media.pause();
			return true;
		}
		return false;
	}

	function next() {
		if (click(ad.buttons.next)) return true;
		// YouTube without a playlist: open the up-next video.
		if (site === "youtube" && last && last.queueKind === "upnext") return jump(last.queue[0] && last.queue[0].index);
		return false;
	}

	function previous() {
		var media = mediaEl();
		var pos = media ? media.currentTime * 1000 : last ? last.positionMs : 0;
		if (M.previousAction(pos) === "restart") return seekTo(0);
		if (click(ad.buttons.prev)) return true;
		if (site === "youtube") {
			history.back();
			return true;
		}
		return seekTo(0);
	}

	function jump(index) {
		var el = typeof index === "number" ? queueEls[index] : null;
		if (!el) return false;
		el.click();
		if (site === "spotify") el.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
		return true;
	}

	function run(cmd) {
		switch (cmd.action) {
			case "play":
			case "pause":
			case "toggle":
				return playPause(cmd.action);
			case "next":
				return next();
			case "previous":
				return previous();
			case "seek":
				return seekTo(cmd.positionMs);
			case "jump":
				return jump(cmd.index);
		}
		return false;
	}

	runtime.onMessage.addListener(function (msg) {
		if (!msg || typeof msg !== "object") return;
		if (msg.kind === "command") {
			var cmd = M.parseCommand(msg.command);
			if (cmd && enabled) {
				run(cmd);
				setTimeout(function () { send(true); }, 400);
			}
		} else if (msg.kind === "config") {
			enabled = M.isSiteEnabled(msg.config, site);
			if (!enabled) stop();
		}
	});

	// Ask whether this site is turned on in DynIs (Settings → Browser).
	try {
		var hello = runtime.sendMessage({ kind: "hello", site: site });
		if (hello && typeof hello.then === "function") {
			hello.then(function (res) {
				if (res && res.enabled === false) {
					enabled = false;
					stop();
				}
			}).catch(function () {});
		}
	} catch (e) {
		/* ignore */
	}
	// Something may already be playing (the script loads after the page).
	var m0 = mediaEl();
	if (m0 && !m0.paused) start();
})();
