import { type Snippet } from "svelte";
import type { ScrollViewInstance as NativeScrollView, ScrollViewProps, LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from "react-native";
declare function $$render<T>(): {
    props: Omit<ScrollViewProps, "children" | "onLayout" | "onScroll" | "horizontal" | "ref"> & {
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
        /** Row scrolled to when the first layout arrives. */
        initialScrollIndex?: number;
        /** Keep a fixed pool of wrapper nodes and re-target them by index instead of mounting rows. Row component state does not survive index changes. */
        recycle?: boolean;
        onEndReached?: () => void;
        /** Distance from the end that triggers `onEndReached`, as a fraction of the viewport. */
        onEndReachedThreshold?: number;
        /** Debounced; fires with the rows that crossed the visibility threshold. */
        onViewableItemsChanged?: (info: {
            viewableItems: {
                item: T;
                key: string | number;
                index: number;
                isViewable: boolean;
            }[];
            changed: {
                item: T;
                key: string | number;
                index: number;
                isViewable: boolean;
            }[];
        }) => void;
        viewabilityConfig?: {
            itemVisiblePercentThreshold?: number;
            minimumViewTime?: number;
        };
        horizontal?: boolean;
        onScroll?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
        onLayout?: (event: LayoutChangeEvent) => void;
        ref?: (instance: NativeScrollView | null) => void;
    };
    exports: {
        scrollToOffset: (offset: number, animated?: boolean) => void;
        scrollToIndex: (index: number, animated?: boolean) => void;
    };
    bindings: "";
    slots: {};
    events: {};
};
declare class __sveltets_Render<T> {
    props(): ReturnType<typeof $$render<T>>['props'];
    events(): ReturnType<typeof $$render<T>>['events'];
    slots(): ReturnType<typeof $$render<T>>['slots'];
    bindings(): "";
    exports(): {
        scrollToOffset: (offset: number, animated?: boolean) => void;
        scrollToIndex: (index: number, animated?: boolean) => void;
    };
}
interface $$IsomorphicComponent {
    new <T>(options: import('svelte').ComponentConstructorOptions<ReturnType<__sveltets_Render<T>['props']>>): import('svelte').SvelteComponent<ReturnType<__sveltets_Render<T>['props']>, ReturnType<__sveltets_Render<T>['events']>, ReturnType<__sveltets_Render<T>['slots']>> & {
        $$bindings?: ReturnType<__sveltets_Render<T>['bindings']>;
    } & ReturnType<__sveltets_Render<T>['exports']>;
    <T>(internal: unknown, props: ReturnType<__sveltets_Render<T>['props']> & {}): ReturnType<__sveltets_Render<T>['exports']>;
    z_$$bindings?: ReturnType<__sveltets_Render<any>['bindings']>;
}
declare const List: $$IsomorphicComponent;
type List<T> = InstanceType<typeof List<T>>;
export default List;
