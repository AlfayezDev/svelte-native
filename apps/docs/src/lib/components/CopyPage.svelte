<script lang="ts">
	import Check from "@lucide/svelte/icons/check";
	import ChevronDown from "@lucide/svelte/icons/chevron-down";
	import Copy from "@lucide/svelte/icons/copy";
	import FileText from "@lucide/svelte/icons/file-text";
	import SquareArrowOutUpRight from "@lucide/svelte/icons/square-arrow-out-up-right";

	import { resolve } from "$app/paths";
	import { copyText } from "#lib/enhance";
	import Dropdown from "./Dropdown.svelte";

	let { slug }: { slug: string } = $props();

	const url = $derived(resolve("/docs/[slug].md", { slug }));
	let status = $state<"idle" | "copied" | "failed">("idle");
	let timer: ReturnType<typeof setTimeout> | undefined;

	async function copy(close: () => void) {
		let copied: boolean;
		try {
			// Safari only lets a copy happen in the click that asked for it: hand it the promise of the text, not the text.
			if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
				const text = fetch(url).then((response) => (response.ok ? response.blob() : Promise.reject(new Error(response.statusText))));
				await navigator.clipboard.write([new ClipboardItem({ "text/plain": text.then((blob) => new Blob([blob], { type: "text/plain" })) })]);
				copied = true;
			} else {
				const response = await fetch(url);
				copied = response.ok && (await copyText(await response.text()));
			}
		} catch {
			copied = false;
		}
		status = copied ? "copied" : "failed";
		clearTimeout(timer);
		timer = setTimeout(() => (status = "idle"), 2000);
		close();
	}
</script>

<Dropdown label="Copy page" class="copy-page">
	{#snippet trigger()}
		{#if status === "copied"}<Check size={14} />{:else}<Copy size={14} />{/if}
		<span aria-live="polite">{status === "copied" ? "Copied!" : status === "failed" ? "Couldn't copy" : "Copy page"}</span>
		<ChevronDown size={14} />
	{/snippet}
	{#snippet children(close)}
		<button type="button" role="menuitem" onclick={() => copy(close)}><Copy size={16} />Copy Markdown</button>
		<a role="menuitem" href={url} target="_blank" rel="noreferrer" onclick={() => close()}><FileText size={16} />View Markdown<SquareArrowOutUpRight class="menu-external" size={12} /></a>
		<a role="menuitem" href={resolve("/llms.txt")} target="_blank" rel="noreferrer" onclick={() => close()}><FileText size={16} />llms.txt<SquareArrowOutUpRight class="menu-external" size={12} /></a>
	{/snippet}
</Dropdown>

<style>
	:global(.copy-page) {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 32px;
		padding: 0 10px;
		font-size: 12px;
		font-weight: 500;
		color: var(--docs-text-default);
		background: var(--docs-bg-default);
		border: 1px solid var(--docs-border);
		border-radius: var(--docs-radius-md);
		cursor: pointer;
		transition:
			background-color 150ms,
			transform 150ms;
	}

	:global(.copy-page:hover) {
		background: var(--docs-bg-subtle);
	}

	:global(.copy-page:active) {
		transform: scale(0.98);
	}

	:global(.menu-external) {
		margin-left: auto;
		color: var(--docs-text-tertiary);
	}
</style>
