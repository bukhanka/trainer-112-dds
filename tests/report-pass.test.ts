import { describe, expect, it, vi } from "vitest";
import { fakeModel } from "./fake-db";

// One finished lesson with the pass mark 80: one attempt passes, one is below, one is still a draft.
const lesson = {
  id: "l1",
  teacherId: "smirnova",
  title: "Занятие",
  status: "FINISHED",
  settings: { passScore: 80, maxCritical: 0 },
  startedAt: new Date("2026-09-25T07:00:00Z"),
  createdAt: new Date("2026-09-25T06:00:00Z"),
};
const seats = [{ id: "s1", lessonId: "l1", label: "Место 1", role: "DDS", studentId: "u1", student: { fullName: "Иванов А. С." }, service: { shortName: "Поселение Вороновское" }, createdAt: new Date() }];
const check = (ok: boolean) => [{ code: "ack", group: "timeliness", title: "Ответ за 30 с", ok, source: "rule" }];
const base = { lessonId: "l1", seatId: "s1", studentId: "u1", kind: "DDS", override: null, teacherComment: null, scenario: { title: "Прорыв трубы" }, incident: null, incidentService: null };
const attempts = [
  { ...base, id: "a1", reviewStatus: "CONFIRMED", score: 90, criteria: check(true), createdAt: new Date("2026-09-25T07:10:00Z") },
  { ...base, id: "a2", reviewStatus: "OVERRIDDEN", score: 75, criteria: check(false), createdAt: new Date("2026-09-25T07:20:00Z") },
  { ...base, id: "a3", reviewStatus: "PENDING", score: 95, criteria: check(true), createdAt: new Date("2026-09-25T07:30:00Z") },
];

vi.mock("@/lib/db", () => ({ db: { lesson: fakeModel([lesson]), seat: fakeModel(seats), attempt: fakeModel(attempts) } }));
vi.mock("@/lib/audit", () => ({ audit: async () => {} }));
vi.mock("@/lib/auth/session", () => ({ apiUser: async () => ({ id: "smirnova", login: "teacher", fullName: "Смирнова", role: "TEACHER" }) }));

const csv = (await import("@/app/api/teacher/lessons/[id]/report/csv/route")).GET;
const ctx = { params: Promise.resolve({ id: "l1" }) };

describe("CSV of the lesson report with the pass criteria", () => {
  it("adds «зачтено / не зачтено» and the reason to every confirmed attempt", async () => {
    const text = await (await csv(new Request("http://x/csv?kind=attempts"), ctx)).text();
    const [head, ...rows] = text.trim().split("\r\n");
    expect(head).toContain("Зачёт;Почему не зачтено");
    expect(rows).toHaveLength(2); // the draft is not exported
    expect(rows[0].endsWith(";зачтено;")).toBe(true);
    expect(rows[1].endsWith(";не зачтено;балл 75 ниже 80")).toBe(true);
  });

  it("counts passed attempts per student and names the criteria", async () => {
    const text = await (await csv(new Request("http://x/csv"), ctx)).text();
    const [head, row] = text.trim().split("\r\n");
    expect(head.endsWith("Зачтено попыток;Критерии зачёта")).toBe(true);
    expect(row.endsWith(";1;балл не ниже 80, без критичных ошибок")).toBe(true);
  });
});
