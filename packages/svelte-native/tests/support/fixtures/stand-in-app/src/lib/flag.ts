import { applicationId } from "expo-application";
import { lab as bundleLab } from "@alfayez/svelte-native/routes";

/** The application id of the store build: the one app that never runs the development lab. */
export const storeApplicationId = "com.example.app";

/**
 * What runs of the development lab. The bundle decides first: its route table says whether it carries the lab (`lab`, the table of the
 * variant Metro bundled), and a store variant's bundle does not, so a lab call in it would reach a stub that throws. The application id is
 * an extra: the store app never runs the lab, so a bundle that has it (an update published without `APP_VARIANT=production`) is refused.
 */
export const labEnabled: boolean = bundleLab && applicationId !== storeApplicationId;
export const labRefused: boolean = bundleLab && applicationId === storeApplicationId;
