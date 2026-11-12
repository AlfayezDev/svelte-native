// What a reader chose once and the site remembers: which sidebar groups are open, the platform of the feature videos and the package manager of the terminals.
import { read, write } from "#lib/storage";
import type { Platform } from "#lib/docs.server";
import { PACKAGE_MANAGERS, type PackageManager } from "#lib/terminal";

/** The sidebar groups a reader opened or closed, by key. A group nobody touched is open when it holds the page being read. */
export const groups = $state<{ open: Record<string, boolean> }>({ open: {} });

export function loadGroups() {
	try {
		const stored = JSON.parse(read("docs-sidebar-groups") ?? "{}");
		if (stored && typeof stored === "object") groups.open = stored;
	} catch {
		// an unreadable value is the same as none
	}
}

export function setGroup(key: string, open: boolean) {
	if (groups.open[key] === open) return;
	groups.open[key] = open;
	write("docs-sidebar-groups", JSON.stringify(groups.open));
}

/** The platform the feature videos show, on every page. */
export const media = $state<{ platform: Platform }>({ platform: "ios" });

export function loadMedia() {
	const stored = read("docs-video-platform");
	if (stored === "ios" || stored === "android") media.platform = stored;
}

export function setVideoPlatform(platform: Platform) {
	media.platform = platform;
	write("docs-video-platform", platform);
}

/** The package manager of the terminal blocks is a class of <html>, pm-npm to pm-bun, which the stylesheet turns into the right tab and block. */
export function currentPackageManager(): PackageManager {
	return PACKAGE_MANAGERS.find((manager) => document.documentElement.classList.contains(`pm-${manager}`)) ?? "pnpm";
}

export function setPackageManager(manager: PackageManager) {
	const root = document.documentElement;
	for (const other of PACKAGE_MANAGERS) root.classList.toggle(`pm-${other}`, other === manager);
	write("docs-package-manager", manager);
	syncPackageManager();
}

/** The tabs show the choice by CSS; this tells assistive technology. */
export function syncPackageManager() {
	const manager = currentPackageManager();
	for (const tab of document.querySelectorAll<HTMLElement>("[data-pm]")) tab.setAttribute("aria-pressed", String(tab.dataset.pm === manager));
}
