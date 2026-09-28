/** Local-only UI smoke. Requires a confirmed, still-unassigned OP112 address error from e2e-followup --keep. */
import { PrismaClient } from "@prisma/client";
import { chromium, type Browser } from "playwright-core";

const attemptId = process.argv[process.argv.indexOf("--attempt") + 1];
if (!attemptId || attemptId.startsWith("--")) throw new Error("Pass --attempt <local fixture id>");
const base = "http://127.0.0.1:3112";
if (!["localhost", "127.0.0.1", "::1"].includes(new URL(process.env.DATABASE_URL ?? "postgres://invalid").hostname)) throw new Error("Local test DB only");
const existing = process.argv.includes("--existing");
const db = new PrismaClient();
async function main() {
const browser: Browser = await chromium.launch({ channel: "chrome", headless: true });
let failed = false;
try {
  const [practice, control] = await Promise.all(["Б4-1", "Б11-1"].map((ticketRef) => db.scenario.findFirstOrThrow({ where: { ticketRef } })));
  const teacher = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "ru-RU" });
  const page = await teacher.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const login = await page.request.post(base + "/api/auth/login", { data: { login: "teacher", password: "Teacher2026" } });
  if (!login.ok()) throw new Error(`Teacher login: ${login.status()}`);
  await page.goto(`${base}/teacher/attempts/${attemptId}`);
  if (existing) {
    await page.getByRole("heading", { name: "Назначенная отработка" }).waitFor();
    await page.getByRole("button", { name: "Сохранить наблюдение" }).waitFor();
    await page.getByRole("button", { name: "Отменить назначение" }).waitFor();
    const evidence = page.getByRole("textbox", { name: /Основание/ });
    if (!await evidence.isVisible()) throw new Error("Teacher cannot enter an observed action");
    await page.screenshot({ path: "/tmp/lct-followup-teacher-progress-ui.png", fullPage: true });
    if (errors.length) throw new Error(`Browser errors: ${errors.join(" | ")}`);
    console.log("✓ Teacher can review both stages, record observation, or cancel the route");
  } else {
  await page.getByRole("heading", { name: "Отработка ошибки" }).waitFor();
  await page.waitForTimeout(700);
  const label = page.locator("fieldset label span").first();
  const checkbox = page.getByRole("checkbox", { name: /Петрова Мария Игоревна/ });
  if (!await checkbox.isChecked()) throw new Error("Candidate should start selected for a single source");
  await label.click();
  const off = !await checkbox.isChecked();
  await label.click();
  const on = await checkbox.isChecked();
  if (!off || !on) throw new Error(`Full-area label click failed (off=${off}, on=${on})`);
  await page.getByRole("combobox", { name: "Ситуация для отработки" }).selectOption(practice.id);
  await page.getByRole("combobox", { name: "Новая ситуация для контроля" }).selectOption(control.id);
  const response = page.waitForResponse((r) => r.url().includes("/api/teacher/followups") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Назначить 1 ученику" }).click();
  const created = await response;
  if (created.status() !== 201) throw new Error(`Create follow-up: ${created.status()} ${await created.text()}`);
  await page.getByText("Созданы занятия:").waitFor({ timeout: 5000 });
  await page.screenshot({ path: "/tmp/lct-followup-teacher-ui.png", fullPage: true });
  if (errors.length) throw new Error(`Browser errors: ${errors.join(" | ")}`);
  console.log("✓ Teacher label click, assignment POST and practice/control links");

  }

  const learner = await browser.newContext({ viewport: { width: 375, height: 812 }, locale: "ru-RU" });
  const own = await learner.newPage();
  own.on("pageerror", (e) => errors.push(e.message));
  const studentLogin = await own.request.post(base + "/api/auth/login", { data: { login: "student2", password: "Student2026" } });
  if (!studentLogin.ok()) throw new Error(`Student login: ${studentLogin.status()}`);
  await own.goto(`${base}/student/results/${attemptId}`);
  await own.getByRole("heading", { name: "Следующее упражнение" }).waitFor();
  const viewport = await own.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
  if (viewport.width !== 375 || viewport.scroll > viewport.width) throw new Error(`Mobile overflow: ${JSON.stringify(viewport)}`);
  await own.screenshot({ path: "/tmp/lct-followup-student-ui.png", fullPage: true });
  if (errors.length) throw new Error(`Browser errors: ${errors.join(" | ")}`);
  console.log("✓ Learner sees own follow-up at 375px without horizontal overflow");
} catch (err) {
  failed = true;
  console.error(err);
} finally {
  await browser.close();
  await db.$disconnect();
}
if (failed) process.exitCode = 1;
}
void main().catch((err) => { console.error(err); process.exitCode = 1; });
