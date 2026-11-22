/**
 * The example app's message catalog: what its shell (the root layout, the home screen, the page and error chrome) and the development lab
 * (the back and close buttons of `Page.svelte` and `/__dev/screen`) say, in English and Arabic. The rest of the lab writes its words in
 * English, as the harness expects (`qa/lib/screens.ts`). It is a file of the app and not of a package: Bun runs the harness's tests on
 * TypeScript only outside `node_modules`, and the harness reads these texts to name its cases (`qa/lib/copy.ts`).
 */

export type Locale = "en" | "ar";
type Tree = { [key: string]: string | Tree };
export type Strings<T> = {
  [K in keyof T]: T[K] extends string ? string : Strings<T[K]>;
};

export const en = {
  common: {
    back: "Back",
    close: "Close",
    retry: "Retry",
    loading: "Loading…",
    english: "English",
    arabic: "العربية",
  },
  errors: {
    somethingWentWrong: "Something went wrong",
    startFailed: "The app could not start. Try again in a moment.",
  },
  home: {
    title: "Expo Svelte",
    description: "Svelte 5 components running as a native Android and iOS app, with no React and no WebView.",
  },
};

export const ar = {
  common: {
    back: "رجوع",
    close: "إغلاق",
    retry: "إعادة المحاولة",
    loading: "جارٍ التحميل…",
    english: "English",
    arabic: "العربية",
  },
  errors: {
    somethingWentWrong: "حدث خطأ ما",
    startFailed: "تعذّر تشغيل التطبيق. حاول مرة أخرى بعد قليل.",
  },
  home: {
    title: "Expo Svelte",
    description: "مكوّنات Svelte 5 تعمل كتطبيق أصلي على Android وiOS، بلا React وبلا WebView.",
  },
} satisfies Strings<typeof en>;

export type DotPath<T> = T extends string
  ? never
  : {
      [K in keyof T & string]: T[K] extends string ? K : T[K] extends object ? `${K}.${DotPath<T[K]>}` : never;
    }[keyof T & string];
export type Translate<T = typeof en> = (key: DotPath<T>, values?: Record<string, string | number>) => string;

export function createTranslator<T extends Tree>(messages: T): Translate<T> {
  return (path, values) => {
    let message: unknown = messages;
    for (const key of path.split(".")) {
      if (message === null || typeof message !== "object" || !Object.prototype.propertyIsEnumerable.call(message, key))
        throw new Error(`Unknown translation key: ${path}`);
      message = Reflect.get(message, key);
    }
    if (typeof message !== "string") throw new Error(`Unknown translation key: ${path}`);
    return values
      ? message.replace(/\{\{(\w+)\}\}/gu, (placeholder, name: string) => (name in values ? String(values[name]) : placeholder))
      : message;
  };
}
