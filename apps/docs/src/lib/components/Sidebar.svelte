<script lang="ts">
	import ChevronDown from "@lucide/svelte/icons/chevron-down";
	import FileText from "@lucide/svelte/icons/file-text";
	import House from "@lucide/svelte/icons/house";
	import Search from "@lucide/svelte/icons/search";
	import SquareArrowOutUpRight from "@lucide/svelte/icons/square-arrow-out-up-right";
	import Tag from "@lucide/svelte/icons/tag";
	import { onMount, tick, untrack } from "svelte";

	import { resolve } from "$app/paths";
	import { page } from "$app/state";
	import type { NavArea, NavPage } from "#lib/docs.server";
	import { areaIcons as areaIconNames, sectionIcons } from "#lib/icons";
	import { REPOSITORY } from "#lib/site";
	import { groups, loadGroups, setGroup } from "#lib/state/prefs.svelte";
	import { search } from "#lib/state/ui.svelte";

	let { areas }: { areas: NavArea[] } = $props();

	/** The sidebar scrolls inside the element that holds it, the desktop column or the mobile menu. */
	let nav = $state<HTMLElement>();

	const slug = $derived(page.params.slug);
	const containsActive = (pages: NavPage[]) => pages.some((p) => p.slug === slug);
	const area = $derived(areas.find((a) => a.sections.some((s) => s.items.some((item) => ("pages" in item ? containsActive(item.pages) : item.slug === slug)))));
	const areaLinkIcons = (id: string) => sectionIcons[areaIconNames[id] ?? "book-open"];

	const groupKey = (sectionId: string, title: string) => `${sectionId}/${title}`;
	const isOpen = (key: string, active: boolean) => groups.open[key] ?? active;

	onMount(loadGroups);

	// Reading a page opens its group, and the link of the page is brought into view if the sidebar's own scroll hides it.
	$effect(() => {
		if (!slug) return;
		for (const section of area?.sections ?? []) {
			for (const item of section.items) if ("pages" in item && containsActive(item.pages)) untrack(() => setGroup(groupKey(section.id, item.title), true));
		}
		tick().then(() => {
			const box = nav?.parentElement;
			const link = box?.querySelector<HTMLElement>('[aria-current="page"]');
			if (!box || !link) return;
			const outer = box.getBoundingClientRect();
			const inner = link.getBoundingClientRect();
			if (inner.top < outer.top + 80) box.scrollTop += inner.top - outer.top - 120;
			else if (inner.bottom > outer.bottom - 40) box.scrollTop += inner.bottom - outer.bottom + 120;
		});
	});
</script>

