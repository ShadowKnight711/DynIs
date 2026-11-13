import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";

/**
 * Spotify (Web API): Up Next queue, like, shuffle/repeat, seek, devices
 * (Spotify Connect), search (play now or add to queue) and playlists.
 *
 * Sign-in is Authorization Code + PKCE (no client secret): the user pastes
 * the Client ID of their own Spotify app, and the browser returns to a
 * loopback address the backend listens on only during sign-in. The refresh
 * token lives in Windows Credential Manager; the short-lived access token
 * only in memory. Reading works on Spotify Free; controlling playback through
 * the API needs Spotify Premium (Spotify's rule).
 *
 * The API is used only while Spotify is the player (see `isSpotifySource`)
 * and the island is open; otherwise DynIs follows the system media session.
 */

export const SPOTIFY_REDIRECT = "http://127.0.0.1:47819/callback";
export const SPOTIFY_SCOPES = [
	"user-read-playback-state",
	"user-modify-playback-state",
	"user-read-currently-playing",
	"user-library-read",
	"user-library-modify",
	"playlist-read-private"
];
const SCOPES = SPOTIFY_SCOPES.join(" ");
const CLIENT_ID_KEY = "bloom-spotify-client-id";
/** Broadcast to every window after connecting or disconnecting. */
export const SPOTIFY_CHANGED_EVENT = "spotify-connection-changed";

export interface SpotifyTrack {
	id: string;
	uri: string;
	name: string;
	artist: string;
	art: string | null;
}

export interface SpotifyPlaylist {
	id: string;
	uri: string;
	name: string;
	art: string | null;
	tracks: number | null;
}

export interface SpotifyDevice {
	id: string;
	name: string;
	type: string;
	active: boolean;
	volume: number | null;
}

/** What went wrong with a control, in words for the island. */
export const PREMIUM_NEEDED = "Controlling playback needs Spotify Premium.";

export interface SpotifyQueue {
	current: SpotifyTrack | null;
	next: SpotifyTrack[];
}

// ── Pure helpers (unit-tested) ──

export function spotifyClientId(storage: Pick<Storage, "getItem"> | null = safeStorage()): string {
	try {
		return (storage?.getItem(CLIENT_ID_KEY) || "").trim();
	} catch {
		return "";
	}
}

function safeStorage(): Storage | null {
	try {
		return typeof localStorage === "undefined" ? null : localStorage;
	} catch {
		return null;
	}
}

/** A Spotify Client ID is 32 hex characters. */
export function isValidClientId(id: string): boolean {
	return /^[0-9a-f]{32}$/i.test(id.trim());
}

const VERIFIER_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

/** A random PKCE code verifier or state (RFC 7636 unreserved characters). */
export function randomString(len: number): string {
	const bytes = crypto.getRandomValues(new Uint8Array(len));
	return Array.from(bytes, (b) => VERIFIER_CHARS[b % VERIFIER_CHARS.length]).join("");
}

