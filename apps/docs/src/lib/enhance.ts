// The page's Markdown is HTML from the build, with no components in it. This action gives it its behaviour with one delegated click handler:
// the Copy buttons of the code blocks and terminals, and the package manager tabs.
import { setPackageManager, syncPackageManager, currentPackageManager } from "#lib/state/prefs.svelte";
import { PACKAGE_MANAGERS, type PackageManager } from "#lib/terminal";

export async function copyText(text: string) {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		// Not a secure context, or the permission was refused: select the text in a hidden field and ask the browser to copy it.
		const field = document.createElement("textarea");
		field.value = text;
		field.setAttribute("readonly", "");
		field.style.cssText = "position:fixed;top:0;left:0;opacity:0";
		document.body.append(field);
		field.select();
		const copied = document.execCommand("copy");
		field.remove();
		return copied;
	}
}

const timers = new WeakMap<Element, ReturnType<typeof setTimeout>>();

/** Shows "Copied!" on a Copy button for a moment. */
export function flashCopied(button: Element, idle = "Copy") {
	const label = button.querySelector(".copy-label");
	button.setAttribute("data-copied", "");
	if (label) label.textContent = "Copied!";
	clearTimeout(timers.get(button));
	timers.set(
		button,
		setTimeout(() => {
			button.removeAttribute("data-copied");
			if (label) label.textContent = idle;
		}, 1500),
	);
}

function codeOf(button: HTMLElement) {
	const terminal = button.closest("[data-terminal]");
	if (terminal) {
		const manager = currentPackageManager();
		return terminal.querySelector(`[data-pm-block~="${manager}"] pre`)?.textContent ?? "";
	}
	return button.closest(".code")?.querySelector("pre")?.textContent ?? "";
}

/** `html` is only there so that the action updates when the page changes. */
export function enhance(node: HTMLElement, html?: string) {
	void html;
	syncPackageManager();
	async function onclick(event: MouseEvent) {
		const target = event.target as Element;
		const copy = target.closest<HTMLElement>("[data-copy]");
		if (copy) {
			if (await copyText(codeOf(copy).replace(/\n+$/, ""))) flashCopied(copy);
			return;
		}
		const tab = target.closest<HTMLElement>("[data-pm]");
		const manager = tab?.dataset.pm as PackageManager | undefined;
		if (manager && PACKAGE_MANAGERS.includes(manager)) setPackageManager(manager);
	}
	node.addEventListener("click", onclick);
	return {
		// The page changed: its terminals are new, and the tabs need their state.
		update: syncPackageManager,
		destroy: () => node.removeEventListener("click", onclick),
	};
}