{#snippet pageLink(item: NavPage)}
	<a class="tree-link" href={resolve("/docs/[slug]", { slug: item.slug })} aria-current={item.slug === slug ? "page" : undefined}>
		<span class="dot" aria-hidden="true"></span>
		{item.title}
	</a>
{/snippet}

<nav class="nav" aria-label="Documentation" bind:this={nav}>
	<div class="head">
		<button class="search-trigger" type="button" aria-keyshortcuts="Control+K Meta+K" onclick={() => (search.open = true)}>
			<Search size={18} />
			<span class="search-label">Search</span>
			<span class="search-keys" aria-hidden="true"><kbd><span class="mod-mac">⌘</span><span class="mod-pc">Ctrl</span></kbd><kbd>K</kbd></span>
		</button>
		<ul class="areas">
			<li>
				<a class="area" href={resolve("/")}>
					<House size={16} />
					Home
				</a>
			</li>
			{#each areas as item (item.id)}
				{@const Icon = areaLinkIcons(item.id)}
				<li>
					<a class="area" href={resolve("/docs/[slug]", { slug: item.first.slug })} aria-current={item.id === area?.id ? "true" : undefined}>
						<Icon size={16} />
						{item.title}
					</a>
				</li>
			{/each}
		</ul>
	</div>

	<div class="tree">
		{#each area?.sections ?? [] as section (section.id)}
			{@const Icon = sectionIcons[section.icon]}
			<div class="section">
				<h2 class="section-title"><Icon size={16} />{section.title}</h2>
				<ul>
					{#each section.items as item ("pages" in item ? `group:${item.title}` : `page:${item.slug}`)}
						{#if "pages" in item}
							{@const key = groupKey(section.id, item.title)}
							{@const open = isOpen(key, containsActive(item.pages))}
							<li class="group">
								<button class="group-button" type="button" aria-expanded={open} aria-controls="group-{key.replace(/\W+/g, '-')}" onclick={() => setGroup(key, !open)}>
									<span class="chevron" class:closed={!open} aria-hidden="true"><ChevronDown size={12} /></span>
									{item.title}
								</button>
								<ul id="group-{key.replace(/\W+/g, '-')}" hidden={!open}>
									{#each item.pages as child (child.slug)}
										<li>{@render pageLink(child)}</li>
									{/each}
								</ul>
							</li>
						{:else}
							<li>{@render pageLink(item)}</li>
						{/if}
					{/each}
				</ul>
			</div>
		{/each}
	</div>

	<div class="foot">
		<a href={REPOSITORY} rel="noreferrer"><SquareArrowOutUpRight size={14} />Source on GitHub</a>
		<a href="{REPOSITORY}/releases" rel="noreferrer"><Tag size={14} />Releases</a>
		<a href={resolve("/llms.txt")}><FileText size={14} />llms.txt</a>
	</div>
</nav>

<style>
	.nav {
		display: flex;
		flex-direction: column;
		min-height: 100%;
	}

	ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.head {
		padding: 16px 16px 8px;
	}

	.search-trigger {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		height: 40px;
		padding: 0 10px;
		font-size: 14px;
		color: var(--docs-text-tertiary);
		text-align: left;
		background: var(--docs-bg-default);
		border: 1px solid var(--docs-border);
		border-radius: var(--docs-radius-xl);
		box-shadow: var(--docs-shadow-xs);
		cursor: pointer;
		transition:
			background-color 150ms,
			transform 150ms;
	}

	.search-trigger:hover {
		background: var(--docs-bg-subtle);
	}

	.search-trigger:active {
		transform: scale(0.99);
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

	.areas {
		display: flex;
		flex-direction: column;
		gap: 2px;
		margin-top: 12px;
	}

	.area {
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 32px;
		padding: 4px 10px;
		font-size: 14px;
		color: var(--docs-text-default);
		text-decoration: none;
		border-radius: var(--docs-radius-md);
		transition: background-color 150ms;
	}

	.area :global(svg) {
		color: var(--docs-text-secondary);
	}

	.area:hover {
		background: var(--docs-bg-element);
	}

	.area[aria-current] {
		font-weight: 500;
		background: var(--docs-bg-selected);
	}

	.area[aria-current] :global(svg) {
		color: var(--accent);
	}

	.tree {
		flex: 1;
		padding: 8px 16px 24px;
		border-top: 1px solid var(--docs-border-secondary);
		margin: 8px 0 0;
	}

	.section + .section {
		margin-top: 20px;
	}

	.section-title {
		display: flex;
		align-items: center;
		gap: 10px;
		margin: 12px 0 6px;
		padding: 0 10px;
		font-size: 15px;
		font-weight: 500;
		line-height: 1.4;
	}

	.section-title :global(svg) {
		color: var(--docs-text-secondary);
	}

	.group-button {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		min-height: 32px;
		padding: 4px 10px;
		font-size: 14px;
		font-weight: 500;
		color: var(--docs-text-default);
		text-align: left;
		background: none;
		border: 0;
		border-radius: var(--docs-radius-md);
		cursor: pointer;
	}

	.group-button:hover {
		background: var(--docs-bg-element);
	}

	.chevron {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 16px;
		height: 16px;
		color: var(--docs-text-secondary);
		border: 1px solid var(--docs-border);
		border-radius: 4px;
		transition: transform 200ms;
	}

	.chevron.closed {
		transform: rotate(-90deg);
	}

	.tree-link {
		position: relative;
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 30px;
		padding: 3px 10px 3px 12px;
		font-size: 14px;
		line-height: 1.4;
		color: var(--docs-text-secondary);
		text-decoration: none;
		border-radius: var(--docs-radius-md);
		transition:
			background-color 150ms,
			color 150ms;
	}

	.group ul .tree-link {
		margin-left: 12px;
	}

	.tree-link:hover {
		color: var(--docs-text-default);
		background: var(--docs-bg-element);
	}

	.dot {
		flex: none;
		width: 6px;
		height: 6px;
		background: var(--docs-border);
		border-radius: 999px;
	}

	.tree-link:hover .dot {
		background: var(--docs-text-tertiary);
	}

	.tree-link[aria-current="page"] {
		color: var(--docs-link);
		font-weight: 500;
	}

	.tree-link[aria-current="page"] .dot {
		background: var(--docs-link);
	}

	.foot {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 12px 16px 20px;
		border-top: 1px solid var(--docs-border-secondary);
	}

	.foot a {
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 30px;
		padding: 3px 10px;
		font-size: 14px;
		color: var(--docs-text-secondary);
		text-decoration: none;
		border-radius: var(--docs-radius-md);
	}

	.foot a:hover {
		color: var(--docs-text-default);
		background: var(--docs-bg-element);
	}
</style>
