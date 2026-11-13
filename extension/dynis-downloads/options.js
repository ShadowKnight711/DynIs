// Grants or removes the optional "all sites" permission used by "Other Sites".
const api = globalThis.browser || chrome;
const ALL = { origins: ["<all_urls>"] };
const button = document.getElementById("toggle");
const status = document.getElementById("status");

async function refresh() {
	const granted = await api.permissions.contains(ALL);
	button.textContent = granted ? "Stop Reading Other Sites" : "Allow Other Sites";
	status.textContent = granted ? "Allowed." : "";
}

button.addEventListener("click", async () => {
	try {
		if (await api.permissions.contains(ALL)) await api.permissions.remove(ALL);
		else await api.permissions.request(ALL);
	} catch {
		status.textContent = "The browser didn't allow it.";
	}
	refresh();
});

refresh();
