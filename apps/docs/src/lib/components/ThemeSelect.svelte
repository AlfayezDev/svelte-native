<script lang="ts">
	import Check from "@lucide/svelte/icons/check";
	import ChevronDown from "@lucide/svelte/icons/chevron-down";
	import Contrast from "@lucide/svelte/icons/contrast";
	import Moon from "@lucide/svelte/icons/moon";
	import Sun from "@lucide/svelte/icons/sun";

	import { setTheme, theme, type ThemeMode } from "#lib/state/theme.svelte";
	import Dropdown from "./Dropdown.svelte";

	const modes = [
		{ id: "auto", label: "Auto", icon: Contrast },
		{ id: "light", label: "Light", icon: Sun },
		{ id: "dark", label: "Dark", icon: Moon },
	] satisfies { id: ThemeMode; label: string; icon: typeof Sun }[];
</script>

<Dropdown label="Theme" class="theme-trigger">
	{#snippet trigger()}
		<!-- The button shows the mode that app.html put on <html> as data-theme, by CSS, so it is right on the first paint. -->
		{#each modes as { id, label, icon: Icon } (id)}
			<span class="mode" data-mode={id}>
				<Icon size={16} />
				<span class="mode-label">{label}</span>
			</span>
		{/each}
		<ChevronDown class="chevron" size={14} />
	{/snippet}
	{#snippet children(close)}
		{#each modes as { id, label, icon: Icon } (id)}
			<button
				type="button"
				role="menuitemradio"
				aria-checked={theme.mode === id}
				onclick={() => {
					setTheme(id);
					close();
				}}
			>
				<Icon size={16} />
				{label}
				{#if theme.mode === id}<Check size={14} class="checked" />{/if}
			</button>
		{/each}
	{/snippet}
</Dropdown>

<style>
	:global(.theme-trigger) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		height: 36px;
		min-width: 36px;
		padding: 0 8px;
		color: var(--docs-text-default);
		background: var(--docs-bg-default);
		border: 1px solid var(--docs-border);
		border-radius: var(--docs-radius-md);
		cursor: pointer;
		transition:
			background-color 150ms,
			transform 150ms;
	}

	:global(.theme-trigger:hover) {
		background: var(--docs-bg-subtle);
	}

	:global(.theme-trigger:active) {
		transform: scale(0.98);
	}

	.mode {
		display: none;
		align-items: center;
		gap: 8px;
	}

	:global(:root[data-theme="auto"]) .mode[data-mode="auto"],
	:global(:root[data-theme="light"]) .mode[data-mode="light"],
	:global(:root[data-theme="dark"]) .mode[data-mode="dark"] {
		display: inline-flex;
	}

	.mode :global(svg) {
		color: var(--docs-text-secondary);
	}

	.mode-label,
	:global(.theme-trigger .chevron) {
		display: none;
	}

	@media (min-width: 1008px) {
		:global(.theme-trigger) {
			min-width: 108px;
			justify-content: space-between;
			padding: 0 10px 0 12px;
		}
		.mode-label {
			display: inline;
			font-size: 14px;
		}
		:global(.theme-trigger .chevron) {
			display: block;
			color: var(--docs-text-tertiary);
		}
	}

	:global(.checked) {
		margin-left: auto;
		color: var(--accent);
	}
</style>
