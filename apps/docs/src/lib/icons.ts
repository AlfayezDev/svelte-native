// The Lucide icons (ISC) a section or an area of the guide can name in its index.md frontmatter, `icon: rocket`.
import BookMarked from "@lucide/svelte/icons/book-marked";
import BookOpen from "@lucide/svelte/icons/book-open";
import Blocks from "@lucide/svelte/icons/blocks";
import Compass from "@lucide/svelte/icons/compass";
import LifeBuoy from "@lucide/svelte/icons/life-buoy";
import Package from "@lucide/svelte/icons/package";
import Rocket from "@lucide/svelte/icons/rocket";
import Smartphone from "@lucide/svelte/icons/smartphone";
import Terminal from "@lucide/svelte/icons/terminal";

/** Every Lucide icon is a component of this type. */
export type Icon = typeof Rocket;

export const sectionIcons: Record<string, Icon> = {
	"book-marked": BookMarked,
	"book-open": BookOpen,
	blocks: Blocks,
	compass: Compass,
	"life-buoy": LifeBuoy,
	package: Package,
	rocket: Rocket,
	smartphone: Smartphone,
	terminal: Terminal,
};

/** The icon of an area, the group of sections one link at the top of the sidebar opens. */
export const areaIcons: Record<string, string> = { guide: "book-open", components: "blocks", reference: "book-marked" };
