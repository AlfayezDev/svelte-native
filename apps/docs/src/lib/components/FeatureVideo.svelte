<script lang="ts">
	// The feature video of a page: a recording of the component or the feature on a phone, with a switch between iOS and Android.
	// It is muted, loops and has controls; it plays only while it is on screen, and does not start by itself for a reader who asked for less motion.
	// Both platforms' videos are in the page, and the stylesheet shows the one <html data-video="..."> names (set before the first paint, from the
	// reader's last choice), so the first paint is right. The other one is not loaded: preload="none", and a hidden video does not play.
	import type { Platform, VideoSource } from "#lib/docs.server";
	import { media, setVideoPlatform } from "#lib/state/prefs.svelte";

	let { title, sources }: { title: string; sources: VideoSource[] } = $props();

	const LABELS: Record<Platform, string> = { android: "Android", ios: "iOS" };
	const PORTRAIT = 9 / 19.5;

	// The reader's platform, or the one the page has a recording for.
	const current = $derived((sources.find((source) => source.platform === media.platform) ?? sources[0]).platform);
	let ratios = $state<Partial<Record<Platform, number>>>({});

	/** Plays the video while at least half of it is on screen, and pauses it when it leaves. A video the reader paused stays paused. */
	function autoplay(element: HTMLVideoElement) {
		element.muted = true;
		if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;

		let visible = false;
		let paused = false; // the reader paused it
		// The pause event comes after pause() returns, so what tells ours from the reader's is whether the video was on screen when it came.
		const onpause = () => {
			if (visible) paused = true;
		};
		const onplay = () => {
			paused = false;
		};
		element.addEventListener("pause", onpause);
		element.addEventListener("play", onplay);

		const observer = new IntersectionObserver(
			([entry]) => {
				visible = entry.isIntersecting;
				if (visible) {
					if (!paused) void element.play().catch(() => {});
				} else {
					element.pause();
				}
			},
			{ threshold: 0.5 },
		);
		observer.observe(element);
		return {
			destroy() {
				observer.disconnect();
				element.removeEventListener("pause", onpause);
				element.removeEventListener("play", onplay);
			},
		};
	}
</script>

<figure class="feature-video" data-pagefind-ignore>
	{#if sources.length > 1}
		<div class="switch" role="group" aria-label="Platform">
			{#each sources as source (source.platform)}
				<button type="button" data-platform={source.platform} aria-pressed={source.platform === current} onclick={() => setVideoPlatform(source.platform)}>{LABELS[source.platform]}</button>
			{/each}
		</div>
	{/if}
	<div class="frames">
		{#each sources as source (source.platform)}
			{@const ratio = ratios[source.platform] ?? PORTRAIT}
			<div class="frame" data-platform={source.platform} style:aspect-ratio={ratio} style:--width={ratio > 1 ? "540px" : "260px"}>
				<video
					use:autoplay
					src={source.src}
					poster={source.poster}
					aria-label="{title} on {LABELS[source.platform]}"
					muted
					loop
					playsinline
					controls
					preload="none"
					onloadedmetadata={(event) => {
						const { videoWidth, videoHeight } = event.currentTarget;
						if (videoWidth && videoHeight) ratios[source.platform] = videoWidth / videoHeight;
					}}
				></video>
			</div>
		{/each}
	</div>
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

	/* The chosen platform is the <html> attribute's, so the switch is right before the script of the page has run. */
	:global(:root:not([data-video]) .switch button[data-platform="ios"]),
	:global(:root[data-video="ios"] .switch button[data-platform="ios"]),
	:global(:root[data-video="android"] .switch button[data-platform="android"]) {
		color: var(--docs-text-default);
		background: var(--docs-bg-default);
		box-shadow: var(--docs-shadow-xs);
	}

	.frames {
		display: contents;
	}

	.frame {
		display: none;
		width: min(100%, var(--width, 260px));
		max-height: 70dvh;
		overflow: hidden;
		background: #000;
		border-radius: 28px;
		box-shadow: var(--docs-shadow-sm);
	}

	.frame:only-child,
	:global(:root:not([data-video]) .frame[data-platform="ios"]),
	:global(:root[data-video="ios"] .frame[data-platform="ios"]),
	:global(:root[data-video="android"] .frame[data-platform="android"]) {
		display: block;
	}

	video {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: contain;
	}
</style>
