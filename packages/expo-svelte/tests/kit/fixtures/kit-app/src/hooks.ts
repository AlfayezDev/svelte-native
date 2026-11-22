import type { Transport } from "@sveltejs/kit";
import { Money } from "./lib/money.ts";

export const transport: Transport = {
  Money: { encode: (value) => value instanceof Money && [value.cents], decode: ([cents]) => new Money(cents) },
};
