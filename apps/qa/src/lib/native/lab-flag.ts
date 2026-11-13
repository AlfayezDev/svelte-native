import { productApplicationId, qaApplicationId, smokeApplicationId } from "./app-ids.ts";

/**
 * What runs of the development lab (`state.svelte.ts`'s `nativeLabEnabled`). The bundle decides first: its route table says whether it carries the
 * lab (`lab` from `@alfayez/svelte-native/routes`, the table of the variant Metro bundled), and the product's bundle does not, so a lab call in
 * it would reach a stub that throws. The application id is only an extra: a development run (`__DEV__`) or the QA and smoke apps may run the lab,
 * the product never does. So a QA dev client with a product-variant Metro runs no lab (the bundle has none), and a product shell with an update
 * made without `APP_VARIANT=production` (a bundle that has the lab) refuses it, which `refused` reports for the log.
 */
export function labDecision({ bundleLab, applicationId, dev }: { bundleLab: boolean; applicationId: string | null; dev: boolean }): { enabled: boolean; refused: boolean } {
  const appRunsLab = applicationId !== productApplicationId && (dev || applicationId === qaApplicationId || applicationId === smokeApplicationId);
  return { enabled: bundleLab && appRunsLab, refused: bundleLab && applicationId === productApplicationId };
}
