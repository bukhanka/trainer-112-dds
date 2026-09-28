import { beforeEach, describe, expect, it, vi } from "vitest";

// «Создать черновик» of one situation of a ticket file: the usual draft from text, the note says the file and the
// ticket, the journal says «из файла билета»; only teachers and administrators.
type Row = Record<string, unknown>;
const store = vi.hoisted(() => ({
  user: null as null | { id: string; login: string; fullName: string; role: string },
  generated: [] as { text: string; difficulty?: number }[],
  updates: [] as Row[],
  audit: [] as Row[],
  fail: false,
}));

vi.mock("@/lib/auth/session", () => ({
  requireUser: async (roles?: string[]) => {
    if (!store.user) throw new Error("NEXT_REDIRECT /login");
    if (roles && !roles.includes(store.user.role)) throw new Error("NEXT_REDIRECT home");
    return store.user;
  },
}));
vi.mock("@/lib/scenarios/generate", () => ({
  generateScenarioDraft: async (input: { text: string; difficulty?: number }) => {
    if (store.fail) throw new Error("model down");
    store.generated.push(input);
    return { id: "s1", usedModel: false, finalType: "Пожар: мусор", services: 3 };
  },
}));
vi.mock("@/lib/db", () => ({
  db: {
    scenario: {
      findUnique: async () => ({ title: "Возгорание мусорного контейнера", teacherNote: "Создан по тексту (правила, без модели)." }),
      update: async ({ data }: { data: Row }) => store.updates.push(data),
    },
    auditLog: { create: async ({ data }: { data: Row }) => store.audit.push(data) },
  },
}));

const { createDraftFromTicket } = await import("@/app/teacher/scenarios/new/ticket-actions");
const TEXT = "Возгорание мусорного контейнера, пострадавших нет. Адрес: Москва, Депо (МЖД Киевская 1 км, стр. 2)";

beforeEach(() => {
  store.user = { id: "t1", login: "teacher", fullName: "Смирнова", role: "TEACHER" };
  store.generated = [];
  store.updates = [];
  store.audit = [];
  store.fail = false;
});

describe("a draft from one situation of a ticket file", () => {
  it("goes the usual way and says where it came from", async () => {
    const res = await createDraftFromTicket({ text: TEXT, label: "Билет 1, ситуация 1", fileName: "Билеты.docx", difficulty: 4 });
    expect(res).toEqual({ ok: true, id: "s1", title: "Возгорание мусорного контейнера", usedModel: false });
    expect(store.generated).toEqual([{ text: TEXT, difficulty: 4 }]);
    expect(store.updates).toEqual([{ teacherNote: "Из файла «Билеты.docx», Билет 1, ситуация 1. Создан по тексту (правила, без модели)." }]);
    expect(store.audit).toEqual([
      expect.objectContaining({ action: "scenario.generate", entity: "Scenario", entityId: "s1", actor: "teacher", after: expect.objectContaining({ via: "file", file: "Билеты.docx", ticket: "Билет 1, ситуация 1" }) }),
    ]);
  });

  it("asks for more text instead of a useless draft, and reports a failure without throwing", async () => {
    expect(await createDraftFromTicket({ text: "Пожар" })).toMatchObject({ ok: false, error: expect.stringMatching(/короткий/) });
    expect(await createDraftFromTicket({ text: TEXT, difficulty: 42 })).toMatchObject({ ok: false });
    store.fail = true;
    expect(await createDraftFromTicket({ text: TEXT })).toEqual({ ok: false, error: "Не удалось собрать черновик — попробуйте ещё раз" });
    expect(store.audit).toEqual([]);
  });

  it("is closed to students and anonymous visitors", async () => {
    store.user = { id: "st", login: "student1", fullName: "Иванов", role: "STUDENT" };
    await expect(createDraftFromTicket({ text: TEXT })).rejects.toThrow(/NEXT_REDIRECT/);
    store.user = null;
    await expect(createDraftFromTicket({ text: TEXT })).rejects.toThrow(/NEXT_REDIRECT/);
    expect(store.generated).toEqual([]);
  });
});