/** base64url without padding. */
export function base64Url(bytes: Uint8Array): string {
	let bin = "";
	for (const b of bytes) bin += String.fromCharCode(b);
	return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The S256 code challenge for a PKCE verifier. */
export async function pkceChallenge(verifier: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
	return base64Url(new Uint8Array(digest));
}

export function authorizeUrl(clientId: string, challenge: string, state: string): string {
	const params = new URLSearchParams({
		client_id: clientId,
		response_type: "code",
		redirect_uri: SPOTIFY_REDIRECT,
		code_challenge_method: "S256",
		code_challenge: challenge,
		state,
		scope: SCOPES
	});
	return `https://accounts.spotify.com/authorize?${params}`;
}

export function toTrack(item: any): SpotifyTrack | null {
	if (!item || item.type !== "track" || !item.id) return null;
	const images: any[] = item.album?.images ?? [];
	// Spotify lists images largest first; the smallest is plenty for a row.
	return {
		id: item.id,
		uri: item.uri ?? `spotify:track:${item.id}`,
		name: item.name ?? "",
		artist: (item.artists ?? []).map((a: any) => a.name).join(", "),
		art: images[images.length - 1]?.url ?? null
	};
}

/** GET /me/player/queue → the current song and up to `limit` next ones. */
export function parseQueue(json: any, limit = 5): SpotifyQueue | null {
	if (!json || typeof json !== "object") return null;
	const next = (Array.isArray(json.queue) ? json.queue : [])
		.map(toTrack)
		.filter((t: SpotifyTrack | null): t is SpotifyTrack => !!t);
	return { current: toTrack(json.currently_playing), next: next.slice(0, limit) };
}

export function parsePlaylists(json: any): SpotifyPlaylist[] {
	return (Array.isArray(json?.items) ? json.items : [])
		.filter((p: any) => p && p.id && p.uri)
		.map((p: any) => ({
			id: p.id,
			uri: p.uri,
			name: p.name ?? "",
			art: p.images?.at(-1)?.url ?? p.images?.[0]?.url ?? null,
			tracks: typeof p.tracks?.total === "number" ? p.tracks.total : null
		}));
}

export function parseDevices(json: any): SpotifyDevice[] {
	return (Array.isArray(json?.devices) ? json.devices : [])
		.filter((d: any) => d && d.id)
		.map((d: any) => ({
			id: d.id,
			name: d.name ?? "",
			type: (d.type ?? "").toLowerCase(),
			active: !!d.is_active,
			volume: typeof d.volume_percent === "number" ? d.volume_percent : null
		}));
}

/**
 * Turns a control's HTTP status into words for the island, or null when it
 * worked. `reason` is the Web API error reason (e.g. PREMIUM_REQUIRED).
 */
export function controlError(status: number, reason?: string | null): string | null {
	if (status >= 200 && status < 300) return null;
	if (reason === "PREMIUM_REQUIRED" || status === 403) return PREMIUM_NEEDED;
	if (reason === "NO_ACTIVE_DEVICE" || status === 404) return "Start Spotify on one of your devices first.";
	if (status === 429) return "Spotify asked DynIs to slow down. Try again in a moment.";
	if (status === 401 || status === 0) return "Connect Spotify in Settings first.";
	return "Spotify didn't respond. Try again.";
}

/** Seconds from a Retry-After header (default 5, at most 2 minutes). */
export function retryAfterMs(header: string | null, now = Date.now()): number {
	const seconds = header ? Number(header) : NaN;
	const s = Number.isFinite(seconds) && seconds >= 0 ? seconds : 5;
	return now + Math.min(s, 120) * 1000;
}

/** off → context (list) → track → off, like the island's repeat button. */
export function nextRepeat(current: string | null): "off" | "context" | "track" {
	return current === "list" || current === "context" ? "track" : current === "track" ? "off" : "context";
}

/**
 * Whether the system media session belongs to Spotify. On Windows it is the
 * app's AppUserModelID: "Spotify.exe" for the desktop installer,
 * "SpotifyAB.SpotifyMusic_…!Spotify" for the Microsoft Store app.
 */
export function isSpotifySource(sourceApp: string | null | undefined): boolean {
	return !!sourceApp && /spotify/i.test(sourceApp);
}

/** True when the island's current song is the one Spotify is playing. */
export function isSpotifyActive(queue: SpotifyQueue | null, title: string): boolean {
	const cur = queue?.current?.name;
	return !!cur && !!title && cur.trim().toLowerCase() === title.trim().toLowerCase();
}

// ── Tokens ──

interface AccessToken {
	token: string;
	expires: number;
}

export interface TokenResponse {
	access_token: string;
	expires_in: number;
	refresh_token?: string;
}

/**
 * Keeps one access token per window and refreshes it once at a time, however
 * many requests ask for it together. Spotify may rotate the refresh token;
 * the new one is stored. A rejected refresh token (revoked, or the app's
 * Client ID changed) disconnects.
 */
export class TokenStore {
	private access: AccessToken | null = null;
	private refreshing: Promise<string | null> | null = null;

	constructor(
		private deps: {
			loadRefresh: () => Promise<string | null>;
			saveRefresh: (token: string) => Promise<void>;
			clearRefresh: () => Promise<void>;
			clientId: () => string;
			post: (body: Record<string, string>) => Promise<{ status: number; json: any }>;
			now?: () => number;
		}
	) {}

	private now() {
		return this.deps.now?.() ?? Date.now();
	}

	/** Store the result of a token request. */
	async accept(json: TokenResponse) {
		this.access = { token: json.access_token, expires: this.now() + (json.expires_in - 60) * 1000 };
		if (json.refresh_token) await this.deps.saveRefresh(json.refresh_token);
	}

	/** Forget the access token (after a 401), so the next call refreshes. */
	invalidate() {
		this.access = null;
	}

	async clear() {
		this.access = null;
		await this.deps.clearRefresh();
	}

	async get(): Promise<string | null> {
		if (this.access && this.access.expires > this.now()) return this.access.token;
		if (!this.refreshing) {
			this.refreshing = this.refresh().finally(() => {
				this.refreshing = null;
			});
		}
		return this.refreshing;
	}

	private async refresh(): Promise<string | null> {
		const refresh = await this.deps.loadRefresh();
		const clientId = this.deps.clientId();
		if (!refresh || !clientId) return null;
		let res: { status: number; json: any };
		try {
			res = await this.deps.post({ grant_type: "refresh_token", refresh_token: refresh, client_id: clientId });
		} catch {
			return null; // Offline: try again next time.
		}
		if (res.status === 400 && res.json?.error === "invalid_grant") {
			// Revoked or expired for good: the user has to connect again.
			await this.clear();
			return null;
		}
		if (res.status < 200 || res.status >= 300 || !res.json?.access_token) return null;
		await this.accept(res.json);
		return this.access?.token ?? null;
	}
}

async function postToken(body: Record<string, string>) {
	const res = await fetch("https://accounts.spotify.com/api/token", {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams(body)
	});
	return { status: res.status, json: await res.json().catch(() => null) };
}

const tokens = new TokenStore({
	loadRefresh: () => invoke<string | null>("spotify_load_token").catch(() => null),
	saveRefresh: (token) => invoke<void>("spotify_store_token", { token }),
	clearRefresh: async () => {
		await invoke("spotify_clear_token").catch(() => {});
		emit(SPOTIFY_CHANGED_EVENT, false).catch(() => {});
	},
	clientId: () => spotifyClientId(),
	post: postToken
});

/** Opens the browser for sign-in and finishes the connection. */
export async function connectSpotify(): Promise<void> {
	const clientId = spotifyClientId();
	if (!clientId) throw new Error("Add your Spotify Client ID first.");
	if (!isValidClientId(clientId)) throw new Error("That doesn't look like a Client ID: it has 32 letters and numbers.");
	const verifier = randomString(64);
	const state = randomString(16);
	const code = await invoke<string>("spotify_authorize", {
		authUrl: authorizeUrl(clientId, await pkceChallenge(verifier), state),
		state
	});
	const res = await postToken({
		grant_type: "authorization_code",
		code,
		redirect_uri: SPOTIFY_REDIRECT,
		client_id: clientId,
		code_verifier: verifier
	});
	if (res.status < 200 || res.status >= 300 || !res.json?.access_token) {
		throw new Error(res.json?.error_description || res.json?.error || `Spotify sign-in failed (${res.status})`);
	}
	await tokens.accept(res.json);
	emit(SPOTIFY_CHANGED_EVENT, true).catch(() => {});
}

export async function disconnectSpotify() {
	await tokens.clear();
}

export async function spotifyConnected(): Promise<boolean> {
	if (!spotifyClientId()) return false;
	const token = await invoke<string | null>("spotify_load_token").catch(() => null);
	return !!token;
}

// ── Web API ──

let backoffUntil = 0;

interface ApiResult {
	status: number;
	json: any;
}

/**
 * One Web API call. Retries once with a fresh token after a 401, and stops
 * calling for as long as Spotify asks after a 429. Status 0 = not connected
 * or offline.
 */
async function api(path: string, init?: RequestInit): Promise<ApiResult> {
	if (Date.now() < backoffUntil) return { status: 429, json: null };
	for (let attempt = 0; attempt < 2; attempt++) {
		const token = await tokens.get();
		if (!token) return { status: 0, json: null };
		const res = await fetch(`https://api.spotify.com/v1${path}`, {
			...init,
			headers: { Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) }
		}).catch(() => null);
		if (!res) return { status: 0, json: null };
		if (res.status === 401 && attempt === 0) {
			tokens.invalidate();
			continue;
		}
		if (res.status === 429) backoffUntil = retryAfterMs(res.headers.get("Retry-After"));
		const json = res.status === 204 ? null : await res.json().catch(() => null);
		return { status: res.status, json };
	}
	return { status: 401, json: null };
}

