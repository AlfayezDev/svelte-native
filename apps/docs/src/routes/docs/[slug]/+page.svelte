<script lang="ts">
	import { resolve } from "$app/paths";

	let { data } = $props();
</script>

<svelte:head>
	<title>{data.page.title} - Svelte Native</title>
</svelte:head>

<main class="content">
	<article class="prose">
		<!-- eslint-disable-next-line svelte/no-at-html-tags -- rendered from the repository's own Markdown at build time -->
		{@html data.page.html}
	</article>

	<nav class="pager" aria-label="Previous and next page">
		{#if data.previous}
			<a class="prev" href={resolve("/docs/[slug]", { slug: data.previous.slug })}><span>Previous</span>{data.previous.title}</a>
		{/if}
		{#if data.next}
			<a class="next" href={resolve("/docs/[slug]", { slug: data.next.slug })}><span>Next</span>{data.next.title}</a>
		{/if}
	</nav>
</main>

{#if data.page.headings.length}
	<aside class="toc" aria-label="On this page">
		<h2>On this page</h2>
		<ul>
			{#each data.page.headings as { id, text } (id)}
				<li><a href="#{id}">{text}</a></li>
			{/each}
		</ul>
	</aside>
{/if}
