<script lang="ts">
	import ArrowLeft from "@lucide/svelte/icons/arrow-left";
	import ArrowRight from "@lucide/svelte/icons/arrow-right";
	import FileText from "@lucide/svelte/icons/file-text";
	import MessageSquareWarning from "@lucide/svelte/icons/message-square-warning";
	import Pencil from "@lucide/svelte/icons/pencil";

	import { resolve } from "$app/paths";
	import type { Page, PageLink } from "#lib/docs.server";
	import { REPOSITORY } from "#lib/site";

	let { page, previous, next }: { page: Pick<Page, "title" | "source" | "updated">; previous?: PageLink; next?: PageLink } = $props();
</script>

<footer class="footer">
	{#if previous || next}
		<nav class="pager" aria-label="Previous and next page">
			{#if previous}
				<a class="card previous" href={resolve("/docs/[slug]", { slug: previous.slug })} rel="prev">
					<ArrowLeft size={16} />
					<span>
						<span class="hint">Previous ({previous.section})</span>
						<span class="name">{previous.title}</span>
					</span>
				</a>
			{:else}
				<span></span>
			{/if}
			{#if next}
				<a class="card next" href={resolve("/docs/[slug]", { slug: next.slug })} rel="next">
					<span>
						<span class="hint">Next ({next.section})</span>
						<span class="name">{next.title}</span>
					</span>
					<ArrowRight size={16} />
				</a>
			{/if}
		</nav>
	{/if}

	<ul class="links">
		<li><a href="{REPOSITORY}/edit/main/{page.source}" rel="noreferrer"><Pencil size={14} />Edit this page</a></li>
		<li><a href="{REPOSITORY}/issues/new?title={encodeURIComponent(`Docs: ${page.title}`)}" rel="noreferrer"><MessageSquareWarning size={14} />Report an issue</a></li>
		<li><a href={resolve("/llms.txt")}><FileText size={14} />llms.txt</a></li>
	</ul>

	{#if page.updated}
		<p class="updated">Last updated on <time datetime={page.updated.iso}>{page.updated.label}</time></p>
	{/if}
</footer>

<style>
	.footer {
		display: flex;
		flex-direction: column;
		gap: 24px;
		margin-top: 56px;
	}

	.pager {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 16px;
	}

	/* On a narrow column the next page comes first, as the thing most readers want. */
	@media (max-width: 787.98px) {
		.pager {
			grid-template-columns: minmax(0, 1fr);
		}
		.next {
			order: -1;
		}
	}

	.card {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 12px 16px;
		color: var(--docs-text-default);
		text-decoration: none;
		border: 1px solid var(--docs-border);
		border-radius: var(--docs-radius-2xl);
		transition:
			background-color 150ms,
			box-shadow 150ms;
	}

	.card:hover {
		background: var(--docs-bg-subtle);
		box-shadow: var(--docs-shadow-xs);
	}

	.card > :global(svg) {
		flex: none;
		color: var(--docs-text-secondary);
	}

	.next {
		grid-column: 2;
		justify-content: space-between;
		text-align: right;
	}

	@media (max-width: 787.98px) {
		.next {
			grid-column: auto;
		}
	}

	.hint {
		display: block;
		font-size: 12px;
		color: var(--docs-text-secondary);
	}

	.name {
		display: block;
		font-weight: 500;
	}

	.links {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 20px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.links a {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		min-height: 28px;
		font-size: 14px;
		color: var(--docs-text-secondary);
		text-decoration: none;
	}

	.links a:hover {
		color: var(--docs-text-default);
		text-decoration: underline;
		text-underline-offset: 3px;
	}

	.updated {
		margin: 0;
		font-size: 12px;
		color: var(--docs-text-tertiary);
	}
</style>
