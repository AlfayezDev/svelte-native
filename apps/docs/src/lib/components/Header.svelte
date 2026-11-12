<script lang="ts">
	import Menu from "@lucide/svelte/icons/menu";
	import Search from "@lucide/svelte/icons/search";
	import X from "@lucide/svelte/icons/x";

	import { resolve } from "$app/paths";
	import { REPOSITORY } from "#lib/site";
	import { drawer, search } from "#lib/state/ui.svelte";
	import ThemeSelect from "./ThemeSelect.svelte";

	/** The pages of the guide have a sidebar, and below the desktop width a menu that holds it. */
	let { inDocs }: { inDocs: boolean } = $props();
</script>

<header class="header">
	<a class="wordmark" href={resolve("/")}>Svelte Native</a>

	<div class="actions">
		<button class={["icon-button search-button", inDocs && "docs"]} type="button" aria-label="Search" aria-keyshortcuts="Control+K Meta+K" onclick={() => (search.open = true)}>
			<Search size={18} />
		</button>
		<a class="link github" href={REPOSITORY} rel="noreferrer">
			<svg class="github-mark" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="currentColor">
				<path
					d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"
				/>
			</svg>
			<span class="link-label">GitHub</span>
		</a>
		<ThemeSelect />
		{#if inDocs}
			<button class="icon-button menu-button" type="button" aria-label={drawer.open ? "Close menu" : "Open menu"} aria-expanded={drawer.open} aria-controls="mobile-menu" onclick={() => (drawer.open = !drawer.open)}>
				{#if drawer.open}<X size={20} />{:else}<Menu size={20} />{/if}
			</button>
		{/if}
	</div>
</header>

<style>
	.header {
		position: sticky;
		top: 0;
		z-index: 40;
		display: flex;
		align-items: center;
		justify-content: space-between;
		height: var(--docs-header-height);
		padding: 0 16px;
		background: var(--docs-bg-default);
		border-bottom: 1px solid var(--docs-border);
	}

	.wordmark {
		font-size: 17px;
		font-weight: 650;
		letter-spacing: -0.015em;
		color: var(--docs-text-default);
		text-decoration: none;
	}

	.actions {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.icon-button,
	.link {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		height: 36px;
		min-width: 36px;
		padding: 0 8px;
		font-size: 14px;
		font-weight: 500;
		color: var(--docs-text-secondary);
		text-decoration: none;
		background: none;
		border: 0;
		border-radius: var(--docs-radius-md);
		cursor: pointer;
		transition:
			background-color 150ms,
			color 150ms,
			transform 150ms;
	}

	.icon-button:hover,
	.link:hover {
		color: var(--docs-text-default);
		background: var(--docs-bg-element);
	}

	.icon-button:active,
	.link:active {
		transform: scale(0.97);
	}

	/* The GitHub link's name is its text: a phone shows the icon, and a screen reader still gets the word. */
	.link-label {
		position: absolute;
		width: 1px;
		height: 1px;
		margin: -1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	/* The sidebar has the search on a desktop: the header's button is for the phone and for the pages without a sidebar. */
	@media (min-width: 1008px) {
		.search-button.docs,
		.menu-button {
			display: none;
		}
		.link-label {
			position: static;
			width: auto;
			height: auto;
			margin: 0;
			overflow: visible;
			clip-path: none;
		}
		.link {
			padding: 0 12px 0 10px;
		}
	}
</style>
