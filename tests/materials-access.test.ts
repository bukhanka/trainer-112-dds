import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { EXE, makeDocx, makePdf, para, PNG, table } from "./office-files";

// The library lives in a folder of its own for the test: set before the modules that read MATERIALS_DIR load.
const DIR = mkdtempSync(path.join(tmpdir(), "materials-access-"));
process.env.MATERIALS_DIR = DIR;
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

// Two teachers with a lesson each (Смирнова also has a practice lesson of a student), an administrator and students:
// Иванов — group and place of Смирнова's lesson; Петрова — Орлов's group; Козлов — a place in Орлов's lesson without
// the group; Сидоров — nothing.
type Row = Record<string, unknown>;
type User = { id: string; login: string; fullName: string; role: "ADMIN" | "TEACHER" | "STUDENT" };
const U: Record<string, User> = {
  smirnova: { id: "smirnova", login: "teacher", fullName: "Смирнова Ольга Петровна", role: "TEACHER" },
  orlov: { id: "orlov", login: "orlov", fullName: "Орлов Игорь Сергеевич", role: "TEACHER" },
  admin: { id: "admin", login: "admin", fullName: "Администратор", role: "ADMIN" },
  ivanov: { id: "ivanov", login: "student1", fullName: "Иванов Алексей", role: "STUDENT" },
  petrova: { id: "petrova", login: "student2", fullName: "Петрова Мария", role: "STUDENT" },
  kozlov: { id: "kozlov", login: "kozlov", fullName: "Козлов Пётр", role: "STUDENT" },
  sidorov: { id: "sidorov", login: "sidorov", fullName: "Сидоров Илья", role: "STUDENT" },
};

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const FILES: Record<string, { stored: string; bytes: Uint8Array; kind: string; mime: string; fileName: string }> = {
  "m-all": { stored: `${uuid(1)}.pdf`, bytes: makePdf("Memo"), kind: "pdf", mime: "application/pdf", fileName: "Памятка ДДС.pdf" },
  "m-smirnova-lesson": { stored: `${uuid(2)}.txt`, bytes: new TextEncoder().encode("Порядок статусов"), kind: "txt", mime: "text/plain; charset=utf-8", fileName: "Статусы.txt" },
  "m-orlov-lesson": { stored: `${uuid(3)}.docx`, bytes: makeDocx(para("Газ")), kind: "docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", fileName: "Газ.docx" },
  "m-staff": { stored: `${uuid(4)}.pdf`, bytes: makePdf("Answers"), kind: "pdf", mime: "application/pdf", fileName: "Эталоны.pdf" },
  "m-gone": { stored: `${uuid(5)}.png`, bytes: PNG, kind: "png", mime: "image/png", fileName: "Схема.png" },
  "m-demo": { stored: `${uuid(6)}.pdf`, bytes: makePdf("Demo"), kind: "pdf", mime: "application/pdf", fileName: "Демо.pdf" },
};

