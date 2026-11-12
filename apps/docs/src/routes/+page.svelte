<script lang="ts">
	import ArrowRight from "@lucide/svelte/icons/arrow-right";
	import Search from "@lucide/svelte/icons/search";

	import { resolve } from "$app/paths";
	import { sectionIcons } from "#lib/icons";
	import { REPOSITORY } from "#lib/site";
	import { enhance } from "#lib/enhance";
	import { search } from "#lib/state/ui.svelte";

	let { data } = $props();

	const sections = $derived(data.areas.flatMap((area) => area.sections));
	const components = $derived((data.areas.find((area) => area.id === "components")?.sections ?? []).flatMap((section) => section.items.flatMap((item) => ("pages" in item ? item.pages : [item]))));
	const TITLE = "Svelte Native documentation";
	const DESCRIPTION = "Write Android and iOS apps as Svelte 5 components that become real native views: a guide to the library, its components and its tools.";
</script>

<svelte:head>
	<title>{TITLE}</title>
	<meta name="description" content={DESCRIPTION} />
	<link rel="canonical" href={data.canonical} />
	<link rel="alternate" type="text/plain" href={resolve("/llms.txt")} title="llms.txt" />
	<meta property="og:type" content="website" />
	<meta property="og:site_name" content="Svelte Native" />
	<meta property="og:title" content={TITLE} />
	<meta property="og:description" content={DESCRIPTION} />
	<meta property="og:url" content={data.canonical} />
	<meta name="twitter:card" content="summary" />
</svelte:head>

