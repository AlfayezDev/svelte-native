<script lang="ts">
  import { Text, View } from "@example/svelte-native";
  import Button from "#lib/components/Button.svelte";
  import Page from "#lib/components/Page.svelte";
  import Section from "#lib/components/Section.svelte";
  import { text, theme } from "#lib/theme.svelte.ts";

  // Internationalization and right-to-left. The words are a plain object per language, picked by state; plurals, numbers and dates come from
  // `Intl`. The layout direction is a style: `direction: "rtl"` on a view flips its rows, and a logical key such as `marginStart` follows it
  // where `marginLeft` would not. The cards below take their direction from the chosen language; the header and the rest of the app keep theirs.
  const messages = {
    en: { hello: "Hello, Sam", cart: "Your cart", zero: "is empty", one: "has one item", two: "has two items", few: "has {n} items", many: "has {n} items", other: "has {n} items" },
    ar: { hello: "مرحباً يا سام", cart: "سلتك", zero: "فارغة", one: "فيها عنصر واحد", two: "فيها عنصران", few: "فيها {n} عناصر", many: "فيها {n} عنصراً", other: "فيها {n} عنصر" },
  };
  const locales = { en: "en-US", ar: "ar-EG" };
  let language = $state<"en" | "ar">("en");
  let count = $state(3);
  const direction = $derived(language === "ar" ? ("rtl" as const) : ("ltr" as const));
  const words = $derived(messages[language]);
  const form = $derived(new Intl.PluralRules(locales[language]).select(count));
  const number = $derived(new Intl.NumberFormat(locales[language]).format(count));
  const cart = $derived(`${words.cart} ${words[form].replace("{n}", number)}`);
  const price = $derived(new Intl.NumberFormat(locales[language], { style: "currency", currency: "USD" }).format(1234.5));
  const date = $derived(new Intl.DateTimeFormat(locales[language], { year: "numeric", month: "long", day: "numeric" }).format(new Date(2026, 10, 9)));
</script>

<Page title="Internationalization" intro="One screen in English and in Arabic. Pick a language and the words, the numbers and the direction of the layout change together.">
  <Section title="Language">
    <View style={{ flexDirection: "row", gap: 8 }}>
      <View style={{ flex: 1 }}><Button label="English" variant={language === "en" ? "primary" : "secondary"} onPress={() => (language = "en")} /></View>
      <View style={{ flex: 1 }}><Button label="العربية" variant={language === "ar" ? "primary" : "secondary"} onPress={() => (language = "ar")} /></View>
    </View>
  </Section>

  <Section title="Direction" note="One row: an avatar, then the text, with marginStart between them. Both swap sides in right-to-left.">
    <View style={{ direction, flexDirection: "row", alignItems: "center" }}>
      <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: theme.colors.accent }} />
      <View style={{ flex: 1, marginStart: 12 }}>
        <Text style={[text.heading, { writingDirection: direction }]}>{words.hello}</Text>
        <Text style={[text.caption, { writingDirection: direction }]}>{date}</Text>
      </View>
    </View>
  </Section>

  <Section title="Plurals and numbers" note="Intl.PluralRules picks the form (Arabic has six), and Intl.NumberFormat writes the digits.">
    <View style={{ direction, gap: 12 }}>
      <Text style={[text.body, { writingDirection: direction }]}>{cart}</Text>
      <Text style={[text.body, { writingDirection: direction }]}>{price}</Text>
    </View>
    <View style={{ flexDirection: "row", gap: 8 }}>
      <View style={{ flex: 1 }}><Button label="Fewer" variant="secondary" disabled={count === 0} onPress={() => count--} /></View>
      <View style={{ flex: 1 }}><Button label="More" variant="secondary" onPress={() => count++} /></View>
    </View>
  </Section>
</Page>
