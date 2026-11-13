import { type Snippet } from "svelte";
import { type TabHandle, type TabItem } from "../fabric/navigation.js";
type $$ComponentProps = {
    items: readonly TabItem[];
    selected?: string;
    onSelect?: (key: string) => void;
    content?: Snippet<[tab: TabHandle]>;
    children?: Snippet;
    lazy?: boolean;
    /** Color of the selected tab's icon and label. */
    tint?: string;
    inactiveTint?: string;
    background?: string;
    labels?: "always" | "never";
};
declare const Tabs: import("svelte").Component<$$ComponentProps, {}, "">;
type Tabs = ReturnType<typeof Tabs>;
export default Tabs;
