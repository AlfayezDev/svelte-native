<script lang="ts" generics="T">
  import { untrack, onDestroy, type Snippet } from "svelte";
  import type {} from "../elements.d.ts";
  import type { ScrollViewInstance as NativeScrollView, ScrollViewProps, ViewStyle, LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from "react-native";
  import ScrollView from "./ScrollView.svelte";

  type Scroller = { dispatchCommand(name: string, args: unknown[]): void };
  type ViewToken<Item> = { item: Item; key: string | number; index: number; isViewable: boolean };

  let {
    items,
    rowHeight,
    estimatedRowHeight = 48,
    rowHeights,
    keyOf,
    keyExtractor,
    row,
    header,
    footer,
    empty,
    overscan = 4,
    initialNumToRender,
    initialScrollIndex,
    recycle = false,
    onEndReached,
    onEndReachedThreshold = 0.5,
    onViewableItemsChanged,
    viewabilityConfig,
    horizontal = false,
    scrollEventThrottle = 16,
    contentContainerStyle,
    onScroll,
    onLayout,
    ref,
    ...rest
  }: Omit<ScrollViewProps, "children" | "horizontal" | "onScroll" | "onLayout" | "ref"> & {
    items: readonly T[];
    /** Fixed size of every row along the scroll axis, in dp (height, or width when `horizontal`). Omit to measure rows. */
    rowHeight?: number;
    /** Size assumed for a row until it has been measured (default 48). */
    estimatedRowHeight?: number;
    /** Precomputed row sizes; rows are not measured when given. */
    rowHeights?: (item: T, index: number) => number;
    /** Stable identity of a row; defaults to its index. */
    keyOf?: (item: T, index: number) => string | number;
    /** Alias of `keyOf`. */
    keyExtractor?: (item: T, index: number) => string | number;
    row: Snippet<[item: T, index: number]>;
    header?: Snippet;
    footer?: Snippet;
    /** Rendered instead of rows while `items` is empty. */
    empty?: Snippet;
    /** Rows mounted before and after the viewport. */
    overscan?: number;
    /** Rows mounted before the first layout reports the viewport size (default 10). */
    initialNumToRender?: number;
    /** Row scrolled to when the first layout arrives, below the header; a list with no rows yet scrolls to it when they arrive. */
    initialScrollIndex?: number;
    /** Keep a fixed pool of wrapper nodes and re-target them by index instead of mounting rows. Row component state does not survive index changes. */
    recycle?: boolean;
    onEndReached?: () => void;
    /** Distance from the end that triggers `onEndReached`, as a fraction of the viewport. */
    onEndReachedThreshold?: number;
    /** Debounced; fires with the rows that crossed the visibility threshold. */
    onViewableItemsChanged?: (info: { viewableItems: ViewToken<T>[]; changed: ViewToken<T>[] }) => void;
    viewabilityConfig?: { itemVisiblePercentThreshold?: number; minimumViewTime?: number };
    horizontal?: boolean;
    onScroll?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
    onLayout?: (event: LayoutChangeEvent) => void;
    ref?: (instance: NativeScrollView | null) => void;
  } = $props();

  /** Frames between the rows that show and the overscan rows around them. */
  const OVERSCAN_FRAMES = 4;

  const fixed = $derived(rowHeight !== undefined);
  const measured = $derived(rowHeight === undefined && !rowHeights);
  const keyFn = $derived(keyOf ?? keyExtractor);
  const keyAt = (index: number) => {
    const key = keyFn;
    return key ? key(items[index], index) : index;
  };

  let scroller: Scroller | null = null;
  let scroll = $state(0);
  let viewport = $state(0);
  let headerSize = $state(0);
  let laidOut = false;
  let headerSeen = false;
  /** The size along the axis the spacer (the content the rows are in) was last laid out at, -1 before its first layout. */
  let spacerSize = -1;
  /** `initialScrollIndex` is done with: its jump was sent, or the list had rows at its first layout with none to scroll to, or the app scrolled it itself. Reactive: the window follows the jump until then. */
  let initialSent = $state(false);
  let firedFor = -1;
  let pool = $state(0);

  // Height table: measured sizes by row key, plus a cached prefix-sum array that is rebuilt from the first changed index.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- read inside a derived that is invalidated through `version`
  const sizes = new Map<string | number, number>();
  let version = $state(0);
  let offsets: number[] = [0];
  let valid = 1;
  let lastItems: readonly T[] | undefined;
  let lastCount = -1;
  let frame: ReturnType<typeof setTimeout> | undefined;

  function sizeAt(index: number) {
    if (rowHeight !== undefined) return rowHeight;
    if (rowHeights) return rowHeights(items[index], index);
    return sizes.get(keyAt(index)) ?? estimatedRowHeight;
  }

  const layout = $derived.by(() => {
    const n = items.length;
    if (rowHeight !== undefined) {
      const size = rowHeight;
      return {
        total: n * size,
        offsetOf: (index: number) => index * size,
        indexAt: (position: number) => Math.floor(position / size),
        endIndex: (position: number) => Math.ceil(position / size) - 1,
      };
    }
    void version;
    // A `rowHeights` function may read state of its own (a row that expands), and a new one may be passed: the table is built again whenever this runs with one,
    // so each run reads every row's size and runs again when what they read changes. Only measured sizes keep the prefix up to the first one that changed.
    if (rowHeights || items !== lastItems || n !== lastCount) { valid = 1; lastItems = items; lastCount = n; }
    offsets.length = Math.min(offsets.length, valid);
    for (let index = valid - 1; index < n; index++) offsets[index + 1] = offsets[index] + sizeAt(index);
    valid = n + 1;
    const table = offsets;
    // Largest i with table[i] <= position.
    const indexAt = (position: number) => {
      let low = 0, high = n;
      while (low < high) {
        const mid = (low + high + 1) >> 1;
        if (table[mid] <= position) low = mid; else high = mid - 1;
      }
      return Math.min(low, n - 1);
    };
    return {
      total: table[n],
      offsetOf: (index: number) => table[index],
      indexAt,
      // Last row that starts before `position`.
      endIndex: (position: number) => {
        let low = 0, high = n;
        while (low < high) {
          const mid = (low + high) >> 1;
          if (table[mid] < position) low = mid + 1; else high = mid;
        }
        return low - 1;
      },
    };
  });

  function measure(index: number, key: string | number, size: number) {
    if (!(size >= 0)) return;
    const known = sizes.get(key);
    if (known === undefined ? Math.abs(size - estimatedRowHeight) < 0.5 : Math.abs(size - known) < 0.5) {
      if (known === undefined) sizes.set(key, size);
      return;
    }
    sizes.set(key, size);
    valid = Math.min(valid, index + 1);
    frame ??= setTimeout(() => { frame = undefined; version++; }, 16);
  }

  const count = $derived(items.length);
  // The overscan rows are not what the user sees first. A list that fills (or fills again after it was empty) mounts the rows that
  // show, and the overscan follows a few frames later: the screen's rows reach the layout before the rows around them do. One frame
  // was not enough on a phone whose cores have clocked down: the overscan's flush (3 ms, 16 nodes) started as soon as the first one
  // ended, ahead of the layout event of the rows that show in the JavaScript thread's queue, and the user's rows waited for it.
  // The wait depends on whether the list has rows, not on how many: a list that keeps growing (a feed that loads more every few frames) must not
  // start the wait again each time, or it would never get its overscan.
  let overscanFrom = $state(false);
  const filled = $derived(count > 0);
  const reach = $derived(overscanFrom ? overscan : 0);
  $effect(() => {
    if (!filled) { overscanFrom = false; return; }
    if (overscanFrom) return;
    const scope = globalThis as { requestAnimationFrame?: (callback: () => void) => number; cancelAnimationFrame?: (handle: number) => void };
    const frameRequest = scope.requestAnimationFrame;
    if (!frameRequest) { overscanFrom = true; return; }
    let remaining = OVERSCAN_FRAMES;
    let handle = 0;
    const step = () => {
      if (--remaining > 0) handle = frameRequest(step);
      else overscanFrom = true;
    };
    handle = frameRequest(step);
    return () => scope.cancelAnimationFrame?.(handle);
  });
  const start = $derived(initialScrollIndex ?? 0);
  // Where the window is. Until the jump to `initialScrollIndex` is sent the list is at the top, but the rows that are mounted are the ones around the row it will jump to (with the header's
  // size as it is known by now): the first rows would be mounted at the top and replaced by the ones around the target when it is sent, and a frame at the target would show none.
  const waiting = $derived(initialScrollIndex !== undefined && !initialSent && count > 0);
  const windowAt = $derived(waiting ? headerSize + layout.offsetOf(Math.max(0, Math.min(count - 1, initialScrollIndex as number))) : scroll);
  const first = $derived.by(() => {
    if (!viewport) return Math.max(0, Math.min(count - 1, start));
    const top = Math.max(0, windowAt - headerSize);
    return Math.max(0, Math.min(count - 1, layout.indexAt(top) - reach));
  });
  // Before the first layout the viewport is unknown. A list that says its size in its style gets the rows that fill it (the
  // rows below the fold arrive with the overscan once the layout is known); any other list gets `initialNumToRender` or 10.
  const styleSize = $derived.by(() => {
    const key = horizontal ? "width" : "height";
    let size: number | null = null;
    const visit = (style: unknown) => {
      if (Array.isArray(style)) for (const item of style) visit(item);
      else if (style && typeof style === "object" && typeof (style as Record<string, unknown>)[key] === "number") size = (style as Record<string, number>)[key];
    };
    visit(rest.style);
    return size;
  });
  const firstWindow = $derived(initialNumToRender ?? (styleSize ? Math.max(1, Math.ceil(styleSize / (fixed ? (rowHeight as number) : estimatedRowHeight))) : 10));
  const last = $derived.by(() => {
    if (!viewport) return Math.min(count - 1, first + firstWindow - 1);
    const bottom = Math.max(0, windowAt - headerSize) + viewport;
    return Math.min(count - 1, layout.endIndex(bottom) + reach);
  });
  const indices = $derived.by(() => {
    const out: number[] = [];
    for (let index = first; index <= last; index++) out.push(index);
    return out;
  });

  // The rows of a list whose rows all have one size, each with its key and the style of its wrapper made once and kept while the key and the
  // placement hold: the block that renders them reads a member of its item where it called `keyAt` and `wrapperStyle` for every row (a derived
  // and its bookkeeping per row), and a row whose index did not move keeps the style object its effect already set. Plain bookkeeping, never rendered.
  type Described = { index: number; key: string | number; style: ViewStyle; place: unknown };
  let described = new Map<number, Described>();
  const fixedRows = $derived.by(() => {
    const place = placeFixed;
    if (!place) return [];
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping of this derived, read and written only here, never rendered
    const next = new Map<number, Described>();
    const out: Described[] = [];
    for (const index of indices) {
      const key = keyAt(index);
      let row = described.get(index);
      if (!row || row.key !== key || row.place !== place) row = { index, key, style: place(index), place };
      next.set(index, row);
      out.push(row);
    }
    described = next;
    return out;
  });

  // Recycle pool: sized for a full window up front for fixed rows, grown to the high-water mark otherwise.
  const windowSize = $derived(Math.max(0, last - first + 1));
  const poolSize = $derived(Math.max(pool, fixed && viewport ? Math.min(count, Math.ceil(viewport / (rowHeight as number)) + 1 + 2 * overscan) : 0, windowSize));
  $effect.pre(() => {
    if (recycle && windowSize > untrack(() => pool)) pool = windowSize;
  });
  const slots = $derived(recycle ? Array.from({ length: poolSize }, (_, slot) => slot) : []);
  // Row index shown by a slot: the one in the window congruent to the slot modulo the pool size, so a scroll step re-targets one slot.
  function indexOfSlot(slot: number) {
    if (!poolSize) return -1;
    const base = first - (((first % poolSize) + poolSize) % poolSize);
    let index = base + slot;
    if (index < first) index += poolSize;
    return index <= last ? index : -1;
  }

  // Rows that all have one size are placed by index times that size, which needs nothing of the item table: one derived for the list that
  // every row asks once (a row used to read six signals for the same answer), and a list that grows leaves the rows it has alone.
  const placeFixed = $derived.by(() => {
    if (rowHeight === undefined) return null;
    const size = rowHeight;
    return horizontal
      ? (index: number): ViewStyle => ({ position: "absolute", left: index * size, top: 0, bottom: 0, width: size })
      : (index: number): ViewStyle => ({ position: "absolute", top: index * size, left: 0, right: 0, height: size });
  });
  function wrapperStyle(index: number): ViewStyle {
    const place = placeFixed;
    if (place) return place(index);
    const size = fixed || !measured ? sizeAt(index) : undefined;
    return horizontal
      ? { position: "absolute", left: layout.offsetOf(index), top: 0, bottom: 0, width: size }
      : { position: "absolute", top: layout.offsetOf(index), left: 0, right: 0, height: size };
  }
  const hiddenStyle: ViewStyle = { display: "none" };
  const spacerStyle = $derived(horizontal ? { width: layout.total } : { height: layout.total });
  const contentStyle = $derived(horizontal ? [{ flexDirection: "row" } as ViewStyle, contentContainerStyle] : contentContainerStyle);

  function rowProps(index: number, key: string | number) {
    return { onLayout: (event: LayoutChangeEvent) => { const { width, height } = event.nativeEvent.layout; measure(index, key, horizontal ? width : height); } };
  }
  function slotProps(slot: number) {
    return { onLayout: (event: LayoutChangeEvent) => {
      const index = indexOfSlot(slot);
      if (index < 0) return;
      const { width, height } = event.nativeEvent.layout;
      measure(index, keyAt(index), horizontal ? width : height);
    } };
  }

  function checkEnd() {
    // Not while the jump waits: the list is at 0 until it is sent, and what is at the end of a list that is about to be somewhere else is not what the app asked about.
    if (!onEndReached || !viewport || !count || firedFor === count || waiting) return;
    const remaining = headerSize + layout.total - (scroll + viewport);
    if (remaining <= onEndReachedThreshold * viewport) {
      firedFor = count;
      onEndReached();
    }
  }

  // Viewability: debounced, relative to the current window.
  let viewable = new Map<string | number, ViewToken<T>>();
  let viewableTimer: ReturnType<typeof setTimeout> | undefined;
  function scheduleViewable() {
    if (!onViewableItemsChanged || viewableTimer) return;
    viewableTimer = setTimeout(() => {
      viewableTimer = undefined;
      const handler = onViewableItemsChanged;
      // Not while the jump waits either: the rows at the top are not the ones the list is about to show, and reporting them would be an impression the user never had. The scroll the jump makes reports, and the jump asks for both itself when it goes (`sendInitial`), for the day it moves nothing.
      if (!handler || !viewport || waiting) return;
      const percent = (viewabilityConfig?.itemVisiblePercentThreshold ?? 50) / 100;
      const top = Math.max(0, scroll - headerSize);
      const bottom = top + viewport;
      // eslint-disable-next-line svelte/prefer-svelte-reactivity -- plain bookkeeping, never rendered
      const now = new Map<string | number, ViewToken<T>>();
      if (count) {
        for (let index = Math.max(0, layout.indexAt(top)); index < count; index++) {
          const begin = layout.offsetOf(index);
          if (begin >= bottom) break;
          const size = sizeAt(index);
          const shown = Math.min(bottom, begin + size) - Math.max(top, begin);
          if (shown > 0 && shown >= Math.min(size, viewport) * percent) {
            const key = keyAt(index);
            now.set(key, { item: items[index], key, index, isViewable: true });
          }
        }
      }
      const changed: ViewToken<T>[] = [];
      for (const [key, token] of now) if (!viewable.has(key)) changed.push(token);
      for (const [key, token] of viewable) if (!now.has(key)) changed.push({ ...token, isViewable: false });
      viewable = now;
      if (changed.length) handler({ viewableItems: [...now.values()], changed });
    }, 50);
  }
  onDestroy(() => { clearTimeout(viewableTimer); clearTimeout(frame); clearTimeout(fallback); });
  // Re-evaluate once heights or items change under a stationary viewport.
  $effect(() => { void layout; void count; untrack(scheduleViewable); });

  function handleScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const { contentOffset } = event.nativeEvent;
    scroll = horizontal ? contentOffset.x : contentOffset.y;
    checkEnd();
    scheduleViewable();
    onScroll?.(event);
  }

  // `initialScrollIndex` is the header's size plus the row's offset, scrolled to once the content it is in has been laid out, as React Native's list does (`_maybeScrollToInitialScrollIndex`, on
  // the first size of the content): the list's first layout, the header's first layout (it can come after the list's: Yoga's results put an ancestor ahead of a descendant), and the spacer's
  // layout at the size the rows ask for. That last is what has the rows in the platform's content: a list that loads gets its rows in a commit that comes after the effect that sees them, a scroll sent
  // from the effect goes out ahead of that commit, and Android's scroll view moves no further than the content it has (0 for an empty one). Once: rows that arrive in chunks are scrolled to at the
  // first, as far as they go (React Native's does one scroll too, to the end when the index is past the rows).
  let appAsked = false;
  let fallback: ReturnType<typeof setTimeout> | undefined;
  /** The number of rows the fallback's wait was started for: rows that come or go while it waits are new content to wait for, and the wait starts again. */
  let fallbackFor = 0;
  /** How long the jump waits for the spacer's layout once the list, the header and the rows are there, before it goes anyway: the platform clamps a scroll to the content it has, so this is no worse than a jump with no wait. */
  const SPACER_WAIT_MS = 1000;
  function sendInitial(force = false) {
    if (initialSent) return;
    // No rows: nothing to wait for (the platform clamps a scroll to 0 in an empty content), and a wait that was started for rows that are gone must not end into the rows that come next, before their layout.
    if (!count) { clearTimeout(fallback); fallback = undefined; return; }
    if (!laidOut) return;
    // The app scrolled the list itself before this one went: that is the last word (`scrollToOffset`, `scrollToIndex`), and the window follows what the list does from here.
    // No index at the first layout with rows: a later one (a prop that changes) is not a jump to make when the list grows.
    if (appAsked || initialScrollIndex === undefined) { clearTimeout(fallback); fallback = undefined; initialSent = true; checkEnd(); scheduleViewable(); return; }
    if (header && !headerSeen) return;
    if (!force && spacerSize + 0.5 < layout.total) {
      // The spacer's layout at the size the rows ask for has not come. It does with the commit that has the rows; this is for the day it does not (no event for a size the platform thinks it had).
      if (fallback && fallbackFor !== count) { clearTimeout(fallback); fallback = undefined; }
      fallbackFor = count;
      fallback ??= setTimeout(() => { fallback = undefined; untrack(() => sendInitial(true)); }, SPACER_WAIT_MS);
      return;
    }
    clearTimeout(fallback);
    fallback = undefined;
    initialSent = true;
    const target = headerSize + layout.offsetOf(Math.max(0, Math.min(count - 1, initialScrollIndex)));
    scroll = target;
    whenReady(() => scrollTo(target, false));
    // The list was not asked about its end or its rows while it waited, and a jump that moves nothing (a first page that fits, an index that is clamped to 0) is followed by no scroll event to ask on: the answer is due now.
    checkEnd();
    scheduleViewable();
  }
  $effect(() => { void count; untrack(() => sendInitial()); });
  // The header goes (or comes): the jump and a request for a row stop waiting for a first layout of it that will not come, and the size it had is gone with it.
  $effect(() => {
    if (header) return;
    untrack(() => {
      headerSize = 0;
      headerSeen = false;
      sendInitial();
      sendPendingScroll();
    });
  });

  function handleSpacerLayout(event: LayoutChangeEvent) {
    const { width, height } = event.nativeEvent.layout;
    spacerSize = horizontal ? width : height;
    sendInitial();
  }
  // Only while the jump waits for it: a list that is not scrolled to a row asks for no layout events of its spacer.
  const spacerProps = { onLayout: handleSpacerLayout };

  function handleLayout(event: LayoutChangeEvent) {
    const { width, height } = event.nativeEvent.layout;
    viewport = horizontal ? width : height;
    laidOut = true;
    // Every layout, not the first alone: a wake-up that was not enough then (the header was not seen, the rows were not there) may be now.
    sendInitial();
    sendPendingScroll();
    checkEnd();
    scheduleViewable();
    onLayout?.(event);
  }

  function handleHeaderLayout(event: LayoutChangeEvent) {
    const { width, height } = event.nativeEvent.layout;
    headerSize = horizontal ? width : height;
    headerSeen = true;
    sendInitial();
    sendPendingScroll();
  }

  const headerProps = { onLayout: handleHeaderLayout };

  function handleRef(instance: NativeScrollView | null) {
    scroller = instance as unknown as Scroller | null;
    sendPendingScroll();
    ref?.(instance);
  }

  // A scroll asked for before the scroll view is bound and has its first layout (a page that scrolls its list in the effect that runs as the list
  // mounts) reaches nothing: the command goes to no view, or to one with no content to scroll. The last such request is kept and sent when both are there; a request for a row also waits for the header,
  // whose size is part of the row's place (`needsHeader`).
  let pendingScroll: { send: () => void; needsHeader: boolean } | null = null;
  const ready = (needsHeader: boolean) => scroller !== null && laidOut && (!needsHeader || !header || headerSeen);
  function whenReady(send: () => void, needsHeader = false) {
    if (ready(needsHeader)) send();
    else pendingScroll = { send, needsHeader };
  }
  function sendPendingScroll() {
    if (!pendingScroll || !ready(pendingScroll.needsHeader)) return;
    const { send } = pendingScroll;
    pendingScroll = null;
    send();
  }
  function scrollTo(position: number, animated: boolean) {
    const x = horizontal ? position : 0;
    const y = horizontal ? 0 : position;
    scroller?.dispatchCommand("scrollTo", [x, y, animated]);
  }

  // Commands, not reads: called from an effect they must not subscribe it to the list's own state (the window, the row sizes, the header), and from anywhere, a derived included, so they write no state: the
  // request is kept in plain fields, and what the window follows (`initialSent`, state) is let go of by a microtask, which is where a write is allowed.
  // A request of the app is the last word, also over `initialScrollIndex` when that one still waits for the header or the rows.
  function takeOver() {
    appAsked = true;
    if (!initialSent) queueMicrotask(() => { if (!initialSent) initialSent = true; });
  }
  export function scrollToOffset(offset: number, animated = true) {
    untrack(() => { takeOver(); whenReady(() => scrollTo(Math.max(0, offset), animated)); });
  }

  export function scrollToIndex(index: number, animated = true) {
    untrack(() => { takeOver(); whenReady(() => scrollTo(headerSize + layout.offsetOf(Math.max(0, Math.min(count - 1, index))), animated), true); });
  }
