<script lang="ts">
	// "On this page", with a scroll-spy. The active heading is the last one above a line 5% of the viewport under the header; at the bottom of
	// the page it is the section most of the viewport shows, as the last headings can never reach the line. A click scrolls smoothly and
	// holds the highlight on the clicked heading until the scroll settles.
	import ArrowUp from "@lucide/svelte/icons/arrow-up";
	import TextAlignStart from "@lucide/svelte/icons/text-align-start";

	import { untrack } from "svelte";

	import { replaceState } from "$app/navigation";
	import { page } from "$app/state";
	import type { Heading } from "#lib/docs.server";

	let { title, headings }: { title: string; headings: Heading[] } = $props();

	const HEADER = 60;
	const ACTIVATION = 1 / 20;
	const SETTLE = 140;

	const items = $derived<{ id: string; text: string; depth: number }[]>([{ id: "top", text: title, depth: 2 }, ...headings]);
	let active = $state("top");
	let showTop = $state(false);
	let box = $state<HTMLElement>();
	let target: string | null = null;
	let settle: ReturnType<typeof setTimeout> | undefined;

	const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

	function update() {
		showTop = scrollY > 120;
		const height = innerHeight;
		const line = HEADER + height * ACTIVATION;
		const tops = items.map((item) => document.getElementById(item.id)?.getBoundingClientRect().top);

		let next = 0;
		for (let i = 0; i < tops.length; i++) {
			const top = tops[i];
			if (top === undefined) continue;
			if (top <= line) next = i;
			else break;
		}

		// At the bottom of the page: the section with most of the viewport in it, the later one when they tie.
		const root = document.documentElement;
		if (scrollY + height >= root.scrollHeight - Math.min(200, height * 0.1)) {
			let best = 0;
			for (let i = 0; i < tops.length; i++) {
				const start = tops[i];
				if (start === undefined) continue;
				const end = tops.slice(i + 1).find((top) => top !== undefined) ?? root.scrollHeight - scrollY;
				const visible = Math.max(0, Math.min(end, height) - Math.max(start, HEADER));
				if (visible >= best) {
					best = visible;
					next = i;
				}
			}
		}

		if (target) return;
		const id = items[next]?.id ?? "top";
		if (id !== active) {
			active = id;
			reveal();
		}
	}

	// The list scrolls on its own when the active entry leaves its middle half.
	function reveal() {
		const container = box;
		const entry = container?.querySelector<HTMLElement>(`[data-id="${active}"]`);
		if (!container || !entry) return;
		const place = entry.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
		const upper = container.clientHeight / 4;
		const lower = (container.clientHeight * 3) / 4;
		const behavior = reduced() ? "instant" : "auto";
		if (place < container.scrollTop + upper) container.scrollTo({ top: Math.max(0, place - upper), behavior });
		else if (place > container.scrollTop + lower) container.scrollTo({ top: place - lower, behavior });
	}

	function onscroll() {
		update();
		if (target) {
			clearTimeout(settle);
			settle = setTimeout(() => {
				target = null;
				update();
			}, SETTLE);
		}
	}

	$effect(() => {
		void items;
		// A new page starts at its title; `update` reads and writes the active entry, which this effect must not depend on.
		untrack(() => {
			active = "top";
			update();
		});
		addEventListener("scroll", onscroll, { passive: true });
		addEventListener("resize", update);
		return () => {
			removeEventListener("scroll", onscroll);
			removeEventListener("resize", update);
			clearTimeout(settle);
			target = null;
		};
	});

	function jump(id: string) {
		const heading = document.getElementById(id);
		if (!heading) return;
		target = id;
		active = id;
		const top = id === "top" ? 0 : heading.getBoundingClientRect().top + scrollY - (HEADER + 20);
		scrollTo({ top: Math.max(0, top), behavior: reduced() ? "instant" : "smooth" });
		clearTimeout(settle);
		settle = setTimeout(() => {
			target = null;
			update();
		}, SETTLE * 4);
		replaceState(id === "top" ? page.url.pathname + page.url.search : `#${id}`, page.state);
		// Focus follows the jump, as it does for a link to a fragment.
		heading.setAttribute("tabindex", "-1");
		heading.focus({ preventScroll: true });
		heading.addEventListener("blur", () => heading.removeAttribute("tabindex"), { once: true });
	}

</script>

<aside class="toc" aria-label="On this page">
	<div class="scroll" bind:this={box}>
		<div class="head">
			<span class="title"><TextAlignStart size={16} />On this page</span>
			{#if showTop}
				<button class="to-top" type="button" aria-label="Scroll to top" onclick={() => jump("top")}><ArrowUp size={16} /></button>
			{/if}
		</div>
		<ul>
			{#each items as item (item.id)}
				<li>
					<a href="#{item.id}" data-id={item.id} data-depth={item.depth} aria-current={item.id === active ? "location" : undefined} onclick={(event) => {
						event.preventDefault();
						jump(item.id);
					}}>{item.text}</a>
				</li>
			{/each}
		</ul>
	</div>
</aside>

<style>
	.toc {
		display: none;
	}

	@media (min-width: 1328px) {
		.toc {
			display: block;
			position: sticky;
			top: var(--docs-header-height);
			align-self: start;
			height: calc(100dvh - var(--docs-header-height));
			border-left: 1px solid var(--docs-border);
		}
	}

	.scroll {
		height: 100%;
		padding: 0 24px 40px;
		overflow-y: auto;
		overscroll-behavior: contain;
	}

	.head {
		position: sticky;
		top: 0;
		z-index: 1;
		display: flex;
		align-items: center;
		justify-content: space-between;
		min-height: 36px;
		margin: 0 -24px 8px;
		padding: 48px 24px 4px;
		background: linear-gradient(var(--docs-bg-default) 80%, transparent);
		box-sizing: content-box;
	}

	.title {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font-size: 14px;
		font-weight: 500;
	}

	.title :global(svg) {
		color: var(--docs-text-secondary);
	}

	.to-top {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		color: var(--docs-text-secondary);
		background: none;
		border: 0;
		border-radius: var(--docs-radius-md);
		cursor: pointer;
	}

	.to-top:hover {
		color: var(--docs-text-default);
		background: var(--docs-bg-element);
	}

	ul {
		margin: 0;
		padding: 0;
		list-style: none;
		border-left: 1px solid var(--docs-border-secondary);
	}

	a {
		display: block;
		margin-left: -1px;
		padding: 4px 8px 4px 14px;
		font-size: 14px;
		line-height: 1.45;
		color: var(--docs-text-secondary);
		text-decoration: none;
		border-left: 2px solid transparent;
		transition: color 150ms;
	}

	a[data-depth="3"] {
		padding-left: 28px;
	}

	a:hover {
		color: var(--docs-text-default);
	}

	a[aria-current] {
		color: var(--docs-link);
		font-weight: 500;
		border-left-color: var(--docs-link);
	}
</style>
