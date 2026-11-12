<script lang="ts">
	import { page } from "$app/state";
	import NotFound from "#lib/components/NotFound.svelte";
</script>

<svelte:head>
	<title>{page.status === 404 ? "Page not found" : "Something went wrong"} • Svelte Native</title>
	<meta name="robots" content="noindex" />
</svelte:head>

{#if page.status === 404}
	<NotFound />
{:else}
	<main id="main" class="failed">
		<h1>Something went wrong</h1>
		<p>{page.error?.message}</p>
	</main>
{/if}

<style>
	.failed {
		max-width: 640px;
		margin: 0 auto;
		padding: 96px 16px;
		text-align: center;
	}
</style>
