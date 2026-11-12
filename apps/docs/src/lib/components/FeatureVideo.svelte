<script lang="ts">
	// The feature video of a page: a recording of the component or the feature on a phone, with a switch between iOS and Android.
	// It is muted, loops and has controls; it plays only while it is on screen, and does not start by itself for a reader who asked for less motion.
	import type { Platform, VideoSource } from "#lib/docs.server";
	import { media, setVideoPlatform } from "#lib/state/prefs.svelte";

	let { title, sources }: { title: string; sources: VideoSource[] } = $props();

	const LABELS: Record<Platform, string> = { android: "Android", ios: "iOS" };

	// The reader's platform, or the one the page has a recording for.
	const current = $derived(sources.find((source) => source.platform === media.platform) ?? sources[0]);
	let video = $state<HTMLVideoElement>();
	let ratio = $state(9 / 19.5);

	$effect(() => {
		const element = video;
		if (!element) return;
		element.muted = true;
		if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;

		let paused = false; // the reader paused it: it stays paused until they play it
		let ours = false;
		const onpause = () => {
			if (!ours) paused = true;
		};
		const onplay = () => (paused = false);
		element.addEventListener("pause", onpause);
		element.addEventListener("play", onplay);

		const observer = new IntersectionObserver(
			([entry]) => {
				if (entry.isIntersecting) {
					if (!paused) void element.play().catch(() => {});
				} else {
					ours = true;
					element.pause();
					ours = false;
				}
			},
			{ threshold: 0.5 },
		);
		observer.observe(element);
		return () => {
			observer.disconnect();
			element.removeEventListener("pause", onpause);
			element.removeEventListener("play", onplay);
		};
	});
</script>

<figure class="feature-video" data-pagefind-ignore>
	{#if sources.length > 1}
		<div class="switch" role="group" aria-label="Platform">
			{#each sources as source (source.platform)}
				<button type="button" aria-pressed={source.platform === current.platform} onclick={() => setVideoPlatform(source.platform)}>{LABELS[source.platform]}</button>
			{/each}
		</div>
	{/if}
	{#key current.platform}
		<div class="frame" style:aspect-ratio={ratio} style:--width={ratio > 1 ? "540px" : "260px"}>
			<video
				bind:this={video}
				src={current.src}
				poster={current.poster}
				aria-label="{title} on {LABELS[current.platform]}"
				muted
				loop
				playsinline
				controls
				preload="metadata"
				onloadedmetadata={(event) => {
					const { videoWidth, videoHeight } = event.currentTarget;
					if (videoWidth && videoHeight) ratio = videoWidth / videoHeight;
				}}
			></video>
		</div>
	{/key}
</figure>

<style>
	.feature-video {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 16px;
		margin: 24px 0;
		padding: 20px 16px;
		background: var(--docs-bg-subtle);
		border: 1px solid var(--docs-border);
		border-radius: var(--docs-radius-2xl);
	}

	.switch {
		display: inline-flex;
		gap: 2px;
		padding: 3px;
		background: var(--docs-bg-element);
		border-radius: 999px;
	}

	.switch button {
		height: 28px;
		padding: 0 14px;
		font-size: 13px;
		font-weight: 500;
		color: var(--docs-text-secondary);
		background: none;
		border: 0;
		border-radius: 999px;
		cursor: pointer;
		transition:
			background-color 150ms,
			color 150ms;
	}

	.switch button:hover {
		color: var(--docs-text-default);
	}

	.switch button[aria-pressed="true"] {
		color: var(--docs-text-default);
		background: var(--docs-bg-default);
		box-shadow: var(--docs-shadow-xs);
	}

	.frame {
		width: min(100%, var(--width, 260px));
		max-height: 70dvh;
		overflow: hidden;
		background: #000;
		border-radius: 28px;
		box-shadow: var(--docs-shadow-sm);
	}

	video {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: contain;
	}
</style>
