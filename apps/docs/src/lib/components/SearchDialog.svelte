<script lang="ts">
	// Search with Pagefind: the index is built from the prerendered pages (`pagefind --site build`, part of the build script) and
	// loaded the first time the dialog opens. In the dev server there is no index, and the dialog says so.
	import CornerDownLeft from "@lucide/svelte/icons/corner-down-left";
	import FileText from "@lucide/svelte/icons/file-text";
	import Hash from "@lucide/svelte/icons/hash";
	import SearchIcon from "@lucide/svelte/icons/search";

	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { search } from "#lib/state/ui.svelte";

	type Row = { id: string; url: string; title: string; crumb: string; excerpt: string; isPage: boolean };
	type Pagefind = {
		options: (options: Record<string, unknown>) => Promise<void>;
		init: () => Promise<void>;
		debouncedSearch: (term: string, options?: object, wait?: number) => Promise<{ results: { data: () => Promise<PagefindResult> }[] } | null>;
	};
	type PagefindResult = {
		url: string;
		excerpt: string;
		meta: { title?: string };
		filters: { section?: string[] };
		sub_results: { title: string; url: string; excerpt: string }[];
	};

	let dialog = $state<HTMLDialogElement>();
	let input = $state<HTMLInputElement>();
	let list = $state<HTMLElement>();
	let query = $state("");
	let rows = $state<Row[]>([]);
	let active = $state(0);
	let status = $state<"idle" | "searching" | "results" | "empty" | "unavailable">("idle");

	let pagefind: Promise<Pagefind | undefined> | undefined;
	let token = 0;

	function load() {
		pagefind ??= (async () => {
			try {
				const root = resolve("/").replace(/\/?$/, "/");
				const module: Pagefind = await import(/* @vite-ignore */ `${root}pagefind/pagefind.js`);
				await module.options({ baseUrl: root });
				await module.init();
				return module;
			} catch {
				return undefined;
			}
		})();
		return pagefind;
	}

	function toRows(result: PagefindResult, index: number): Row[] {
		const page = result.meta.title ?? "";
		const section = result.filters?.section?.[0] ?? "";
		const subs = result.sub_results?.length ? result.sub_results.slice(0, 3) : [{ title: page, url: result.url, excerpt: result.excerpt }];
		return subs.map((sub, i) => {
			// Pagefind keeps the ".html" of the file, and the page's own heading is the anchor #top: the address is the page's.
			const url = sub.url.replace(/\.html(?=$|#)/, "").replace(/#top$/, "");
			const isPage = !url.includes("#");
			return { id: `search-row-${index}-${i}`, url, title: isPage ? page : sub.title, crumb: isPage ? section : page, excerpt: sub.excerpt, isPage };
		});
	}

	async function run(term: string) {
		const mine = ++token;
		if (!term) {
			rows = [];
			status = "idle";
			return;
		}
		const module = await load();
		if (mine !== token) return;
		if (!module) {
			status = "unavailable";
			return;
		}
		status = "searching";
		const response = await module.debouncedSearch(term, {}, 100);
		if (!response || mine !== token) return;
		const found = await Promise.all(response.results.slice(0, 8).map((result) => result.data()));
		if (mine !== token) return;
		rows = found.flatMap(toRows).slice(0, 14);
		active = 0;
		status = rows.length ? "results" : "empty";
	}

	$effect(() => {
		void run(query.trim());
	});

	$effect(() => {
		if (!dialog) return;
		if (search.open && !dialog.open) {
			dialog.showModal();
			input?.select();
			void load();
		} else if (!search.open && dialog.open) {
			dialog.close();
		}
	});

	// The page behind the dialog does not scroll.
	$effect(() => {
		document.documentElement.classList.toggle("scroll-locked", search.open);
		return () => document.documentElement.classList.remove("scroll-locked");
	});

	// The row the arrow keys are on stays in view.
	$effect(() => {
		const row = rows[active];
		if (row) list?.querySelector(`#${row.id}`)?.scrollIntoView({ block: "nearest" });
	});

	function open(row: Row | undefined) {
		if (!row) return;
		search.open = false;
		void goto(row.url);
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			if (rows.length) active = (active + (event.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length;
		} else if (event.key === "Enter") {
			event.preventDefault();
			open(rows[active]);
		} else if (event.key === "Escape") {
			// A search field clears itself on Esc, and the dialog would stay: one Esc closes it.
			event.preventDefault();
			search.open = false;
		}
	}
</script>

<dialog
	bind:this={dialog}
	class="dialog"
	aria-label="Search the documentation"
	onclose={() => {
		search.open = false;
		query = "";
	}}
	onclick={(event) => {
		if (event.target === dialog) search.open = false;
	}}
>
	<div class="field">
		<SearchIcon size={20} />
		<input
			bind:this={input}
			bind:value={query}
			{onkeydown}
			type="search"
			role="combobox"
			placeholder="Search the documentation"
			aria-label="Search the documentation"
			aria-expanded={rows.length > 0}
			aria-controls="search-results"
			aria-activedescendant={rows[active]?.id}
			autocomplete="off"
			autocapitalize="off"
			spellcheck="false"
			enterkeyhint="go"
		/>
		<kbd class="esc" aria-hidden="true">esc</kbd>
	</div>

	<div class="results" bind:this={list}>
		{#if rows.length}
			<ul id="search-results" role="listbox" aria-label="Results">
				{#each rows as row, index (row.id)}
					<li role="presentation">
						<a id={row.id} class="row" href={row.url} role="option" aria-selected={index === active} onclick={() => (search.open = false)} onmousemove={() => (active = index)}>
							<span class="row-icon">{#if row.isPage}<FileText size={16} />{:else}<Hash size={16} />{/if}</span>
							<span class="row-text">
								<span class="row-title">{row.title}<span class="row-crumb">{row.crumb}</span></span>
								<!-- eslint-disable-next-line svelte/no-at-html-tags -- Pagefind's excerpt: the page's text, escaped, with <mark> around the matches -->
								<span class="row-excerpt">{@html row.excerpt}</span>
							</span>
							{#if index === active}<CornerDownLeft class="row-enter" size={14} />{/if}
						</a>
					</li>
				{/each}
			</ul>
		{:else if status === "unavailable"}
			<p class="note">Search is built with the site. Run <code>pnpm --dir apps/docs build</code> and <code>preview</code> to use it here.</p>
		{:else if status === "empty"}
			<p class="note">Nothing matches “{query.trim()}”.</p>
		{:else if status === "idle"}
			<p class="note">Type to search the guide.</p>
		{/if}
	</div>

	<p class="sr-only" role="status">{status === "results" ? `${rows.length} results` : status === "empty" ? "No results" : ""}</p>

	<div class="hints" aria-hidden="true">
		<span><kbd>↑</kbd><kbd>↓</kbd> to move</span>
		<span><kbd>↵</kbd> to open</span>
		<span><kbd>esc</kbd> to close</span>
	</div>
</dialog>

<style>
	.dialog {
		width: min(680px, calc(100vw - 16px));
		max-width: none;
		max-height: min(75dvh, 680px);
		margin: 10vh auto auto;
		padding: 0;
		color: var(--docs-text-default);
		background: var(--docs-bg-overlay);
		border: 1px solid var(--docs-border);
		border-radius: 28px;
		box-shadow: var(--docs-shadow-md);
		overflow: hidden;
		transition:
			opacity 200ms cubic-bezier(0.16, 1, 0.3, 1),
			transform 200ms cubic-bezier(0.16, 1, 0.3, 1);
	}

	.dialog[open] {
		display: flex;
		flex-direction: column;

		@starting-style {
			opacity: 0;
			transform: scale(0.97) translateY(-6px);
		}
	}

	.dialog::backdrop {
		background: rgb(0 0 0 / 0.33);
	}

	.field {
		display: flex;
		align-items: center;
		gap: 12px;
		flex: none;
		margin: 12px 12px 0;
		padding: 0 14px;
		height: 46px;
		background: var(--docs-bg-subtle);
		border: 1px solid var(--docs-border);
		border-radius: 24px;
	}

	.field:focus-within {
		border-color: var(--accent);
	}

	.field > :global(svg) {
		flex: none;
		color: var(--docs-text-tertiary);
	}

	input {
		flex: 1;
		min-width: 0;
		height: 100%;
		padding: 0;
		font: inherit;
		font-size: 16px;
		color: inherit;
		background: none;
		border: 0;
		outline: 0;
	}

	input::placeholder {
		color: var(--docs-text-tertiary);
	}

	input::-webkit-search-cancel-button {
		display: none;
	}

	.esc {
		font-size: 11px;
	}

	.results {
		flex: 1;
		min-height: 0;
		padding: 8px 12px 12px;
		overflow-y: auto;
		overscroll-behavior: contain;
	}

	ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.row {
		display: flex;
		align-items: flex-start;
		gap: 12px;
		min-height: 52px;
		padding: 10px 14px;
		color: inherit;
		text-decoration: none;
		border-radius: 18px;
	}

	.row[aria-selected="true"] {
		background: var(--docs-bg-selected);
	}

	.row-icon {
		flex: none;
		margin-top: 2px;
		color: var(--docs-text-tertiary);
	}

	.row[aria-selected="true"] .row-icon {
		color: var(--accent);
	}

	.row-text {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-width: 0;
	}

	.row-title {
		display: flex;
		align-items: baseline;
		gap: 8px;
		font-size: 15px;
		font-weight: 500;
		line-height: 1.4;
	}

	.row-crumb {
		overflow: hidden;
		font-size: 12px;
		font-weight: 400;
		color: var(--docs-text-tertiary);
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.row-excerpt {
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
		font-size: 13px;
		line-height: 1.45;
		color: var(--docs-text-secondary);
	}

	.row-excerpt :global(mark) {
		padding: 0 1px;
		color: inherit;
		background: color-mix(in oklab, var(--accent) 28%, transparent);
		border-radius: 3px;
	}

	:global(.row-enter) {
		flex: none;
		align-self: center;
		color: var(--docs-text-tertiary);
	}

	.note {
		margin: 0;
		padding: 28px 16px;
		font-size: 14px;
		text-align: center;
		color: var(--docs-text-secondary);
	}

	.note code {
		padding: 1px 4px;
		font: 12px var(--docs-mono);
		background: var(--docs-bg-element);
		border-radius: var(--docs-radius-sm);
	}

	.hints {
		display: none;
		flex: none;
		gap: 16px;
		padding: 10px 20px;
		font-size: 12px;
		color: var(--docs-text-tertiary);
		border-top: 1px solid var(--docs-border-secondary);
	}

	.hints span {
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}

	@media (hover: hover) and (min-width: 788px) {
		.hints {
			display: flex;
		}
	}

	@media (max-width: 787.98px) {
		.dialog {
			margin-top: 8px;
			max-height: calc(100dvh - 16px);
		}
		.esc {
			display: none;
		}
	}
</style>
