import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Two teachers with a group each; Смирнова also has an archived group. Новиков is a new student without a group.
type Row = Record<string, unknown>;
const now = new Date("2026-09-27T09:00:00Z");

function makeData() {
  const users: Row[] = [
    { id: "smirnova", login: "teacher", fullName: "Смирнова Ольга Петровна", role: "TEACHER", isBlocked: false },
    { id: "orlov", login: "orlov", fullName: "Орлов Игорь Сергеевич", role: "TEACHER", isBlocked: false },
    { id: "admin", login: "admin", fullName: "Администратор", role: "ADMIN", isBlocked: false },
    { id: "ivanov", login: "student1", fullName: "Иванов Алексей Сергеевич", role: "STUDENT", isBlocked: false },
    { id: "petrova", login: "student2", fullName: "Петрова Мария Игоревна", role: "STUDENT", isBlocked: false },
    { id: "sidorov", login: "sidorov", fullName: "Сидоров Пётр Ильич", role: "STUDENT", isBlocked: false },
    { id: "novikov", login: "novikov", fullName: "Новиков Кирилл Андреевич", role: "STUDENT", isBlocked: false },
    { id: "blocked", login: "blocked", fullName: "Блокин Олег", role: "STUDENT", isBlocked: true },
  ];
  const groups: Row[] = [
    { id: "g-smirnova", name: "Группа Смирновой", teacherId: "smirnova", archivedAt: null },
    { id: "g-old", name: "Весенний курс", teacherId: "smirnova", archivedAt: new Date("2026-06-01T00:00:00Z") },
    { id: "g-orlov", name: "Группа Орлова", teacherId: "orlov", archivedAt: null },
    { id: "g-demo", name: "Учебная группа № 1", teacherId: "smirnova", archivedAt: null },
  ];
  const members: Row[] = [
    { groupId: "g-smirnova", userId: "ivanov" },
    { groupId: "g-smirnova", userId: "petrova" },
    { groupId: "g-orlov", userId: "sidorov" },
    { groupId: "g-demo", userId: "ivanov" },
  ];
  const lessons: Row[] = [
    { id: "l-draft", groupId: "g-smirnova", status: "DRAFT" },
    { id: "l-running", groupId: "g-smirnova", status: "RUNNING" },
  ];
  const seats: Row[] = [
    { id: "s-draft", lessonId: "l-draft", studentId: "petrova" },
    { id: "s-running", lessonId: "l-running", studentId: "petrova" },
  ];
  // Relations resolve against the current tables, as a join would.
  for (const u of users) {
    Object.defineProperty(u, "memberships", { get: () => members.filter((m) => m.userId === u.id), enumerable: false });
  }
  for (const m of members) linkMember(m);
  function linkMember(m: Row) {
    Object.defineProperty(m, "group", { get: () => groups.find((g) => g.id === m.groupId), enumerable: false });
    Object.defineProperty(m, "user", { get: () => users.find((u) => u.id === m.userId), enumerable: false });
  }
  for (const s of seats) Object.defineProperty(s, "lesson", { get: () => lessons.find((l) => l.id === s.lessonId), enumerable: false });
  return { users, groups, members, lessons, seats, linkMember };
}

let data = makeData();

/** Prisma-like `where`: equality, null, in, not, equals / contains (case-insensitive), OR, nested relations. */
function matches(row: Row | undefined, where: Row | undefined): boolean {
  if (!where) return true;
  if (!row) return false;
  return Object.entries(where).every(([key, cond]) => {
    if (key === "OR") return (cond as Row[]).some((w) => matches(row, w));
    const value = row[key];
    if (cond === null) return value == null;
    if (cond instanceof Date || typeof cond !== "object") return value === cond;
    const c = cond as Row;
    const fold = (v: unknown) => (c.mode === "insensitive" && typeof v === "string" ? v.toLowerCase() : v);
    if ("in" in c) return (c.in as unknown[]).includes(value);
    if ("not" in c) return c.not === null ? value != null : value !== c.not;
    if ("equals" in c) return fold(value) === fold(c.equals);
    if ("contains" in c) return typeof value === "string" && (fold(value) as string).includes(fold(c.contains) as string);
    return matches(value as Row, c);
  });
}

function model(rows: () => Row[], opts: { create?: (d: Row) => Row; copy?: boolean } = {}) {
  // Plain rows come back as copies, like fresh query results; rows with relations keep their getters.
  const out = (r: Row) => (opts.copy ? { ...r } : r);
  return {
    findFirst: async ({ where }: { where?: Row } = {}) => {
      const hit = rows().find((r) => matches(r, where));
      return hit ? out(hit) : null;
    },
    findMany: async ({ where }: { where?: Row } = {}) => rows().filter((r) => matches(r, where)).map(out),
    count: async ({ where }: { where?: Row } = {}) => rows().filter((r) => matches(r, where)).length,
    create: async ({ data: d }: { data: Row }) => {
      const row = opts.create ? opts.create(d) : { ...d };
      rows().push(row);
      return row;
    },
    updateMany: async ({ where, data: d }: { where?: Row; data: Row }) => {
      const hit = rows().filter((r) => matches(r, where));
      for (const r of hit) Object.assign(r, d);
      return { count: hit.length };
    },
    deleteMany: async ({ where }: { where?: Row } = {}) => {
      const list = rows();
      const keep = list.filter((r) => !matches(r, where));
      const count = list.length - keep.length;
      list.splice(0, list.length, ...keep);
      return { count };
    },
  };
}