function makeData() {
  const material = (id: string, audience: string, ownerId: string, lessonId: string | null, extra: Row = {}): Row => ({
    id,
    title: id,
    fileName: FILES[id]?.fileName ?? "x.pdf",
    storedName: FILES[id]?.stored ?? "x",
    kind: FILES[id]?.kind ?? "pdf",
    mime: FILES[id]?.mime ?? "application/pdf",
    sizeBytes: FILES[id]?.bytes.length ?? 10,
    sha256: "0",
    audience,
    lessonId,
    ownerId,
    ownerName: U[ownerId].fullName,
    source: "upload",
    createdAt: new Date(`2026-09-2${Object.keys(FILES).indexOf(id) + 1}T10:00:00Z`),
    ...extra,
  });
  return {
    lessons: [
      { id: "l-smirnova", title: "Пожары", teacherId: "smirnova", groupId: "g-smirnova", status: "DRAFT", settings: {}, createdAt: new Date(), group: { name: "Группа Смирновой" } },
      { id: "l-orlov", title: "Газ", teacherId: "orlov", groupId: "g-orlov", status: "FINISHED", settings: {}, createdAt: new Date(), group: { name: "Группа Орлова" } },
      { id: "l-practice", title: "Тренировка", teacherId: "smirnova", groupId: null, status: "RUNNING", settings: { practice: true }, createdAt: new Date(), group: null },
    ] as Row[],
    seats: [
      { lessonId: "l-smirnova", studentId: "ivanov" },
      { lessonId: "l-orlov", studentId: "kozlov" },
      { lessonId: "l-practice", studentId: "ivanov" },
    ] as Row[],
    members: [
      { groupId: "g-smirnova", userId: "ivanov" },
      { groupId: "g-orlov", userId: "petrova" },
    ] as Row[],
    materials: [
      material("m-all", "all", "smirnova", null),
      material("m-smirnova-lesson", "lesson", "smirnova", "l-smirnova"),
      material("m-orlov-lesson", "lesson", "orlov", "l-orlov"),
      material("m-staff", "staff", "orlov", null),
      material("m-gone", "lesson", "smirnova", "deleted-lesson"),
      material("m-demo", "all", "smirnova", null, { source: "demo" }),
      // A row with a tampered stored name: the server must not follow it out of the folder.
      material("m-evil", "all", "orlov", null, { storedName: "../../../../etc/passwd", fileName: "passwd.txt", kind: "txt", mime: "text/plain" }),
    ] as Row[],
    audit: [] as Row[],
  };
}
let data = makeData();

/** Prisma-like `where`: equality, null, { in }, { not }, AND, OR, NOT. */
function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, cond]) => {
    if (key === "AND") return (cond as Row[]).every((w) => matches(row, w));
    if (key === "OR") return (cond as Row[]).some((w) => matches(row, w));
    if (key === "NOT") return !matches(row, cond as Row);
    const value = row[key];
    if (cond === null) return value == null;
    if (typeof cond === "object" && !(cond instanceof Date)) {
      const c = cond as Row;
      if ("in" in c) return (c.in as unknown[]).includes(value);
      if ("not" in c) return value !== c.not;
      return false;
    }
    return value === cond;
  });
}

function model(rows: () => Row[]) {
  const sorted = (list: Row[], orderBy?: Row) =>
    orderBy?.createdAt === "desc" ? [...list].sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime()) : list;
  return {
    findMany: async ({ where, orderBy }: { where?: Row; orderBy?: Row } = {}) => sorted(rows().filter((r) => matches(r, where)), orderBy),
    findFirst: async ({ where }: { where?: Row } = {}) => rows().find((r) => matches(r, where)) ?? null,
    findUnique: async ({ where }: { where?: Row } = {}) => rows().find((r) => matches(r, where)) ?? null,
    create: async ({ data: d }: { data: Row }) => {
      const row = { id: `new-${rows().length + 1}`, createdAt: new Date(), source: "upload", ...d };
      rows().push(row);
      return row;
    },
    deleteMany: async ({ where }: { where?: Row } = {}) => {
      const list = rows();
      const keep = list.filter((r) => !matches(r, where));
      const count = list.length - keep.length;
      list.splice(0, list.length, ...keep);
      return { count };
    },
    aggregate: async () => ({ _sum: { sizeBytes: rows().reduce((s, r) => s + Number(r.sizeBytes ?? 0), 0) } }),
  };
}

vi.mock("@/lib/db", () => ({
  db: {
    material: model(() => data.materials),
    lesson: model(() => data.lessons),
    seat: model(() => data.seats),
    groupMember: model(() => data.members),
    auditLog: model(() => data.audit),
  },
}));
const session = vi.hoisted(() => ({ user: null as null | { id: string; login: string; fullName: string; role: "ADMIN" | "TEACHER" | "STUDENT" } }));
vi.mock("@/lib/auth/session", () => ({
  apiUser: async (roles?: string[]) => {
    if (!session.user) return Response.json({ error: "unauthorized" }, { status: 401 });
    if (roles && !roles.includes(session.user.role)) return Response.json({ error: "forbidden" }, { status: 403 });
    return session.user;
  },
}));

const list = await import("@/app/api/materials/route");
const one = await import("@/app/api/materials/[id]/route");
const tickets = await import("@/app/api/teacher/scenarios/from-file/route");
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const as = (who: keyof typeof U | null) => (session.user = who ? U[who] : null);

