<script lang="ts">
	import { resolve } from "$app/paths";
	import FeatureVideo from "#lib/components/FeatureVideo.svelte";
	import PageFooter from "#lib/components/PageFooter.svelte";
	import PageHeader from "#lib/components/PageHeader.svelte";
	import Toc from "#lib/components/Toc.svelte";
	import { enhance } from "#lib/enhance";

	let { data } = $props();
	const description = $derived(data.page.description?.text.slice(0, 300));
</script>

<svelte:head>
	<title>{data.page.title} • Svelte Native</title>
	{#if description}<meta name="description" content={description} />{/if}
	<link rel="canonical" href={data.page.canonical} />
	<link rel="alternate" type="text/markdown" href={resolve("/docs/[slug].md", { slug: data.page.slug })} />
	<meta property="og:type" content="article" />
	<meta property="og:site_name" content="Svelte Native" />
	<meta property="og:title" content="{data.page.title} • Svelte Native" />
	{#if description}<meta property="og:description" content={description} />{/if}
	<meta property="og:url" content={data.page.canonical} />
	<meta name="twitter:card" content="summary" />
</svelte:head>

<main id="main" class="main">
	<div class="content">
		<article data-pagefind-body data-pagefind-filter="section[data-section]" data-section={data.page.section}>
			<PageHeader page={data.page} />
			{#if data.page.video}<FeatureVideo title={data.page.video.title} sources={data.page.video.sources} />{/if}
			<!-- eslint-disable-next-line svelte/no-at-html-tags -- rendered from the repository's own Markdown at build time -->
			<div class="prose" use:enhance={data.page.html}>{@html data.page.html}</div>
		</article>

		<PageFooter page={data.page} previous={data.previous} next={data.next} />
	</div>
</main>

<Toc title={data.page.title} headings={data.page.headings} />

<style>
	.main {
		min-width: 0;
		padding: 20px 16px 64px;
	}

	.content {
		max-width: 1200px;
		margin: 0 auto;
	}

	@media (min-width: 1008px) {
		.main {
			padding: 40px 56px 64px;
		}
	}
</style>