</script>

<ScrollView {...rest} {horizontal} {scrollEventThrottle} contentContainerStyle={contentStyle} onScroll={handleScroll} onLayout={handleLayout} ref={handleRef}>
  {#if header}<native-view nativeProps={headerProps}>{@render header()}</native-view>{/if}
  <native-view nativeStyle={spacerStyle} nativeProps={initialScrollIndex !== undefined && !initialSent ? spacerProps : undefined}>
    {#if recycle}
      {#each slots as slot (slot)}
        {@const index = indexOfSlot(slot)}
        <native-view nativeStyle={index < 0 ? hiddenStyle : wrapperStyle(index)} nativeProps={measured ? slotProps(slot) : undefined}>
          {#if index >= 0}{@render row(items[index], index)}{/if}
        </native-view>
      {/each}
    {:else}
      {#if measured}
        {#each indices as index (keyAt(index))}
          <native-view nativeStyle={wrapperStyle(index)} nativeProps={rowProps(index, keyAt(index))}>
            {@render row(items[index], index)}
          </native-view>
        {/each}
      {:else if fixed}
        <!-- Rows of one size are described once (key and wrapper style), so the block reads a member of its item where it used to call. -->
        {#each fixedRows as described (described.key)}
          <native-view nativeStyle={described.style}>
            {@render row(items[described.index], described.index)}
          </native-view>
        {/each}
      {:else}
        <!-- Rows of known size need no layout report, and a wrapper without `nativeProps` is one attribute effect cheaper. -->
        {#each indices as index (keyAt(index))}
          <native-view nativeStyle={wrapperStyle(index)}>
            {@render row(items[index], index)}
          </native-view>
        {/each}
      {/if}
    {/if}
  </native-view>
  {#if count === 0 && empty}<native-view>{@render empty()}</native-view>{/if}
  {#if footer}<native-view>{@render footer()}</native-view>{/if}
</ScrollView>