/** Runs a playback control. Returns null when it worked, or a message. */
async function control(path: string, init: RequestInit): Promise<string | null> {
	const { status, json } = await api(path, init);
	return controlError(status, json?.error?.reason ?? null);
}

const ok = (r: ApiResult) => r.status >= 200 && r.status < 300;

export async function fetchQueue(): Promise<SpotifyQueue | null> {
	const r = await api("/me/player/queue");
	return ok(r) ? parseQueue(r.json) : null;
}

export async function isSaved(id: string): Promise<boolean | null> {
	const r = await api(`/me/tracks/contains?ids=${encodeURIComponent(id)}`);
	return ok(r) && Array.isArray(r.json) ? !!r.json[0] : null;
}

export async function setSaved(id: string, saved: boolean): Promise<boolean> {
	return ok(await api(`/me/tracks?ids=${encodeURIComponent(id)}`, { method: saved ? "PUT" : "DELETE" }));
}

export const seek = (ms: number) => control(`/me/player/seek?position_ms=${Math.max(0, Math.round(ms))}`, { method: "PUT" });
export const setShuffle = (on: boolean) => control(`/me/player/shuffle?state=${on}`, { method: "PUT" });
export const setRepeat = (state: "off" | "context" | "track") => control(`/me/player/repeat?state=${state}`, { method: "PUT" });

