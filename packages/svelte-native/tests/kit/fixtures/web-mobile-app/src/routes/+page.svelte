<script lang="ts">
	import { browser, mobile } from '$app/env';
	import { mobile as deprecated } from '$app/environment';
	import { shared } from '../shared.ts';
</script>

<p id="flags">mobile={String(mobile)} deprecated={String(deprecated)} shared={shared} browser={String(browser)}</p>
