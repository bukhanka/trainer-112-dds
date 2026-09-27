/**
 * Screenshots of the main screens for the documentation and the presentation (docs/img/*.png).
 * Prepares a live lesson through the API: a ДДС place with a fast card flow and a 112 place with an
 * answered call, then photographs every role at 1600×900.
 *
 *   pnpm exec tsx scripts/screenshots.ts --base http://localhost:3100
 *
 * Uses the installed Google Chrome (or CHROME_PATH). The lesson is deleted at the end.
 */
import { PrismaClient } from "@prisma/client";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";

const args = process.argv.slice(2);
const BASE = args.includes("--base") ? args[args.indexOf("--base") + 1] : "http://localhost:3100";
const OUT = "docs/img";
const db = new PrismaClient();
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function signedIn(browser: Browser, login: string, password: string): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, locale: "ru-RU", timezoneId: "Europe/Moscow" });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  const res = await page.request.post(`${BASE}/api/auth/login`, { data: { login, password } });
  if (!res.ok()) throw new Error(`login ${login}: ${res.status()}`);
  return { ctx, page };
}

async function shot(page: Page, name: string, path: string, settle = 1500) {
  await page.goto(`${BASE}${path}`);
  await wait(settle);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`✓ ${name}.png  ${path}`);
}

/** Scrolls so that the section with this heading sits at the top of the frame. */
async function shotSection(page: Page, name: string, path: string, heading: string, settle = 1500) {
  await page.goto(`${BASE}${path}`);
  await wait(settle);
  const box = await page.getByText(heading, { exact: true }).first().boundingBox();
  if (box) await page.evaluate((y) => window.scrollTo(0, y), Math.max(0, box.y - 90));
  await wait(400);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`✓ ${name}.png  ${path} → ${heading}`);
}

async function main() {
  const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chrome" });
  const group = await db.group.findFirstOrThrow({ where: { name: "Учебная группа № 1" } });
  const [s1, s2] = await Promise.all(["student1", "student2"].map((login) => db.user.findUniqueOrThrow({ where: { login } })));
  const scenario = await db.scenario.findFirstOrThrow({ where: { ticketRef: "Б4-1" } });
  const voron = await db.service.findFirstOrThrow({ where: { shortName: "Поселение Вороновское" } });

  const teacher = await signedIn(browser, "teacher", "Teacher2026");
  const created = await teacher.page.request.post(`${BASE}/api/teacher/lessons`, {
    data: {
      title: "Пожары и газ: смена в реальном темпе",
      groupId: group.id,
      settings: { cardSource: "mixed", tempoSec: 10, maxQueue: 3, ackSec: 30, workSec: 180, typingSec: 65, hints: false, brigadeReports: true },
      seats: [
        { studentId: s1.id, role: "OP112", scenarioIds: [scenario.id] },
        { studentId: s2.id, role: "DDS", serviceId: voron.id },
      ],
    },
  });
  const lessonId = ((await created.json()) as { id: string }).id;
  try {
    await teacher.page.request.post(`${BASE}/api/teacher/lessons/${lessonId}/start`);
    const anon = await browser.newContext({ viewport: { width: 1600, height: 900 }, locale: "ru-RU", timezoneId: "Europe/Moscow" });
    await shot(await anon.newPage(), "00-login", "/login", 800); // signed out: a signed-in page would redirect

    // ДДС: let the feed fill up, then open a card and its status line.
    const dds = await signedIn(browser, "student2", "Student2026");
    await dds.page.goto(`${BASE}/dds`);
    await wait(26_000);
    await dds.page.screenshot({ path: `${OUT}/01-dds-feed.png` });
    console.log("✓ 01-dds-feed.png");
    const firstNumber = await dds.page.locator("text=/^368\\d{5}$/").first().textContent();
    if (firstNumber) {
      await dds.page.goto(`${BASE}/dds/incident/${firstNumber.trim()}`);
      await wait(2000);
      await dds.page.screenshot({ path: `${OUT}/02-dds-card.png` });
      console.log("✓ 02-dds-card.png");
      await dds.page.getByLabel("Поставить статус своей службы").click();
      await wait(800);
      await dds.page.screenshot({ path: `${OUT}/03-dds-status.png` });
      console.log("✓ 03-dds-status.png");
    }

    // 112: take the call and ask two questions through the screen's own API.
    const op = await signedIn(browser, "student1", "Student2026");
    await op.page.goto(`${BASE}/op112`);
    await wait(2500);
    await op.page.screenshot({ path: `${OUT}/04-op112-incoming.png` });
    console.log("✓ 04-op112-incoming.png");
    const ring = (await (await op.page.request.post(`${BASE}/api/op112/ring`)).json()) as { call?: { id: string } };
    if (ring.call) {
      await op.page.request.post(`${BASE}/api/op112/calls/${ring.call.id}/answer`);
      for (const text of ["Служба 112, что у вас случилось?", "Назовите точный адрес, номер дома", "Сколько этажей в доме? Газ есть?"]) {
        await op.page.request.post(`${BASE}/api/op112/calls/${ring.call.id}/messages`, { data: { text } });
      }
      await op.page.goto(`${BASE}/op112`);
      await wait(2500);
      await op.page.screenshot({ path: `${OUT}/05-op112-card.png` });
      console.log("✓ 05-op112-card.png");
    }

    // Teacher: the live board of this lesson, then the cabinet screens on the demo lessons.
    await shot(teacher.page, "06-teacher-board", `/teacher/lessons/${lessonId}`, 3000);
    await shot(teacher.page, "07-teacher-projector", `/teacher/lessons/${lessonId}?projector=1`, 3000);
    await shot(teacher.page, "08-lesson-report", "/teacher/lessons/demo-lesson-1/report");
    const attempt = await db.attempt.findFirst({ where: { lessonId: "demo-lesson-2", reviewStatus: "PENDING" }, orderBy: { createdAt: "asc" } });
    if (attempt) await shot(teacher.page, "09-attempt-review", `/teacher/attempts/${attempt.id}`);
    await shot(teacher.page, "10-weights", "/teacher/weights");
    await shot(teacher.page, "11-scenarios", "/teacher/scenarios");
    await shot(teacher.page, "12-scenario-from-text", "/teacher/scenarios/new");
    await shotSection(teacher.page, "16-teacher-forecast", "/teacher/reports", "Прогноз на следующее занятие");
    await shotSection(teacher.page, "17-forecast-vs-fact", "/teacher/lessons/demo-lesson-1/report", "Прогноз ↔ факт");
    await shotSection(teacher.page, "18-forecast-history", "/teacher/reports", "Прогноз ↔ факт по занятиям");

    const admin = await signedIn(browser, "admin", "Admin2026");
    await shot(admin.page, "13-admin-health", "/admin", 2000);
    await shot(admin.page, "14-admin-audit", "/admin/audit");
    await shot(admin.page, "19-admin-stats", "/admin/stats", 2000);
    await shot(teacher.page, "20-teacher-groups", "/teacher/groups");
    const student = await signedIn(browser, "student3", "Student2026");
    await shot(student.page, "15-student-results", "/student/results");
  } finally {
    await db.lesson.delete({ where: { id: lessonId } }).catch(() => undefined);
    await browser.close();
    await db.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
