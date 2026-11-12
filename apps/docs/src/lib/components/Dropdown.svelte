<script lang="ts">
	// A button that opens a menu: Esc, a click outside and Tab close it, the arrow keys move between its items.
	import type { Snippet } from "svelte";

	let {
		label,
		trigger,
		children,
		align = "end",
		class: className = "",
	}: {
		/** What the menu is called for assistive technology. The button is named by its own content, so that its visible text is its name. */
		label: string;
		trigger: Snippet;
		children: Snippet<[close: () => void]>;
		align?: "start" | "end";
		class?: string;
	} = $props();

	let open = $state(false);
	let root = $state<HTMLElement>();
	let button = $state<HTMLButtonElement>();
	let menu = $state<HTMLElement>();

	function close(refocus = true) {
		open = false;
		if (refocus) button?.focus();
	}

	const items = () => [...(menu?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])];

	// The first item takes the focus when the menu opens: the checked one, if the menu is a choice.
	$effect(() => {
		if (!open) return;
		const list = items();
		(list.find((item) => item.getAttribute("aria-checked") === "true") ?? list[0])?.focus();
	});

	function onwindowpointerdown(event: PointerEvent) {
		if (open && root && !root.contains(event.target as Node)) open = false;
	}

	function onkeydown(event: KeyboardEvent) {
		if (!open) return;
		if (event.key === "Escape") {
			event.preventDefault();
			event.stopPropagation();
			close();
		} else if (event.key === "Tab") {
			open = false;
		} else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
			event.preventDefault();
			const list = items();
			const index = list.indexOf(document.activeElement as HTMLElement);
			const next = event.key === "Home" ? 0 : event.key === "End" ? list.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + list.length) % list.length;
			list[next]?.focus();
		}
	}
</script>

<svelte:window onpointerdown={onwindowpointerdown} />

<div class="dropdown" bind:this={root} {onkeydown} role="presentation">
	<button bind:this={button} class={["dropdown-trigger", className]} type="button" aria-haspopup="menu" aria-expanded={open} onclick={() => (open = !open)}>
		{@render trigger()}
	</button>
	{#if open}
		<div class="dropdown-menu" data-align={align} role="menu" aria-label={label} bind:this={menu}>
			{@render children(() => close())}
		</div>
	{/if}
</div>

<style>
	.dropdown {
		position: relative;
	}

	.dropdown-menu {
		position: absolute;
		top: calc(100% + 6px);
		z-index: 60;
		min-width: 200px;
		padding: 6px;
		background: var(--docs-bg-overlay);
		border: 1px solid var(--docs-border);
		border-radius: 16px;
		box-shadow: var(--docs-shadow-md);
		transform-origin: top right;
		transition:
			opacity 150ms ease-out,
			transform 150ms ease-out;

		@starting-style {
			opacity: 0;
			transform: scale(0.96) translateY(-4px);
		}
	}

	.dropdown-menu[data-align="end"] {
		right: 0;
	}

	.dropdown-menu[data-align="start"] {
		left: 0;
		transform-origin: top left;
	}

	.dropdown-menu :global([role^="menuitem"]) {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		padding: 8px 10px;
		font-size: 14px;
		line-height: 1.4;
		text-align: left;
		text-decoration: none;
		color: var(--docs-text-default);
		background: none;
		border: 0;
		border-radius: 10px;
		cursor: pointer;
	}

	.dropdown-menu :global([role^="menuitem"]:hover),
	.dropdown-menu :global([role^="menuitem"]:focus-visible) {
		background: var(--docs-bg-hover);
	}

	.dropdown-menu :global([role^="menuitem"]:focus-visible) {
		outline-offset: -2px;
	}

	.dropdown-menu :global([role^="menuitem"] > svg:first-child) {
		flex: none;
		color: var(--docs-text-secondary);
	}
</style>
