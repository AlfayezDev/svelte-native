<script lang="ts">
	import { resolve } from "$app/paths";
	import { search } from "#lib/state/ui.svelte";
</script>

<main id="main" class="not-found">
	<p class="status">404</p>
	<h1>Page not found</h1>
	<p class="lead">There is no page at this address. It may have moved, or the link may be wrong.</p>
	<div class="actions">
		<a class="button primary" href={resolve("/docs/[slug]", { slug: "introduction" })}>Read the guide</a>
		<a class="button" href={resolve("/")}>Home</a>
		<button class="button" type="button" onclick={() => (search.open = true)}>Search</button>
	</div>
</main>

<style>
	.not-found {
		max-width: 640px;
		margin: 0 auto;
		padding: 96px 16px 120px;
		text-align: center;
	}

	.status {
		margin: 0;
		font: 500 14px/1 var(--docs-mono);
		color: var(--docs-text-tertiary);
	}

	h1 {
		margin: 12px 0 0;
		font-size: 31px;
		line-height: 1.29;
		font-weight: 700;
		letter-spacing: -0.02em;
	}

	.lead {
		margin: 12px 0 0;
		color: var(--docs-text-secondary);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 12px;
		margin-top: 28px;
	}

	.button {
		display: inline-flex;
		align-items: center;
		height: 40px;
		padding: 0 18px;
		font-size: 14px;
		font-weight: 500;
		color: var(--docs-text-default);
		text-decoration: none;
		background: var(--docs-bg-default);
		border: 1px solid var(--docs-border);
		border-radius: var(--docs-radius-md);
		cursor: pointer;
		transition: background-color 150ms;
	}

	.button:hover {
		background: var(--docs-bg-subtle);
	}

	.button.primary {
		color: light-dark(#fff, #1c1108);
		background: var(--accent);
		border-color: transparent;
	}

	.button.primary:hover {
		background: color-mix(in oklab, var(--accent) 88%, var(--docs-text-default));
	}
</style>
