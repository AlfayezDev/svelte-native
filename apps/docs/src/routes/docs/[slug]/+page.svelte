<script lang="ts">
	import { REPOSITORY } from "#lib/site";
	import { resolve } from "$app/paths";

	let { data } = $props();
	const sections = $derived(data.page.headings.filter((heading) => heading.depth === 2));
</script>

<svelte:head>
	<title>{data.page.title} • Svelte Native</title>
</svelte:head>

<main class="content">
	<article class="prose">
		<p class="eyebrow">{data.page.section}</p>
		<h1 id="top">{data.page.title}</h1>
		<!-- eslint-disable-next-line svelte/no-at-html-tags -- rendered from the repository's own Markdown at build time -->
		{@html data.page.html}
	</article>

	<p class="edit"><a href="{REPOSITORY}/edit/main/{data.page.source}" rel="noreferrer">Edit this page on GitHub</a></p>

	<nav class="pager" aria-label="Previous and next page">
		{#if data.previous}
			<a class="prev" href={resolve("/docs/[slug]", { slug: data.previous.slug })}><span>Previous</span>{data.previous.title}</a>
		{/if}
		{#if data.next}
			<a class="next" href={resolve("/docs/[slug]", { slug: data.next.slug })}><span>Next</span>{data.next.title}</a>
		{/if}
	</nav>
</main>

{#if sections.length}
	<aside class="toc" aria-label="On this page">
		<h2>On this page</h2>
		<ul>
			<li><a href="#top">{data.page.title}</a></li>
			{#each sections as { id, text } (id)}
				<li><a href="#{id}">{text}</a></li>
			{/each}
		</ul>
	</aside>
{/if}