async function ids(): Promise<string[]> {
  const res = await list.GET();
  expect(res.status).toBe(200);
  return ((await res.json()).materials as { id: string }[]).map((m) => m.id).sort();
}
const get = (id: string, query = "") => one.GET(new Request(`http://x/api/materials/${id}${query}`), ctx(id));
const del = (id: string) => one.DELETE(new Request(`http://x/api/materials/${id}`, { method: "DELETE" }), ctx(id));

function upload(file: { name: string; bytes: Uint8Array } | null, fields: Record<string, string> = {}, headers: Record<string, string> = {}) {
  const form = new FormData();
  if (file) form.append("file", new File([Buffer.from(file.bytes)], file.name));
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return list.POST(new Request("http://x/api/materials", { method: "POST", body: form, headers }));
}
const onDisk = () => readdirSync(DIR).sort();

beforeEach(() => {
  data = makeData();
  rmSync(DIR, { recursive: true, force: true });
  mkdirSync(DIR, { recursive: true });
  for (const f of Object.values(FILES)) writeFileSync(path.join(DIR, f.stored), f.bytes);
  delete process.env.MATERIALS_MAX_TOTAL_MB;
  delete process.env.DEMO_MODE;
});

describe("materials: who sees what", () => {
  it("a student sees the materials for everybody and those of own lessons — by place or by group — nothing else", async () => {
    as("ivanov");
    expect(await ids()).toEqual(["m-all", "m-demo", "m-evil", "m-smirnova-lesson"]);
    as("petrova");
    expect(await ids()).toEqual(["m-all", "m-demo", "m-evil", "m-orlov-lesson"]);
    as("kozlov");
    expect(await ids()).toEqual(["m-all", "m-demo", "m-evil", "m-orlov-lesson"]);
    as("sidorov");
    expect(await ids()).toEqual(["m-all", "m-demo", "m-evil"]);
  });

  it("a teacher sees own lessons' materials, the shared and the staff ones, never another teacher's lesson", async () => {
    as("smirnova");
    expect(await ids()).toEqual(["m-all", "m-demo", "m-evil", "m-gone", "m-smirnova-lesson", "m-staff"]);
    as("orlov");
    expect(await ids()).toEqual(["m-all", "m-demo", "m-evil", "m-orlov-lesson", "m-staff"]);
    as("admin");
    expect(await ids()).toEqual(["m-all", "m-demo", "m-evil", "m-gone", "m-orlov-lesson", "m-smirnova-lesson", "m-staff"]);
  });

  it("a material the user may not see answers 404, exactly like a missing one", async () => {
    as("ivanov");
    const missing = await get("no-such");
    expect(missing.status).toBe(404);
    const missingBody = await missing.json();
    for (const id of ["m-orlov-lesson", "m-staff", "m-gone"]) {
      const res = await get(id);
      expect(res.status, id).toBe(404);
      expect(await res.json()).toEqual(missingBody);
    }
    as("smirnova");
    expect((await get("m-orlov-lesson")).status).toBe(404);
  });

  it("an anonymous visitor gets 401 from every material route and from the ticket reader", async () => {
    as(null);
    expect((await list.GET()).status).toBe(401);
    expect((await get("m-all")).status).toBe(401);
    expect((await upload({ name: "a.pdf", bytes: makePdf("x") })).status).toBe(401);
    expect((await del("m-all")).status).toBe(401);
    const form = new FormData();
    form.append("file", new File([Buffer.from(makeDocx(para("Горит дом")))], "b.docx"));
    expect((await tickets.POST(new Request("http://x", { method: "POST", body: form }))).status).toBe(401);
    expect(onDisk()).toHaveLength(Object.keys(FILES).length);
  });
});

