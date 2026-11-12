<script lang="ts">
	import { onMount } from "svelte";

	import { afterNavigate } from "$app/navigation";
	import { page } from "$app/state";
	import Header from "#lib/components/Header.svelte";
	import MobileDrawer from "#lib/components/MobileDrawer.svelte";
	import SearchDialog from "#lib/components/SearchDialog.svelte";
	import { loadMedia } from "#lib/state/prefs.svelte";
	import { loadTheme } from "#lib/state/theme.svelte";
	import { drawer, search } from "#lib/state/ui.svelte";
	import interLatin from "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url";
	import monoLatin from "@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2?url";
	import "../app.css";

	let { data, children } = $props();

	const inDocs = $derived(page.route.id?.startsWith("/docs") ?? false);

	onMount(() => {
		loadTheme();
		loadMedia();
	});

	afterNavigate(() => {
		drawer.open = false;
	});

	// Ctrl+K and ⌘K open the search from anywhere; "/" does too, unless the reader is typing.
	function onkeydown(event: KeyboardEvent) {
		const typing = (event.target as HTMLElement | null)?.closest("input, textarea, select, [contenteditable]");
		if ((event.key === "k" || event.key === "K") && (event.metaKey || event.ctrlKey)) {
			event.preventDefault();
			search.open = !search.open;
		} else if (event.key === "/" && !typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
			event.preventDefault();
			search.open = true;
		}
	}
</script>

<svelte:window {onkeydown} />

<svelte:head>
	<!-- The two variable fonts' latin files, which the text and the code of every page use: they load with the stylesheet, not after it. -->
	<link rel="preload" href={interLatin} as="font" type="font/woff2" crossorigin="anonymous" />
	<link rel="preload" href={monoLatin} as="font" type="font/woff2" crossorigin="anonymous" />
</svelte:head>

<a class="skip-link" href="#main">Skip to content</a>
<Header {inDocs} />
{#if inDocs && drawer.open}
	<MobileDrawer areas={data.areas} />
{/if}

<!-- Behind the open mobile menu the page is inert: the focus cannot leave the menu by Tab, and a screen reader does not read the page under it. -->
<div class="page" inert={inDocs && drawer.open}>
	{@render children()}
</div>

<SearchDialog />

<style>
	.page {
		display: contents;
	}
</style>
