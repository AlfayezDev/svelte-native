/**
 * The application ids of the three apps `app.config.ts` makes (`APP_VARIANT`): the production variant, the QA app every gate of `qa/gates.json`
 * measures, and the smoke app (the QA app plus the production variant's native libraries). One list, read by `app.config.ts`, the QA harness
 * (`qa/lib/variant.ts`) and `lab-flag.ts` (which decides what runs of the development lab); `qa/test/lab-flag.test.ts` ties them to the config
 * of each variant.
 */
/** Not a store app's id such as `com.example.app`: a QA build must never replace a real app on a device or target its store listing. */
export const productApplicationId = "dev.alfayez.exposvelte.qaproduct";
export const qaApplicationId = "dev.alfayez.exposvelte.qa";
export const smokeApplicationId = "dev.alfayez.exposvelte.qa.smoke";
