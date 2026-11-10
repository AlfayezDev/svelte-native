<script lang="ts">
	import { afterNavigate } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { page } from "$app/state";

	let { data, children } = $props();
	let open = $state(false);
	let query = $state("");
	let input = $state<HTMLInputElement>();

	afterNavigate(() => {
		open = false;
		query = "";
	});

	// Every word of the query must appear in the entry's title or its page's title; a title that starts with the query ranks first.
	const results = $derived.by(() => {
		const words = query.toLowerCase().split(/\s+/).filter(Boolean);
		if (!words.length) return [];
		const phrase = words.join(" ");
		return data.search
			.map((entry) => {
				const title = entry.title.toLowerCase();
				const haystack = `${title} ${entry.page.toLowerCase()}`;
				if (!words.every((word) => haystack.includes(word))) return undefined;
				const score = (title.startsWith(phrase) ? 0 : title.includes(phrase) ? 1 : 2) + (entry.title === entry.page ? 0 : 0.5);
				return { entry, score };
			})
			.filter((result) => result !== undefined)
			.sort((a, b) => a.score - b.score)
			.slice(0, 20)
			.map(({ entry }) => entry);
	});

	function onkeydown(event: KeyboardEvent) {
		const target = event.target as HTMLElement | null;
		const typing = target?.closest("input, textarea, [contenteditable]");
		if (!typing && (event.key === "/" || (event.key === "k" && (event.metaKey || event.ctrlKey)))) {
			event.preventDefault();
			open = true;
			input?.focus();
		}
	}
</script>

<svelte:window {onkeydown} />

<div class="docs">
	<button class="menu-button" type="button" aria-expanded={open} aria-controls="sidebar" onclick={() => (open = !open)}>
		{open ? "Close menu" : "Menu"}
	</button>

	<nav id="sidebar" class="sidebar" class:open aria-label="Documentation">
		<div class="search">
			<input bind:this={input} bind:value={query} type="search" placeholder="Search" aria-label="Search the documentation" autocomplete="off" spellcheck="false" />
			<kbd aria-hidden="true">/</kbd>
		</div>

		{#if query.trim()}
			<ul class="results" aria-label="Search results">
				{#each results as result (result.href)}
					<li>
						<a href={result.href}>
							<span class="result-title">{result.title}</span>
							<span class="result-page">{result.title === result.page ? result.section : result.page}</span>
						</a>
					</li>
				{:else}
					<li class="empty">Nothing matches “{query.trim()}”.</li>
				{/each}
			</ul>
		{:else}
			{#each data.sections as section (section.title)}
				<section>
					<h2>{section.title}</h2>
					<ul>
						{#each section.pages as { slug, title } (slug)}
							<li>
								<a href={resolve("/docs/[slug]", { slug })} aria-current={page.params.slug === slug ? "page" : undefined}>{title}</a>
							</li>
						{/each}
					</ul>
				</section>
			{/each}
		{/if}
	</nav>

	{@render children()}
</div>
