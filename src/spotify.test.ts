import { describe, expect, test } from "bun:test";
import {
	PREMIUM_NEEDED,
	SPOTIFY_REDIRECT,
	SPOTIFY_SCOPES,
	TokenStore,
	authorizeUrl,
	base64Url,
	controlError,
	isSpotifyActive,
	isSpotifySource,
	isValidClientId,
	nextRepeat,
	parseDevices,
	parsePlaylists,
	parseQueue,
	pkceChallenge,
	randomString,
	retryAfterMs,
	spotifyClientId
} from "./spotify";

const track = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
	type: "track",
	id,
	uri: `spotify:track:${id}`,
	name,
	artists: [{ name: "Artist A" }, { name: "Artist B" }],
	album: { images: [{ url: "big.jpg" }, { url: "mid.jpg" }, { url: "small.jpg" }] },
	...extra
});

describe("spotify sign-in (PKCE)", () => {
	test("asks for every scope the features need", () => {
		for (const s of [
			"user-read-playback-state",
			"user-modify-playback-state",
			"user-read-currently-playing",
			"user-library-read",
			"user-library-modify",
			"playlist-read-private"
		])
			expect(SPOTIFY_SCOPES).toContain(s);
		expect(SPOTIFY_REDIRECT).toBe("http://127.0.0.1:47819/callback");
	});

	test("S256 challenge matches the RFC 7636 example", async () => {
		expect(await pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
			"E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
		);
		expect(base64Url(new Uint8Array([251, 255, 254]))).toBe("-__-");
	});

	test("verifiers use only unreserved characters and the right length", () => {
		const v = randomString(64);
		expect(v).toHaveLength(64);
		expect(v).toMatch(/^[A-Za-z0-9\-._~]+$/);
		expect(randomString(64)).not.toBe(v);
	});

	test("the sign-in address carries the PKCE parameters and no secret", () => {
		const url = new URL(authorizeUrl("0123456789abcdef0123456789abcdef", "chal", "st"));
		expect(url.origin + url.pathname).toBe("https://accounts.spotify.com/authorize");
		expect(url.searchParams.get("code_challenge_method")).toBe("S256");
		expect(url.searchParams.get("code_challenge")).toBe("chal");
		expect(url.searchParams.get("state")).toBe("st");
		expect(url.searchParams.get("redirect_uri")).toBe(SPOTIFY_REDIRECT);
		expect(url.searchParams.get("response_type")).toBe("code");
		expect(url.searchParams.get("client_secret")).toBeNull();
		expect(url.searchParams.get("scope")?.split(" ")).toEqual(SPOTIFY_SCOPES);
	});

	test("Client IDs are 32 hex characters", () => {
		expect(isValidClientId("0123456789abcdef0123456789ABCDEF")).toBe(true);
		expect(isValidClientId("  0123456789abcdef0123456789abcdef ")).toBe(true);
		expect(isValidClientId("not-an-id")).toBe(false);
		expect(isValidClientId("")).toBe(false);
		expect(spotifyClientId({ getItem: () => "  abc  " })).toBe("abc");
		expect(spotifyClientId(null)).toBe("");
	});
});

describe("spotify tokens", () => {
	function store(responses: { status: number; json: any }[]) {
		let stored: string | null = "refresh-1";
		let now = 1_000_000;
		const posts: Record<string, string>[] = [];
		const s = new TokenStore({
			loadRefresh: async () => stored,
			saveRefresh: async (t) => {
				stored = t;
			},
			clearRefresh: async () => {
				stored = null;
			},
			clientId: () => "0123456789abcdef0123456789abcdef",
			post: async (body) => {
				posts.push(body);
				await new Promise((r) => setTimeout(r, 5));
				return responses.shift() ?? { status: 500, json: null };
			},
			now: () => now
		});
		return { s, posts, stored: () => stored, advance: (ms: number) => (now += ms) };
	}

	test("refreshes once for many callers and reuses the token until it expires", async () => {
		const t = store([
			{ status: 200, json: { access_token: "A1", expires_in: 3600 } },
			{ status: 200, json: { access_token: "A2", expires_in: 3600 } }
		]);
		const got = await Promise.all([t.s.get(), t.s.get(), t.s.get()]);
		expect(got).toEqual(["A1", "A1", "A1"]);
		expect(t.posts).toHaveLength(1);
		expect(t.posts[0]).toMatchObject({ grant_type: "refresh_token", refresh_token: "refresh-1" });
		expect(t.posts[0].client_secret).toBeUndefined();
		expect(await t.s.get()).toBe("A1");
		// A minute early, so a request never goes out with a token about to expire.
		t.advance(3600 * 1000 - 59_000);
		expect(await t.s.get()).toBe("A2");
		expect(t.posts).toHaveLength(2);
	});

	test("keeps a rotated refresh token", async () => {
		const t = store([{ status: 200, json: { access_token: "A1", expires_in: 3600, refresh_token: "refresh-2" } }]);
		await t.s.get();
		expect(t.stored()).toBe("refresh-2");
	});

	test("a 401 drops the access token so the next call refreshes", async () => {
		const t = store([
			{ status: 200, json: { access_token: "A1", expires_in: 3600 } },
			{ status: 200, json: { access_token: "A2", expires_in: 3600 } }
		]);
		expect(await t.s.get()).toBe("A1");
		t.s.invalidate();
		expect(await t.s.get()).toBe("A2");
	});

	test("a revoked refresh token disconnects; a network error doesn't", async () => {
		const t = store([{ status: 400, json: { error: "invalid_grant" } }]);
		expect(await t.s.get()).toBeNull();
		expect(t.stored()).toBeNull();

		const u = store([{ status: 503, json: null }]);
		expect(await u.s.get()).toBeNull();
		expect(u.stored()).toBe("refresh-1");
	});
});