<main id="main" class="home">
	<section class="hero">
		<div class="hero-text">
			<h1>Native Android and iOS apps, written in Svelte</h1>
			<p class="lead">Svelte Native turns Svelte 5 components into real native views, laid out and drawn by the platform. No web view, and no React in your code.</p>
			<div class="cta">
				<a class="button primary" href={resolve("/docs/[slug]", { slug: "creating-a-project" })}>Get started<ArrowRight size={16} /></a>
				<a class="button" href={resolve("/docs/[slug]", { slug: "introduction" })}>Introduction</a>
			</div>
			<button class="search-trigger" type="button" aria-keyshortcuts="Control+K Meta+K" onclick={() => (search.open = true)}>
				<Search size={18} />
				<span class="search-label">Search the guide</span>
				<span class="search-keys" aria-hidden="true"><kbd><span class="mod-mac">⌘</span><span class="mod-pc">Ctrl</span></kbd><kbd>K</kbd></span>
			</button>
		</div>
		<div class="hero-code" use:enhance>
			<!-- eslint-disable-next-line svelte/no-at-html-tags -- rendered at build time from a snippet of this site -->
			{@html data.example}
		</div>
	</section>

	<section class="block">
		<h2>Explore the guide</h2>
		<div class="grid sections">
			{#each sections as section (section.id)}
				{@const Icon = sectionIcons[section.icon]}
				<a class="box" href={resolve("/docs/[slug]", { slug: section.first.slug })}>
					<span class="tile"><Icon size={18} /></span>
					<span class="box-text">
						<span class="box-title">{section.title}</span>
						<span class="box-description">{section.description}</span>
					</span>
					<ArrowRight class="box-arrow" size={16} />
				</a>
			{/each}
		</div>
	</section>

	<section class="block">
		<h2>Components</h2>
		<p class="block-lead">A page for every component: what it is, its props and examples.</p>
		<div class="grid tiles">
			{#each components as component (component.slug)}
				<a class="box tile-link" href={resolve("/docs/[slug]", { slug: component.slug })}>
					<span class="box-title">{component.title}</span>
					<ArrowRight class="box-arrow" size={16} />
				</a>
			{/each}
		</div>
	</section>

	<footer class="home-footer">
		<span>Svelte Native</span>
		<a href={REPOSITORY} rel="noreferrer">GitHub</a>
		<a href="{REPOSITORY}/releases" rel="noreferrer">Releases</a>
		<a href={resolve("/llms.txt")}>llms.txt</a>
	</footer>
</main>

<style>
	.home {
		max-width: 1200px;
		margin: 0 auto;
		padding: 0 16px 48px;
	}

	.hero {
		display: grid;
		gap: 32px;
		padding: 48px 0 40px;
	}

	h1 {
		margin: 0;
		max-width: 16ch;
		font-size: clamp(2rem, 6vw, 3.25rem);
		line-height: 1.08;
		font-weight: 700;
		letter-spacing: -0.035em;
		text-wrap: balance;
	}

	.lead {
		max-width: 46ch;
		margin: 20px 0 0;
		font-size: 18px;
		line-height: 1.55;
		color: var(--docs-text-secondary);
	}

	.cta {
		display: flex;
		flex-wrap: wrap;
		gap: 12px;
		margin-top: 28px;
	}

	.button {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		height: 44px;
		padding: 0 20px;
		font-size: 15px;
		font-weight: 500;
		color: var(--docs-text-default);
		text-decoration: none;
		background: var(--docs-bg-default);
		border: 1px solid var(--docs-border);
		border-radius: var(--docs-radius-md);
		transition:
			background-color 150ms,
			transform 150ms;
	}

	.button:hover {
		background: var(--docs-bg-subtle);
	}

	.button:active {
		transform: scale(0.98);
	}

	.button.primary {
		color: light-dark(#fff, #1c1108);
		background: var(--accent);
		border-color: transparent;
	}

	.button.primary:hover {
		background: color-mix(in oklab, var(--accent) 88%, var(--docs-text-default));
	}

	.search-trigger {
		display: flex;
		align-items: center;
		gap: 10px;
		width: min(100%, 380px);
		height: 44px;
		margin-top: 20px;
		padding: 0 12px;
		font-size: 14px;
		color: var(--docs-text-tertiary);
		text-align: left;
		background: var(--docs-bg-default);
		border: 1px solid var(--docs-border);
		border-radius: 22px;
		box-shadow: var(--docs-shadow-xs);
		cursor: pointer;
		transition: background-color 150ms;
	}

	.search-trigger:hover {
		background: var(--docs-bg-subtle);
	}

	.search-label {
		flex: 1;
	}

	.search-keys {
		display: none;
		gap: 3px;
	}

	@media (min-width: 788px) {
		.search-keys {
			display: flex;
		}
	}

	.hero-code {
		min-width: 0;
	}

	.hero-code :global(.code) {
		margin: 0;
		box-shadow: var(--docs-shadow-sm);
	}

	.block {
		padding-top: 40px;
	}

	h2 {
		margin: 0 0 16px;
		font-size: 25px;
		line-height: 1.4;
		font-weight: 700;
		letter-spacing: -0.01em;
	}

	.block-lead {
		margin: -8px 0 20px;
		color: var(--docs-text-secondary);
	}

	.grid {
		display: grid;
		gap: 16px;
	}

	.box {
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

	.box:hover {
		background: var(--docs-bg-subtle);
		box-shadow: var(--docs-shadow-xs);
	}

	.box :global(.box-arrow) {
		flex: none;
		margin-left: auto;
		color: var(--docs-text-tertiary);
		transition: transform 150ms;
	}

	.box:hover :global(.box-arrow) {
		transform: translateX(2px);
		color: var(--docs-text-default);
	}

	.sections .box {
		min-height: 96px;
		padding: 18px 20px;
	}

	.tile {
		display: inline-flex;
		flex: none;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		color: var(--accent);
		background: var(--docs-bg-selected);
		border-radius: 10px;
	}

	.box-text {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.box-title {
		font-weight: 500;
	}

	.box-description {
		font-size: 14px;
		line-height: 1.5;
		color: var(--docs-text-secondary);
	}

	.tile-link {
		min-height: 52px;
	}

	.home-footer {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 20px;
		margin-top: 64px;
		padding-top: 20px;
		font-size: 14px;
		color: var(--docs-text-tertiary);
		border-top: 1px solid var(--docs-border-secondary);
	}

	.home-footer a {
		color: var(--docs-text-secondary);
		text-decoration: none;
	}

	.home-footer a:hover {
		color: var(--docs-text-default);
		text-decoration: underline;
		text-underline-offset: 3px;
	}

	@media (min-width: 788px) {
		.home {
			padding: 0 32px 64px;
		}
		.hero {
			padding: 72px 0 56px;
		}
		.sections {
			grid-template-columns: repeat(2, minmax(0, 1fr));
			gap: 20px;
		}
		.tiles {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}

	@media (min-width: 1008px) {
		.hero {
			grid-template-columns: minmax(0, 5fr) minmax(0, 6fr);
			align-items: center;
			gap: 56px;
		}
		.tiles {
			grid-template-columns: repeat(4, minmax(0, 1fr));
		}
	}
</style>
