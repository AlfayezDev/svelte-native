<script lang="ts">
	import Pencil from "@lucide/svelte/icons/pencil";
	import Smartphone from "@lucide/svelte/icons/smartphone";

	import type { Page } from "#lib/docs.server";
	import { REPOSITORY } from "#lib/site";
	import CopyPage from "./CopyPage.svelte";

	let { page }: { page: Pick<Page, "slug" | "title" | "description" | "platforms" | "source"> } = $props();

	const LABELS = { android: "Android", ios: "iOS" };
</script>

<header class="page-header">
	<div class="title-row">
		<h1 id="top">{page.title}</h1>
		<div class="actions" data-pagefind-ignore>
			<a class="edit" href="{REPOSITORY}/edit/main/{page.source}" rel="noreferrer"><Pencil size={14} />Edit page</a>
			<CopyPage slug={page.slug} />
		</div>
	</div>

	{#if page.description}
		<!-- eslint-disable-next-line svelte/no-at-html-tags -- the page's own description, rendered from the repository's Markdown at build time -->
		<p class="description">{@html page.description.html}</p>
	{/if}

	<ul class="platforms" aria-label="Platforms" data-pagefind-ignore>
		{#each page.platforms as platform (platform)}
			<li><Smartphone size={12} />{LABELS[platform]}</li>
		{/each}
	</ul>
</header>

<style>
	.page-header {
		padding-bottom: 20px;
		margin-bottom: 24px;
		border-bottom: 1px solid var(--docs-border-secondary);
	}

	.title-row {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	h1 {
		margin: 0;
		font-size: 31px;
		line-height: 1.29;
		font-weight: 700;
		letter-spacing: -0.02em;
	}

	@media (max-width: 787.98px) {
		h1 {
			font-size: 27px;
		}
	}

	@media (max-width: 467.98px) {
		h1 {
			font-size: 23px;
		}
	}

	.actions {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.edit {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 32px;
		padding: 0 10px;
		font-size: 12px;
		font-weight: 500;
		color: var(--docs-text-secondary);
		text-decoration: none;
		border-radius: var(--docs-radius-md);
		transition:
			background-color 150ms,
			color 150ms;
	}

	.edit:hover {
		color: var(--docs-text-default);
		background: var(--docs-bg-element);
	}

	/* From the xl width the actions sit to the right of the title, below it before. */
	@media (min-width: 1328px) {
		.title-row {
			flex-direction: row;
			align-items: flex-start;
			justify-content: space-between;
			gap: 24px;
		}
		.actions {
			flex: none;
			margin-top: -2px;
		}
	}

	.description {
		margin: 12px 0 0;
		font-size: 17px;
		line-height: 1.55;
		color: var(--docs-text-secondary);
	}

	.description :global(a) {
		color: var(--docs-link);
		text-decoration: underline;
		text-decoration-color: color-mix(in oklab, var(--docs-link) 35%, transparent);
		text-underline-offset: 3px;
	}

	.description :global(code) {
		padding: 1px 4px;
		font: 400 0.8em/1.5 var(--docs-mono);
		font-variant-ligatures: none;
		color: var(--docs-text-default);
		background: var(--docs-bg-subtle);
		border: 1px solid var(--docs-border-secondary);
		border-radius: var(--docs-radius-sm);
	}

	.platforms {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin: 16px 0 0;
		padding: 0;
		list-style: none;
	}

	.platforms li {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		height: 21px;
		padding: 0 7px;
		font-size: 12px;
		font-weight: 500;
		color: var(--docs-text-secondary);
		background: var(--docs-bg-element);
		border: 1px solid var(--docs-border);
		border-radius: 999px;
	}
</style>
