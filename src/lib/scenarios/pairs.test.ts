import { describe, expect, it } from "vitest";
import { situationOf, withoutPairsOf, withPairs } from "./pairs";

const S = (id: string, ticketRef: string | null = null) => ({ id, ticketRef });
const ticket = S("t", "Б4-1");
const variant = S("v", "Б4-1-ош");
const other = S("o", "Б5-1");
const own = S("own"); // a teacher's scenario has no ticket

describe("a ticket and its variant with an error in the card are one situation", () => {
  it("names the situation by the ticket without the variant mark; a scenario without a ticket is its own", () => {
    expect(situationOf(ticket)).toBe("Б4-1");
    expect(situationOf(variant)).toBe("Б4-1");
    expect(situationOf(other)).toBe("Б5-1");
    expect(situationOf(own)).not.toBe(situationOf(S("own2")));
  });

  it("leaves out the other half of a pair the place has had, in either order", () => {
    const pool = [ticket, variant, other, own];
    expect(withoutPairsOf(pool, [ticket]).map((s) => s.id)).toEqual(["t", "o", "own"]);
    expect(withoutPairsOf(pool, [variant]).map((s) => s.id)).toEqual(["v", "o", "own"]);
    expect(withoutPairsOf(pool, [other, own])).toEqual(pool);
    expect(withoutPairsOf(pool, [])).toEqual(pool);
  });

  it("keeps the pool when the other half is all that is left", () => {
    expect(withoutPairsOf([variant], [ticket])).toEqual([variant]);
  });

  it("counts the other half of a busy scenario as busy", () => {
    expect([...withPairs(new Set(["t"]), [ticket, variant, other])].sort()).toEqual(["t", "v"]);
    expect([...withPairs(new Set(["o"]), [ticket, variant, other])]).toEqual(["o"]);
    expect([...withPairs(new Set(["x"]), [ticket, variant])]).toEqual(["x"]);
  });
});
