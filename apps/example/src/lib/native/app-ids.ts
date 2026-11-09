/**
 * The application ids of the three apps `app.config.ts` makes (`APP_VARIANT`): the production variant, the QA app every gate of `qa/gates.json`
 * measures, and the smoke app (the QA app plus the production variant's native libraries). One list, read by `app.config.ts`, the QA harness
 * (`qa/lib/variant.ts`) and `lab-flag.ts` (which decides what runs of the development lab); `qa/test/lab-flag.test.ts` ties them to the config
 * of each variant.
 */
export const productApplicationId = "io.rasheed.app";
export const qaApplicationId = "io.rasheed.svelteqa";
export const smokeApplicationId = "io.rasheed.svelteqa.smoke";