describe("spotify data", () => {
	test("reads the queue: current song, next songs with small artwork, skipping episodes", () => {
		const q = parseQueue({
			currently_playing: track("1", "Now"),
			queue: [track("2", "Next"), { type: "episode", id: "e1", name: "Podcast" }, track("3", "Later"), null]
		});
		expect(q?.current).toEqual({
			id: "1",
			uri: "spotify:track:1",
			name: "Now",
			artist: "Artist A, Artist B",
			art: "small.jpg"
		});
		expect(q?.next.map((t) => t.name)).toEqual(["Next", "Later"]);
		expect(parseQueue({ currently_playing: null, queue: [] })).toEqual({ current: null, next: [] });
		expect(parseQueue(null)).toBeNull();
		const many = parseQueue({ queue: Array.from({ length: 20 }, (_, i) => track(String(i), `S${i}`)) });
		expect(many?.next).toHaveLength(5);
		expect(parseQueue({ queue: [track("x", "X", { album: { images: [] } })] })?.next[0].art).toBeNull();
	});

	test("reads playlists and devices", () => {
		expect(
			parsePlaylists({
				items: [
					{ id: "p1", uri: "spotify:playlist:p1", name: "Focus", images: [{ url: "a" }, { url: "b" }], tracks: { total: 12 } },
					{ id: "p2", uri: "spotify:playlist:p2", name: "Empty", images: null, tracks: {} },
					null
				]
			})
		).toEqual([
			{ id: "p1", uri: "spotify:playlist:p1", name: "Focus", art: "b", tracks: 12 },
			{ id: "p2", uri: "spotify:playlist:p2", name: "Empty", art: null, tracks: null }
		]);
		expect(parsePlaylists(undefined)).toEqual([]);
		expect(
			parseDevices({ devices: [{ id: "d", name: "PC", type: "Computer", is_active: true, volume_percent: 40 }, { name: "no id" }] })
		).toEqual([{ id: "d", name: "PC", type: "computer", active: true, volume: 40 }]);
	});

	test("turns API failures into plain words", () => {
		expect(controlError(204)).toBeNull();
		expect(controlError(200)).toBeNull();
		expect(controlError(403)).toBe(PREMIUM_NEEDED);
		expect(controlError(403, "PREMIUM_REQUIRED")).toBe(PREMIUM_NEEDED);
		expect(controlError(404)).toContain("Start Spotify");
		expect(controlError(404, "NO_ACTIVE_DEVICE")).toContain("Start Spotify");
		expect(controlError(429)).toContain("slow down");
		expect(controlError(401)).toContain("Connect Spotify");
		expect(controlError(0)).toContain("Connect Spotify");
		expect(controlError(500)).toContain("Try again");
	});

	test("backs off for as long as Spotify asks, within limits", () => {
		expect(retryAfterMs("3", 0)).toBe(3000);
		expect(retryAfterMs(null, 0)).toBe(5000);
		expect(retryAfterMs("junk", 0)).toBe(5000);
		expect(retryAfterMs("9999", 0)).toBe(120_000);
	});

	test("repeat cycles off → all → one → off", () => {
		expect(nextRepeat("none")).toBe("context");
		expect(nextRepeat("list")).toBe("track");
		expect(nextRepeat("track")).toBe("off");
	});

	test("uses the Web API only when Spotify is the player", () => {
		expect(isSpotifySource("Spotify.exe")).toBe(true);
		expect(isSpotifySource("SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify")).toBe(true);
		expect(isSpotifySource("Microsoft.ZuneMusic_8wekyb3d8bbwe!Microsoft.ZuneMusic")).toBe(false);
		expect(isSpotifySource("Brave")).toBe(false);
		expect(isSpotifySource("")).toBe(false);
		expect(isSpotifySource(undefined)).toBe(false);
	});

	test("only treats the song as Spotify's when titles match", () => {
		const q = { current: { id: "1", uri: "spotify:track:1", name: "Blinding Lights", artist: "The Weeknd", art: null }, next: [] };
		expect(isSpotifyActive(q, "blinding lights ")).toBe(true);
		expect(isSpotifyActive(q, "Other Song")).toBe(false);
		expect(isSpotifyActive(null, "Blinding Lights")).toBe(false);
	});
});
