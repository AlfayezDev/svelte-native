<script lang="ts">
	// Below the desktop width the sidebar is a panel under the header, opened by the hamburger.
	import type { NavArea } from "#lib/docs.server";
	import { drawer, search } from "#lib/state/ui.svelte";
	import Sidebar from "./Sidebar.svelte";

	let { areas }: { areas: NavArea[] } = $props();

	// The page behind it does not scroll while it is open (and is inert, see +layout.svelte), and it closes when the window grows into the desktop layout.
	$effect(() => {
		document.documentElement.classList.add("drawer-open");
		const desktop = matchMedia("(min-width: 1008px)");
		const onchange = () => {
			if (desktop.matches) drawer.open = false;
		};
		desktop.addEventListener("change", onchange);
		return () => {
			document.documentElement.classList.remove("drawer-open");
			desktop.removeEventListener("change", onchange);
		};
	});

	// Esc closes the menu and gives the focus back to the button that opened it, unless it was meant for the search dialog on top of it.
	function onkeydown(event: KeyboardEvent) {
		if (event.key !== "Escape" || event.defaultPrevented || search.open) return;
		drawer.open = false;
		document.querySelector<HTMLElement>(".menu-button")?.focus();
	}
</script>

<svelte:window {onkeydown} />

<div id="mobile-menu" class="drawer">
	<Sidebar {areas} />
</div>

<style>
	.drawer {
		position: fixed;
		inset: var(--docs-header-height) 0 0;
		z-index: 35;
		overflow-y: auto;
		overscroll-behavior: contain;
		background: var(--docs-bg-subtle);
		animation: drawer-in 200ms ease-out;
	}

	@keyframes drawer-in {
		from {
			opacity: 0;
			transform: translateY(-6px);
		}
	}
</style>