describe("materials: the file", () => {
  it("comes with its own type, the Russian name, no sniffing and no caching on a shared computer", async () => {
    as("ivanov");
    const res = await get("m-all");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toBe(`inline; filename="_______ ___.pdf"; filename*=UTF-8''${encodeURIComponent("Памятка ДДС.pdf")}`);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(Buffer.from(await res.arrayBuffer()).equals(Buffer.from(FILES["m-all"].bytes))).toBe(true);

    const text = await get("m-smirnova-lesson");
    expect(text.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(text.headers.get("content-security-policy")).toMatch(/sandbox/);
    expect(await text.text()).toBe("Порядок статусов");
    expect((await get("m-smirnova-lesson", "?download=1")).headers.get("content-disposition")).toMatch(/^attachment;/);
  });

  it("an Office file is always downloaded, never shown", async () => {
    as("petrova");
    expect((await get("m-orlov-lesson")).headers.get("content-disposition")).toMatch(/^attachment;/);
  });

  it("a tampered stored name never leads out of the folder", async () => {
    as("ivanov");
    const res = await get("m-evil");
    expect(res.status).toBe(404);
    expect(await res.text()).not.toMatch(/root:/);
  });
});

describe("materials: upload", () => {
  it("a teacher uploads to own lesson: the file under a new name, the row, the journal; the lesson's students see it", async () => {
    as("smirnova");
    const res = await upload({ name: "C:\\fakepath\\Памятка_ДДС.pdf", bytes: makePdf("Memo 2") }, { title: "  Памятка   ДДС  ", audience: "lesson", lessonId: "l-smirnova" });
    expect(res.status).toBe(201);
    const { id } = await res.json();
    const row = data.materials.find((m) => m.id === id)!;
    expect(row).toMatchObject({ title: "Памятка ДДС", fileName: "Памятка_ДДС.pdf", kind: "pdf", audience: "lesson", lessonId: "l-smirnova", ownerId: "smirnova" });
    expect(row.storedName).toMatch(/^[0-9a-f-]{36}\.pdf$/);
    expect(onDisk()).toContain(row.storedName);
    expect(data.audit).toEqual([
      expect.objectContaining({
        action: "material.upload",
        entity: "Material",
        entityId: id,
        actor: "teacher",
        after: { title: "Памятка ДДС", file: "Памятка_ДДС.pdf", type: "PDF", size: expect.stringMatching(/Б$/), access: "ученикам занятия", lesson: "Пожары" },
      }),
    ]);
    as("ivanov");
    expect(await ids()).toContain(id);
    as("petrova");
    expect(await ids()).not.toContain(id);
  });

  it.each([
    ["setup.exe", EXE, /\.exe не принимаются/],
    ["page.html", new TextEncoder().encode("<html><script>alert(1)</script></html>"), /\.html не принимаются/],
    ["drawing.svg", new TextEncoder().encode("<svg onload=alert(1)/>"), /\.svg не принимаются/],
    ["program.pdf", EXE, /не совпадает с расширением/],
    ["page.txt", new TextEncoder().encode("<!DOCTYPE html><html><script>alert(1)</script>"), /веб-страницу/],
    ["macro.docx", makeDocx(para("x"), { "word/vbaProject.bin": "VBA" }), /макрос/],
  ])("refuses %s and writes nothing", async (name, bytes, reason) => {
    as("smirnova");
    const before = onDisk();
    const res = await upload({ name, bytes }, { audience: "all" });
    expect(res.status).toBe(415);
    expect((await res.json()).error).toMatch(reason);
    expect(onDisk()).toEqual(before);
    expect(data.audit).toEqual([]);
  });

  it("refuses another teacher's lesson, a practice lesson and an unknown audience", async () => {
    as("smirnova");
    expect((await upload({ name: "a.pdf", bytes: makePdf("x") }, { audience: "lesson", lessonId: "l-orlov" })).status).toBe(404);
    expect((await upload({ name: "a.pdf", bytes: makePdf("x") }, { audience: "lesson", lessonId: "l-practice" })).status).toBe(404);
    expect((await upload({ name: "a.pdf", bytes: makePdf("x") }, { audience: "lesson" })).status).toBe(400);
    expect((await upload({ name: "a.pdf", bytes: makePdf("x") }, { audience: "everyone" })).status).toBe(400);
    expect((await upload(null, { audience: "all" })).status).toBe(400);
    as("admin");
    expect((await upload({ name: "a.pdf", bytes: makePdf("x") }, { audience: "lesson", lessonId: "l-orlov" })).status).toBe(201);
  });

  it("students neither upload nor delete", async () => {
    as("ivanov");
    expect((await upload({ name: "a.pdf", bytes: makePdf("x") }, { audience: "all" })).status).toBe(403);
    expect((await del("m-all")).status).toBe(403);
    expect(data.materials).toHaveLength(7);
  });

  it("stops a file over 20 MB before reading it, and a full library", async () => {
    as("smirnova");
    const declared = await upload({ name: "a.pdf", bytes: makePdf("x") }, { audience: "all" }, { "content-length": String(30 * 1024 * 1024) });
    expect(declared.status).toBe(413);
    const big = new Uint8Array(20 * 1024 * 1024 + 1);
    big.set(new TextEncoder().encode("%PDF-1.4"));
    expect((await upload({ name: "big.pdf", bytes: big }, { audience: "all" })).status).toBe(413);
    // The cap is exactly what the fixtures already take: one byte more does not fit.
    const taken = data.materials.reduce((sum, m) => sum + Number(m.sizeBytes), 0);
    process.env.MATERIALS_MAX_TOTAL_MB = String(taken / 1024 / 1024);
    const full = await upload({ name: "a.pdf", bytes: makePdf("x") }, { audience: "all" });
    expect(full.status).toBe(413);
    expect((await full.json()).error).toMatch(/Библиотека заполнена/);
    expect(onDisk()).toHaveLength(Object.keys(FILES).length);
  });
});

describe("materials: delete", () => {
  it("only the uploader or an administrator deletes; the file goes and the journal keeps what it was", async () => {
    as("smirnova");
    expect((await del("m-staff")).status).toBe(403); // Орлов's
    expect((await del("m-orlov-lesson")).status).toBe(404); // not even visible
    as("orlov");
    expect((await del("m-staff")).status).toBe(200);
    expect(onDisk()).not.toContain(FILES["m-staff"].stored);
    expect(data.audit.at(-1)).toMatchObject({ action: "material.delete", entityId: "m-staff", actor: "orlov", before: { title: "m-staff", file: "Эталоны.pdf", access: "только преподавателям" } });
    expect((await del("m-staff")).status).toBe(404);
    as("admin");
    expect((await del("m-gone")).status).toBe(200);
    expect(data.materials.map((m) => m.id)).not.toContain("m-gone");
  });

  it("keeps the demo stand's own materials on the demo stand", async () => {
    process.env.DEMO_MODE = "true";
    as("admin");
    expect((await del("m-demo")).status).toBe(409);
    expect(onDisk()).toContain(FILES["m-demo"].stored);
  });
});

describe("«Сценарий из билета»: reading the file", () => {
  const send = (name: string, bytes: Uint8Array) => {
    const form = new FormData();
    form.append("file", new File([Buffer.from(bytes)], name));
    return tickets.POST(new Request("http://x/api/teacher/scenarios/from-file", { method: "POST", body: form }));
  };

  it("gives a teacher the situations of a Word ticket and stores nothing", async () => {
    as("smirnova");
    const docx = makeDocx(`${para("БИЛЕТ 5")}${table([["№", "Ситуация", "Адрес"], ["1", "Горит мусор", "ул. Грина, 11"], ["2", "Пахнет газом", "ул. Вавилова, 81"]])}`);
    const res = await send("Билет 5.docx", docx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ fileName: "Билет 5.docx", tickets: 1, kind: "docx" });
    expect(body.fragments.map((f: { label: string; text: string }) => `${f.label}: ${f.text}`)).toEqual([
      "Билет 5, ситуация 1: Горит мусор. Адрес: ул. Грина, 11",
      "Билет 5, ситуация 2: Пахнет газом. Адрес: ул. Вавилова, 81",
    ]);
    expect(onDisk()).toHaveLength(Object.keys(FILES).length);
  });

  it("refuses students and files it cannot read", async () => {
    as("ivanov");
    expect((await send("b.docx", makeDocx(para("x")))).status).toBe(403);
    as("smirnova");
    const exe = await send("setup.exe", EXE);
    expect(exe.status).toBe(422);
    expect((await exe.json()).error).toMatch(/DOCX, TXT или PDF/);
  });
});
