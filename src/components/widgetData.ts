import { invoke } from "@tauri-apps/api/core";

/** Weather for the widgets, fetched once and cached for 20 minutes. */
export interface WeatherData {
	city: string;
	now: { temp: number; code: number };
	hourly: { time: string; temp: number; code: number }[];
	daily: { date: string; max: number; min: number; code: number; sunrise: string; sunset: string }[];
	lat: number;
	lon: number;
}

const TTL = 20 * 60 * 1000;
let weatherCache: { at: number; data: WeatherData } | null = null;
let weatherInflight: Promise<WeatherData> | null = null;
let airCache: { at: number; aqi: number } | null = null;

let ipLocation: { lat: number; lon: number; city: string } | null = null;

async function location(): Promise<{ lat: number; lon: number; city: string }> {
	const s = await invoke<Record<string, string>>("load_settings").catch(() => ({}) as Record<string, string>);
	const lat = Number(s["bloom-weather-lat"]);
	const lon = Number(s["bloom-weather-lon"]);
	const city = s["bloom-weather-city"] || localStorage.getItem("bloom-weather-city") || "";
	if (Number.isFinite(lat) && Number.isFinite(lon) && (lat !== 0 || lon !== 0)) return { lat, lon, city };
	// IP location doesn't change during a session: look it up once.
	if (ipLocation) return ipLocation;
	ipLocation = await ipLookup(city);
	return ipLocation;
}

async function ipLookup(city: string): Promise<{ lat: number; lon: number; city: string }> {
	// Same providers as the header weather, in the same order.
	try {
		const res = await fetch("https://ipapi.co/json/", { signal: AbortSignal.timeout(6000) });
		const j = await res.json();
		if (typeof j.latitude === "number") return { lat: j.latitude, lon: j.longitude, city: j.city ?? city };
	} catch {
		/* next provider */
	}
	const res = await fetch("http://ip-api.com/json/?fields=status,lat,lon,city", { signal: AbortSignal.timeout(6000) });
	const j = await res.json();
	if (j.status === "success") return { lat: j.lat, lon: j.lon, city: j.city ?? city };
	throw new Error("location");
}

/** The cached weather, if any, so widgets paint at once. */
export function peekWeather(): WeatherData | null {
	return weatherCache?.data ?? null;
}

/** Warms the cache in the background (island start-up and every 20 minutes). */
export function prefetchWeather() {
	getWeather().catch(() => {});
}

export function getWeather(force = false): Promise<WeatherData> {
	if (!force && weatherCache && Date.now() - weatherCache.at < TTL) return Promise.resolve(weatherCache.data);
	if (weatherInflight) return weatherInflight;
	weatherInflight = (async () => {
		const loc = await location();
		const unit = localStorage.getItem("bloom-temp-unit") === "fahrenheit" ? "&temperature_unit=fahrenheit" : "";
		const res = await fetch(
			`https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}` +
				`&current=temperature_2m,weather_code&hourly=temperature_2m,weather_code&forecast_hours=6` +
				`&daily=temperature_2m_max,temperature_2m_min,weather_code,sunrise,sunset&forecast_days=5&timezone=auto${unit}`,
			{ signal: AbortSignal.timeout(8000) }
		);
		if (!res.ok) throw new Error(String(res.status));
		const j = await res.json();
		const data: WeatherData = {
			city: loc.city,
			lat: loc.lat,
			lon: loc.lon,
			now: { temp: Math.round(j.current?.temperature_2m ?? 0), code: j.current?.weather_code ?? 0 },
			hourly: (j.hourly?.time ?? []).slice(0, 6).map((t: string, i: number) => ({
				time: new Date(t).toLocaleTimeString([], { hour: "numeric" }),
				temp: Math.round(j.hourly.temperature_2m[i]),
				code: j.hourly.weather_code[i]
			})),
			daily: (j.daily?.time ?? []).map((d: string, i: number) => ({
				date: d,
				max: Math.round(j.daily.temperature_2m_max[i]),
				min: Math.round(j.daily.temperature_2m_min[i]),
				code: j.daily.weather_code[i],
				sunrise: j.daily.sunrise[i],
				sunset: j.daily.sunset[i]
			}))
		};
		if (data.hourly.length === 0) throw new Error("empty");
		weatherCache = { at: Date.now(), data };
		return data;
	})().finally(() => {
		weatherInflight = null;
	});
	return weatherInflight;
}

/** European AQI from Open-Meteo (no key), cached 30 minutes. */
export async function getAirQuality(): Promise<number> {
	if (airCache && Date.now() - airCache.at < 30 * 60 * 1000) return airCache.aqi;
	const w = await getWeather();
	const res = await fetch(
		`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${w.lat}&longitude=${w.lon}&current=european_aqi`,
		{ signal: AbortSignal.timeout(8000) }
	);
	if (!res.ok) throw new Error(String(res.status));
	const j = await res.json();
	const aqi = Math.round(j.current?.european_aqi ?? NaN);
	if (!Number.isFinite(aqi)) throw new Error("no aqi");
	airCache = { at: Date.now(), aqi };
	return aqi;
}

export function aqiLabel(aqi: number): string {
	if (aqi <= 20) return "Good";
	if (aqi <= 40) return "Fair";
	if (aqi <= 60) return "Moderate";
	if (aqi <= 80) return "Poor";
	if (aqi <= 100) return "Very poor";
	return "Extremely poor";
}

/** Offline quotes (short, public-domain). One per day. */
export const QUOTES: [string, string][] = [
	["Well begun is half done.", "Aristotle"],
	["The secret of getting ahead is getting started.", "Mark Twain"],
	["Simplicity is the ultimate sophistication.", "Leonardo da Vinci"],
	["It always seems impossible until it's done.", "Nelson Mandela"],
	["Energy and persistence conquer all things.", "Benjamin Franklin"],
	["What we think, we become.", "Buddha"],
	["Quality is not an act, it is a habit.", "Aristotle"],
	["Little by little, one travels far.", "J. R. R. Tolkien"],
	["Knowledge is power.", "Francis Bacon"],
	["The best way out is always through.", "Robert Frost"],
	["Do one thing every day that scares you.", "Eleanor Roosevelt"],
	["Stay hungry, stay foolish.", "Whole Earth Catalog"],
	["Turn your wounds into wisdom.", "Oprah Winfrey"],
	["Action is the foundational key to all success.", "Pablo Picasso"],
	["The journey of a thousand miles begins with one step.", "Lao Tzu"],
	["Nothing will work unless you do.", "Maya Angelou"],
	["Dream big and dare to fail.", "Norman Vaughan"],
	["Be so good they can't ignore you.", "Steve Martin"],
	["Make each day your masterpiece.", "John Wooden"],
	["You miss 100% of the shots you don't take.", "Wayne Gretzky"],
	["Whatever you are, be a good one.", "Abraham Lincoln"]
];

export function quoteOfTheDay(date = new Date()): [string, string] {
	const day = Math.floor(date.getTime() / 86400000);
	return QUOTES[day % QUOTES.length];
}