/**
 * Plays the queue item at `index` (0 = next). Spotify has no "jump to queue
 * item", so DynIs skips forward, which keeps the rest of your queue.
 */
export async function playQueueIndex(index: number): Promise<string | null> {
	for (let i = 0; i <= index; i++) {
		const err = await control("/me/player/next", { method: "POST" });
		if (err) return err;
	}
	return null;
}

export async function fetchDevices(): Promise<SpotifyDevice[] | null> {
	const r = await api("/me/player/devices");
	return ok(r) ? parseDevices(r.json) : null;
}

export const transferTo = (deviceId: string) =>
	control("/me/player", {
		method: "PUT",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ device_ids: [deviceId], play: true })
	});

export async function searchTracks(query: string): Promise<SpotifyTrack[]> {
	const q = query.trim();
	if (!q) return [];
	const r = await api(`/search?type=track&limit=6&q=${encodeURIComponent(q)}`);
	if (!ok(r)) return [];
	return (r.json?.tracks?.items ?? []).map(toTrack).filter(Boolean) as SpotifyTrack[];
}

export const addToQueue = (uri: string) => control(`/me/player/queue?uri=${encodeURIComponent(uri)}`, { method: "POST" });

/** Play a song now (replaces what's playing, keeps your queue). */
export const playNow = (uri: string) =>
	control("/me/player/play", {
		method: "PUT",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ uris: [uri] })
	});

/** Your playlists (first 20), for quick play. */
export async function fetchPlaylists(): Promise<SpotifyPlaylist[]> {
	const r = await api("/me/playlists?limit=20");
	return ok(r) ? parsePlaylists(r.json) : [];
}

/** Play a playlist (or album) from the start. */
export const playContext = (contextUri: string) =>
	control("/me/player/play", {
		method: "PUT",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ context_uri: contextUri })
	});
