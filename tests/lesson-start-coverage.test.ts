import { beforeEach, describe, expect, it, vi } from "vitest";

// «Начать занятие» refuses a plan in which places without tasks would have nothing to draw.
const store = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  seats: [] as { studentId: string; role: "OP112" | "DDS"; scenarioIds: string[]; student: { fullName: string; isBlocked: boolean } }[],
  started: 0,
}));

const library = [
  { id: "fire", category: "пожар", status: "APPROVED", truth: { address: { street: "улица Рогова", district: "Щукино", okrug: "СЗАО" } } },
  { id: "med", category: "медицина", status: "DRAFT", truth: { address: { street: "улица Арбат", district: "Арбат", okrug: "ЦАО" } } },
];

vi.mock("@/lib/db", () => ({
  db: {
    lesson: {
      findFirst: async () => ({ id: "l1", teacherId: "t1", status: "DRAFT", settings: store.settings }),
      updateMany: async () => {
        store.started++;
        return { count: 1 };
      },
    },
    seat: { findMany: async ({ where }: { where: { lessonId?: string } }) => (where.lessonId ? store.seats : []) },
    scenario: { findMany: async () => library },
  },
}));
vi.mock("@/lib/adaptive/snapshot", () => ({ saveLessonForecasts: async () => 0 }));
vi.mock("@/lib/audit", () => ({ audit: async () => {} }));
vi.mock("@/lib/auth/session", () => ({ apiUser: async () => ({ id: "t1", login: "teacher", fullName: "Смирнова", role: "TEACHER" }) }));

const { POST } = await import("@/app/api/teacher/lessons/[id]/start/route");
const start = () => POST(new Request("http://x", { method: "POST" }), { params: Promise.resolve({ id: "l1" }) });
const place = (role: "OP112" | "DDS", scenarioIds: string[] = []) => ({ studentId: `${role}-${scenarioIds.length}`, role, scenarioIds, student: { fullName: "Иванов", isBlocked: false } });

beforeEach(() => {
  store.started = 0;
  store.seats = [place("DDS")];
});

describe("start of a lesson and the scenarios it can deal", () => {
  it("does not start when the chosen category has no approved scenario", async () => {
    store.settings = { categories: ["медицина"] };
    const res = await start();
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toMatch(/категории «медицина» нет утверждённых сценариев.*«Сценарии»/);
    expect(store.started).toBe(0);
  });

  it("does not start when the location leaves nothing", async () => {
    store.settings = { categories: ["пожар"], location: { okrug: "ЦАО", district: null } };
    expect((await start()).status).toBe(409);
    expect(store.started).toBe(0);
  });

  it("starts when something is left, or when every place has its tasks", async () => {
    store.settings = { categories: ["пожар", "медицина"], location: { okrug: "СЗАО", district: "Щукино" } };
    expect((await start()).status).toBe(200);
    store.settings = { categories: ["медицина"] };
    store.seats = [place("DDS", ["fire"])];
    const res = await start();
    expect(res.status).toBe(200);
    expect(store.started).toBe(2);
  });
});
