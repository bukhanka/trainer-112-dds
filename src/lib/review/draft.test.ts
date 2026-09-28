import { describe, expect, it } from "vitest";
import type { CriterionResult } from "@/lib/scoring/score";
import { readCriteria, readDraft, readOverrides, ruleDraft } from "./draft";

describe("readCriteria", () => {
  it("keeps valid checks, tolerates «key» and drops broken rows", () => {
    const list = readCriteria([
      { code: "a", group: "address", title: "Адрес", ok: false, evidence: "Дубининская", source: "rule" },
      { key: "b", group: "timeliness", ok: true },
      { code: "c", group: "unknown-group", title: "?", ok: true },
      "garbage",
      null,
    ]);
    expect(list.map((c) => c.code)).toEqual(["a", "b"]);
    expect(list[1]).toMatchObject({ title: "b", source: "rule" });
    expect(readCriteria({ not: "an array" })).toEqual([]);
  });

  it("keeps the time and the norm of a time check, so new weights rescore it exactly", () => {
    const [ok, broken] = readCriteria([
      { code: "op112.typing_time", group: "timeliness", title: "Карточка сохранена за 1:38 при нормативе 1:05", ok: false, timing: { sec: 98, normSec: 65 } },
      { code: "op112.typing_time", group: "timeliness", title: "Время", ok: false, timing: { sec: "98", normSec: 0 } },
    ]);
    expect(ok.timing).toEqual({ sec: 98, normSec: 65 });
    // A broken time is dropped, the check stays: it is scored all or nothing, as before.
    expect(broken).toMatchObject({ code: "op112.typing_time", ok: false });
    expect(broken.timing).toBeUndefined();
  });

  it("reads only boolean or null corrections", () => {
    expect(readOverrides({ a: true, b: null, c: "yes" })).toEqual({ a: true, b: null });
    expect(readOverrides([])).toBeNull();
  });
});

describe("drafts", () => {
  const criteria: CriterionResult[] = [
    { code: "street", group: "address", title: "Улица записана верно", ok: false, critical: true, evidence: "«Дубининская»", expected: "Дубнинская", source: "rule" },
    { code: "time", group: "timeliness", title: "Вовремя", ok: true, source: "rule" },
  ];

  it("explains failures from the checks when no model is connected", () => {
    const d = ruleDraft(criteria);
    expect(d.summary).toContain("Ошибок: 1 из 2");
    expect(d.summary).toContain("Ошибки: «Не выполнено: Улица записана верно»");
    expect(d.comments?.street).toContain("Дубнинская");
    expect(d.recommendations).toHaveLength(1);
  });

  it("reads drafts written in other shapes", () => {
    expect(readDraft({ text: "Коротко" })).toEqual({ summary: "Коротко" });
    expect(readDraft(null)).toBeNull();
  });
});