let seq = 0;
const db: Record<string, unknown> = {
  user: model(() => data.users),
  group: model(() => data.groups, { copy: true, create: (d) => ({ id: `g-new-${++seq}`, archivedAt: null, createdAt: now, ...d }) }),
  groupMember: {
    ...model(() => data.members),
    upsert: async ({ create }: { create: Row }) => {
      if (!data.members.some((m) => m.groupId === create.groupId && m.userId === create.userId)) {
        const row = { ...create };
        data.linkMember(row);
        data.members.push(row);
      }
      return create;
    },
  },
  seat: model(() => data.seats),
};
db.$transaction = async (fn: (tx: unknown) => unknown) => fn(db);

const session = vi.hoisted(() => ({ user: null as null | { id: string; login: string; fullName: string; role: "STUDENT" | "TEACHER" | "ADMIN" } }));
const audits = vi.hoisted(() => [] as { action: string }[]);

vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/audit", () => ({ audit: async (a: { action: string }) => void audits.push(a) }));
vi.mock("@/lib/auth/session", () => ({
  apiUser: async (roles?: string[]) => {
    if (!session.user) return Response.json({ error: "unauthorized" }, { status: 401 });
    if (roles && !roles.includes(session.user.role)) return Response.json({ error: "forbidden" }, { status: 403 });
    return session.user;
  },
}));

const createGroup = (await import("@/app/api/teacher/groups/route")).POST;
const patchGroup = (await import("@/app/api/teacher/groups/[id]/route")).PATCH;
const addMember = (await import("@/app/api/teacher/groups/[id]/members/route")).POST;
const removeMember = (await import("@/app/api/teacher/groups/[id]/members/[userId]/route")).DELETE;
const students = (await import("@/app/api/teacher/students/route")).GET;

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const memberCtx = (id: string, userId: string) => ({ params: Promise.resolve({ id, userId }) });
const json = (method: string, body?: unknown) => new Request("http://x", { method, body: body === undefined ? undefined : JSON.stringify(body) });
const search = (query: string) => students(new NextRequest(`http://x/api/teacher/students?${query}`));

const teacher = { id: "smirnova", login: "teacher", fullName: "Смирнова", role: "TEACHER" as const };

