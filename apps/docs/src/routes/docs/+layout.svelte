<script lang="ts">
	import Sidebar from "#lib/components/Sidebar.svelte";

	let { data, children } = $props();
</script>

<div class="shell">
	<div class="sidebar">
		<Sidebar areas={data.areas} />
	</div>

	{@render children()}
</div>

<style>
	.shell {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
	}

	.sidebar {
		display: none;
	}

	/* The sidebar and the table of contents stay where they are while the page scrolls under the header. */
	@media (min-width: 1008px) {
		.shell {
			grid-template-columns: var(--docs-sidebar-width) minmax(0, 1fr);
		}
		.sidebar {
			display: block;
			position: sticky;
			top: var(--docs-header-height);
			align-self: start;
			height: calc(100dvh - var(--docs-header-height));
			overflow-y: auto;
			overscroll-behavior: contain;
			border-right: 1px solid var(--docs-border);
		}
	}

	@media (min-width: 1328px) {
		.shell {
			grid-template-columns: var(--docs-sidebar-width) minmax(0, 1fr) var(--docs-sidebar-width);
		}
	}
</style>
