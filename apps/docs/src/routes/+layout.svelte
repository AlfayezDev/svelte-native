<script lang="ts">
	import { REPOSITORY } from "#lib/site";
	import { resolve } from "$app/paths";
	import "../app.css";

	let { children } = $props();
</script>

<header class="site-header">
	<a class="brand" href={resolve("/docs/[slug]", { slug: "introduction" })}>Svelte Native</a>
	<a class="repo" href={REPOSITORY} rel="noreferrer">GitHub</a>
</header>

{@render children()}
