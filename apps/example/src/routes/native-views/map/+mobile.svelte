<script lang="ts">
  import { Text } from "@rasheed/svelte-native";
  import { MapView, Marker, type MapHandle } from "@rasheed/svelte-native/foreign";
  import Button from "#lib/components/Button.svelte";
  import Page from "#lib/components/Page.svelte";
  import Section from "#lib/components/Section.svelte";
  import { useDemo } from "#lib/demo.ts";
  import { text, theme } from "#lib/theme.svelte.ts";

  // `MapView` and `Marker` are react-native-maps' native views. `initialRegion` sets the first view, the markers are children, and `ref` gives
  // `animateToRegion`, `fitToCoordinates` and the other commands. iOS draws Apple Maps. Android needs a Google Maps key at build time
  // (`GOOGLE_MAPS_API_KEY`, see app.config.ts): without one the map mounts but draws no tiles.
  const places = [
    { name: "London", latitude: 51.5072, longitude: -0.1276 },
    { name: "Paris", latitude: 48.8566, longitude: 2.3522 },
  ];
  let map: MapHandle | null = null;
  const region = (place: (typeof places)[number]) => ({ latitude: place.latitude, longitude: place.longitude, latitudeDelta: 0.2, longitudeDelta: 0.2 });

  // `?demo`: fly the camera to Paris and back to London.
  let { url }: { url: URL } = $props();
  useDemo(() => url, [
    [() => map?.animateToRegion(region(places[1]), 1200), 2800],
    [() => map?.animateToRegion(region(places[0]), 1200), 2400],
  ], { settle: 1800, hold: 800 });
</script>

<Page title="Map" intro="MapView shows a map with markers. The buttons move the camera with the map's own commands.">
  <Section title="MapView" note="On Android the map is blank without a Google Maps key.">
    <MapView initialRegion={region(places[0])} accessibilityLabel="A map of London and Paris" ref={(handle) => { map = handle; }} style={{ height: 260, borderRadius: 12, overflow: "hidden", backgroundColor: theme.colors.border }}>
      {#each places as place (place.name)}
        <Marker coordinate={place} title={place.name} />
      {/each}
    </MapView>
    {#each places as place (place.name)}
      <Button label={`Go to ${place.name}`} variant="secondary" onPress={() => map?.animateToRegion(region(place), 800)} />
    {/each}
    <Text style={text.caption}>Markers mount when the map reports that it is ready.</Text>
  </Section>
</Page>
