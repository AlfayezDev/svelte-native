import { ORIGIN, BASE } from "#lib/base-path";
import { renderCode } from "#lib/docs.server";

const EXAMPLE = `<script lang="ts">
	import { Pressable, Screen, Text, View } from '@example/svelte-native';

	let taps = $state(0);
</script>

<Screen title="Hello">
	<View style={{ flex: 1, padding: 24, gap: 16, justifyContent: 'center' }}>
		<Text>Tapped {taps} times.</Text>
		<Pressable onPress={() => taps++} accessibilityRole="button">
			<Text>Tap</Text>
		</Pressable>
	</View>
</Screen>`;

export function load() {
	return { example: renderCode(EXAMPLE, "svelte", "src/routes/+mobile.svelte"), canonical: `${ORIGIN}${BASE}/` };
}