describe("groups: a teacher works only with own groups", () => {
  beforeEach(() => {
    data = makeData();
    audits.length = 0;
    session.user = teacher;
  });
  afterEach(() => vi.unstubAllEnvs());

  it("answers «не найдено» for another teacher's group, the same as for a missing one", async () => {
    const foreign = await patchGroup(json("PATCH", { name: "Моя теперь" }), ctx("g-orlov"));
    const missing = await patchGroup(json("PATCH", { name: "Моя теперь" }), ctx("no-such"));
    expect(foreign.status).toBe(404);
    expect(await foreign.json()).toEqual(await missing.json());
    expect((await patchGroup(json("PATCH", { archived: true }), ctx("g-orlov"))).status).toBe(404);
    expect((await addMember(json("POST", { userId: "novikov" }), ctx("g-orlov"))).status).toBe(404);
    expect((await removeMember(json("DELETE"), memberCtx("g-orlov", "sidorov"))).status).toBe(404);
    expect((await search("groupId=g-orlov")).status).toBe(404);
    expect(data.groups.find((g) => g.id === "g-orlov")).toMatchObject({ name: "Группа Орлова", archivedAt: null });
    expect(data.members.filter((m) => m.groupId === "g-orlov")).toHaveLength(1);
    expect(audits).toHaveLength(0);
  });

  it("creates a group that belongs to the teacher, whatever teacher the request names", async () => {
    const res = await createGroup(json("POST", { name: "  Группа   № 2 ", teacherId: "orlov" }));
    expect(res.status).toBe(201);
    const { id } = await res.json();
    expect(data.groups.find((g) => g.id === id)).toMatchObject({ name: "Группа № 2", teacherId: "smirnova" });
    expect(audits.map((a) => a.action)).toEqual(["group.create"]);
    expect((await createGroup(json("POST", { name: "группа № 2" }))).status).toBe(409);
    expect((await createGroup(json("POST", { name: "Я" }))).status).toBe(400);
  });

  it("lets only the administrator hand a group to another teacher", async () => {
    expect((await patchGroup(json("PATCH", { teacherId: "orlov" }), ctx("g-smirnova"))).status).toBe(403);
    session.user = { id: "admin", login: "admin", fullName: "Администратор", role: "ADMIN" };
    expect((await patchGroup(json("PATCH", { teacherId: "ivanov" }), ctx("g-smirnova"))).status).toBe(404);
    expect((await patchGroup(json("PATCH", { teacherId: "orlov", name: "Группа № 1, осень" }), ctx("g-smirnova"))).status).toBe(200);
    expect(data.groups.find((g) => g.id === "g-smirnova")).toMatchObject({ teacherId: "orlov", name: "Группа № 1, осень" });
    expect(audits.map((a) => a.action)).toEqual(["group.update"]);
  });

  it("adds only active student accounts, once", async () => {
    expect((await addMember(json("POST", { userId: "orlov" }), ctx("g-smirnova"))).status).toBe(404);
    expect((await addMember(json("POST", { userId: "admin" }), ctx("g-smirnova"))).status).toBe(404);
    expect((await addMember(json("POST", { userId: "blocked" }), ctx("g-smirnova"))).status).toBe(409);
    const first = await addMember(json("POST", { userId: "novikov" }), ctx("g-smirnova"));
    expect(await first.json()).toEqual({ ok: true, added: true });
    const again = await addMember(json("POST", { userId: "novikov" }), ctx("g-smirnova"));
    expect(await again.json()).toEqual({ ok: true, added: false });
    expect(data.members.filter((m) => m.userId === "novikov")).toEqual([{ groupId: "g-smirnova", userId: "novikov" }]);
    expect(audits.map((a) => a.action)).toEqual(["group.member.add"]);
  });

  it("removes a student from the group and its draft lessons, keeping the running lesson and the results", async () => {
    const res = await removeMember(json("DELETE"), memberCtx("g-smirnova", "petrova"));
    expect(await res.json()).toEqual({ ok: true, seatsRemoved: 1 });
    expect(data.members.some((m) => m.groupId === "g-smirnova" && m.userId === "petrova")).toBe(false);
    expect(data.seats.map((s) => s.id)).toEqual(["s-running"]);
    expect((await removeMember(json("DELETE"), memberCtx("g-smirnova", "petrova"))).status).toBe(404);
  });

  it("freezes the members of an archived group until it is restored", async () => {
    expect((await addMember(json("POST", { userId: "novikov" }), ctx("g-old"))).status).toBe(409);
    expect((await patchGroup(json("PATCH", { archived: false }), ctx("g-old"))).status).toBe(200);
    expect(audits.map((a) => a.action)).toEqual(["group.restore"]);
    expect((await addMember(json("POST", { userId: "novikov" }), ctx("g-old"))).status).toBe(200);
  });

  it("offers students without another teacher's group names, those without a group first", async () => {
    const res = await search("groupId=g-smirnova");
    expect(res.status).toBe(200);
    const list = (await res.json()).students as { id: string; noGroup: boolean; groups: string[] }[];
    expect(list.map((s) => s.id)).toEqual(["novikov", "sidorov"]); // members, teachers, admins and blocked are left out
    expect(list[0]).toMatchObject({ noGroup: true, groups: [] });
    expect(list[1]).toMatchObject({ noGroup: false, groups: [] });
    expect(JSON.stringify(list)).not.toContain("Орлова");
    const found = (await (await search("q=%D0%A1%D0%98%D0%94")).json()).students as { id: string }[]; // «СИД»
    expect(found.map((s) => s.id)).toEqual(["sidorov"]);
  });

  it("keeps the demo group of the stand intact", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    expect((await patchGroup(json("PATCH", { name: "Другая" }), ctx("g-demo"))).status).toBe(403);
    expect((await patchGroup(json("PATCH", { archived: true }), ctx("g-demo"))).status).toBe(403);
    expect((await removeMember(json("DELETE"), memberCtx("g-demo", "ivanov"))).status).toBe(403);
    expect((await addMember(json("POST", { userId: "novikov" }), ctx("g-demo"))).status).toBe(200);
  });

  it("closes the group API to students and anonymous users", async () => {
    session.user = { id: "ivanov", login: "student1", fullName: "Иванов", role: "STUDENT" };
    expect((await createGroup(json("POST", { name: "Своя" }))).status).toBe(403);
    expect((await patchGroup(json("PATCH", { name: "Своя" }), ctx("g-smirnova"))).status).toBe(403);
    expect((await addMember(json("POST", { userId: "ivanov" }), ctx("g-smirnova"))).status).toBe(403);
    expect((await search("")).status).toBe(403);
    session.user = null;
    expect((await createGroup(json("POST", { name: "Своя" }))).status).toBe(401);
    expect((await removeMember(json("DELETE"), memberCtx("g-smirnova", "ivanov"))).status).toBe(401);
    expect((await search("")).status).toBe(401);
  });
});
