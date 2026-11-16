/** A fault the lab can inject into the shell, to see that the app copes (none in a normal run). */
export const lateFault: "mount" | "effect" | undefined = undefined;
export const lateFaultMessage = "the lab's late fault";
