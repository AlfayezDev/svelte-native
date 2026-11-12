<script lang="ts">
	// Below the desktop width the sidebar is a panel under the header, opened by the hamburger.
	import type { NavArea } from "#lib/docs.server";
	import { drawer } from "#lib/state/ui.svelte";
	import Sidebar from "./Sidebar.svelte";

	let { areas }: { areas: NavArea[] } = $props();

	// The page behind it does not scroll while it is open, and it closes when the window grows into the desktop layout.
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
</script>

<svelte:window onkeydown={(event) => event.key === "Escape" && (drawer.open = false)} />

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
