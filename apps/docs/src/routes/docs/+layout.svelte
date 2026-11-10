<script lang="ts">
	import { afterNavigate } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { page } from "$app/state";

	let { data, children } = $props();
	let open = $state(false);

	afterNavigate(() => {
		open = false;
	});
</script>

<div class="docs">
	<button class="menu-button" type="button" aria-expanded={open} aria-controls="sidebar" onclick={() => (open = !open)}>
		{open ? "Close menu" : "Menu"}
	</button>

	<nav id="sidebar" class="sidebar" class:open aria-label="Documentation">
		<ol>
			{#each data.pages as { slug, title } (slug)}
				<li>
					<a href={resolve("/docs/[slug]", { slug })} aria-current={page.params.slug === slug ? "page" : undefined}>{title}</a>
				</li>
			{/each}
		</ol>
	</nav>

	{@render children()}
</div>
