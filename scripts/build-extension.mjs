// Builds the Firefox copy of the DynIs Downloads & Media extension from the
// Chromium one (extension/dynis-downloads is the source of truth) and packs
// the unsigned .xpi. Run: `bun scripts/build-extension.mjs`.
//
// The .xpi still has to be signed by Mozilla to stay installed in release
// Firefox (see SETTINGS.md, "Firefox: signing the downloads extension").

import { copyFileSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "extension", "dynis-downloads");
const dst = join(root, "extension", "dynis-downloads-firefox");
const shared = ["background.js", "media-core.js", "content.js", "options.html", "options.js"];

for (const file of shared) copyFileSync(join(src, file), join(dst, file));

const chromium = JSON.parse(readFileSync(join(src, "manifest.json"), "utf8"));
const firefox = {
	manifest_version: 3,
	name: chromium.name,
	version: chromium.version,
	description: chromium.description,
	permissions: chromium.permissions,
	optional_host_permissions: chromium.optional_host_permissions,
	// Firefox runs background scripts as an event page, in order.
	background: { scripts: ["media-core.js", "background.js"] },
	content_scripts: chromium.content_scripts,
	options_ui: chromium.options_ui,
	browser_specific_settings: {
		// Fixed: DynIs's native host accepts only this ID.
		gecko: { id: "downloads@dynis.kevin", strict_min_version: "128.0" }
	}
};
writeFileSync(join(dst, "manifest.json"), JSON.stringify(firefox, null, 2) + "\n");

const xpi = join(dst, "dynis-downloads-firefox.xpi");
const zip = join(dst, "dynis-downloads-firefox.zip");
for (const f of [xpi, zip]) if (existsSync(f)) rmSync(f);
const files = ["manifest.json", ...shared].map((f) => join(dst, f));
if (process.platform === "win32") {
	const list = files.map((f) => `'${f.replace(/'/g, "''")}'`).join(",");
	execFileSync("powershell.exe", [
		"-NoProfile",
		"-Command",
		`Compress-Archive -Path ${list} -DestinationPath '${zip.replace(/'/g, "''")}' -Force`
	]);
} else {
	execFileSync("zip", ["-j", zip, ...files]);
}
copyFileSync(zip, xpi);
rmSync(zip);
console.log(`Built ${dst} (v${firefox.version}) and ${xpi} (unsigned)`);
