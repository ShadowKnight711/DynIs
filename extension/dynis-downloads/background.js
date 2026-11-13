// DynIs Downloads & Media: reports in-progress browser downloads and the
// media playing in your tabs to the DynIs app on this PC through native
// messaging (host "com.kevin.dynis"), and runs the island's media controls.
//
// Downloads: only the file name, byte counts and state are sent; no URLs, no
// history. Media: only now playing and up next (title, artist or channel,
// artwork address, duration, position, playing state) from the supported
// music and video sites, and only for sites turned on in DynIs (Settings →
// Browser). Nothing is sent over the internet.

if (typeof importScripts === "function" && !globalThis.DynIsMedia) importScripts("media-core.js");

const M = globalThis.DynIsMedia;
const api = globalThis.browser || chrome;
const HOST = "com.kevin.dynis";
let port = null;
let timer = null;
let lastSample = new Map(); // id -> { bytes, at }

// ── Native connection ──

function connect() {
	if (port) return port;
	try {
		port = api.runtime.connectNative(HOST);
		port.onDisconnect.addListener(() => {
			port = null;
			lastSent = null;
			// DynIs not running or not installed: try again on the next change.
			stopPolling();
		});
		port.onMessage.addListener(onAppMessage);
	} catch {
		port = null;
	}
	return port;
}

function post(message) {
	const p = connect();
	if (!p) return false;
	try {
		p.postMessage(message);
		return true;
	} catch {
		port = null;
		return false;
	}
}

// ── Downloads ──

function baseName(path) {
	return (path || "").split(/[\\/]/).pop() || "Download";
}

async function report() {
	const items = await api.downloads.search({ state: "in_progress" });
	const now = Date.now();
	const downloads = items.map((d) => {
		const prev = lastSample.get(d.id);
		const speed = prev && now > prev.at ? ((d.bytesReceived - prev.bytes) * 1000) / (now - prev.at) : 0;
		lastSample.set(d.id, { bytes: d.bytesReceived, at: now });
		return {
			id: String(d.id),
			name: baseName(d.filename),
			received: d.bytesReceived,
			total: d.totalBytes > 0 ? d.totalBytes : null,
			speed: Math.max(0, Math.round(speed)),
			paused: !!d.paused
		};
	});
	post({ type: "downloads", downloads });
	if (downloads.length === 0) stopPolling();
}

function startPolling() {
	if (timer) return;
	report();
	timer = setInterval(report, 1000);
}

function stopPolling() {
	if (timer) clearInterval(timer);
	timer = null;
	lastSample.clear();
}

api.downloads.onCreated.addListener(startPolling);

api.downloads.onChanged.addListener((delta) => {
	if (delta.state && delta.state.current !== "in_progress") {
		api.downloads.search({ id: delta.id }).then(([d]) => {
			if (d) {
				post({
					type: "finished",
					id: String(d.id),
					name: baseName(d.filename),
					state: d.state, // "complete" or "interrupted"
					path: d.state === "complete" ? d.filename : null
				});
			}
		});
	}
	startPolling();
});

// Resume reporting after the browser restarts with downloads still running.
api.runtime.onStartup.addListener(startPolling);
api.runtime.onInstalled.addListener(startPolling);

// ── Media ──

/** tabId -> { tabId, site, state, lastPlayingAt } */
const tabs = new Map();
let config = { sites: M.defaultSites() };
let lastSent = null;
let activeTabId = null;
let browserName = M.browserName(navigator.userAgent, false);

(async () => {
	try {
		if (navigator.brave && (await navigator.brave.isBrave())) browserName = "Brave";
	} catch {
		/* not Brave */
	}
})();

// Remember the sites setting across service-worker restarts.
api.storage?.local?.get("config").then((v) => {
	if (v && v.config && v.config.sites) config = v.config;
	syncGenericScript();
}).catch(() => {});

function publish() {
	const active = M.pickActiveTab([...tabs.values()].filter((t) => M.isSiteEnabled(config, t.site)));
	activeTabId = active ? active.tabId : null;
	const state = active ? active.state : null;
	// Only on change: a new song, play/pause, a seek (new position), or a new queue.
	const changed =
		M.stateChanged(lastSent, state) ||
		(state && lastSent && (state.positionMs !== lastSent.positionMs || state.positionAt !== lastSent.positionAt));
	if (!changed) return;
	// Nothing to report and nothing reported before: don't start DynIs's host.
	if (!state && !lastSent && !port) return;
	if (post(M.mediaMessage(state, browserName))) lastSent = state;
}

function onAppMessage(msg) {
	const cfg = M.parseConfig(msg);
	if (cfg) {
		config = cfg;
		api.storage?.local?.set({ config: cfg }).catch(() => {});
		syncGenericScript();
		for (const t of tabs.values()) {
			api.tabs.sendMessage(t.tabId, { kind: "config", config: cfg }).catch(() => {});
		}
		lastSent = null;
		publish();
		return;
	}
	const cmd = M.parseCommand(msg);
	if (cmd && activeTabId !== null) {
		api.tabs.sendMessage(activeTabId, { kind: "command", command: msg }).catch(() => {});
	}
}

api.runtime.onMessage.addListener((msg, sender, reply) => {
	const tabId = sender && sender.tab ? sender.tab.id : null;
	if (!msg || tabId === null || tabId === undefined) return;
	if (msg.kind === "hello") {
		reply({ enabled: M.isSiteEnabled(config, msg.site) });
		return;
	}
	if (msg.kind === "state") {
		if (!msg.state) {
			tabs.delete(tabId);
		} else {
			const prev = tabs.get(tabId);
			tabs.set(tabId, {
				tabId,
				site: msg.site,
				state: msg.state,
				lastPlayingAt: msg.state.playing && !(prev && prev.state.playing) ? Date.now() : prev ? prev.lastPlayingAt : 0
			});
		}
		publish();
	}
});

api.tabs.onRemoved.addListener((tabId) => {
	if (tabs.delete(tabId)) publish();
});

// "Other sites": any page using the Media Session API. Needs the optional
// "all sites" permission (granted from the extension's options page).
async function syncGenericScript() {
	if (!api.scripting || !api.permissions) return;
	try {
		const granted = await api.permissions.contains({ origins: ["<all_urls>"] });
		const want = granted && M.isSiteEnabled(config, "generic");
		const existing = await api.scripting.getRegisteredContentScripts({ ids: ["dynis-generic"] });
		if (want && existing.length === 0) {
			await api.scripting.registerContentScripts([
				{
					id: "dynis-generic",
					matches: ["https://*/*"],
					excludeMatches: [
						"https://www.youtube.com/*",
						"https://music.youtube.com/*",
						"https://open.spotify.com/*",
						"https://music.apple.com/*",
						"https://soundcloud.com/*"
					],
					js: ["media-core.js", "content.js"],
					runAt: "document_idle"
				}
			]);
		} else if (!want && existing.length > 0) {
			await api.scripting.unregisterContentScripts({ ids: ["dynis-generic"] });
		}
	} catch {
		/* not supported here */
	}
}

api.permissions?.onAdded?.addListener(syncGenericScript);
api.permissions?.onRemoved?.addListener(syncGenericScript);
