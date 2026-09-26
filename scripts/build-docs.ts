/**
 * Builds the documentation as one PDF and one DOCX (docs/documentation.pdf, docs/documentation.docx) from docs/*.md.
 *  - Mermaid diagrams are rendered with Chrome: SVG for the PDF (vector), 3× PNG for the DOCX.
 *  - PDF: pandoc → standalone HTML with a static table of contents → Chrome prints it to A4.
 *  - DOCX: pandoc with a table-of-contents field that Word refreshes on opening.
 *
 *   pnpm exec tsx scripts/build-docs.ts
 *
 * Needs pandoc and Google Chrome (or CHROME_PATH); mermaid and the PT Sans font are loaded from CDNs.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, type Browser } from "playwright-core";

const DOCS = "docs";
const BUILD = path.join(DOCS, "build");
const ORDER: [string, string][] = [
  ["architecture.md", "Архитектура"],
  ["methods.md", "Методы обработки данных"],
  ["data.md", "Данные и подбор служб"],
  ["op112.md", "Место оператора 112"],
  ["dds.md", "Место диспетчера ДДС"],
  ["teacher.md", "Кабинеты преподавателя и обучающегося"],
  ["admin.md", "Руководство администратора"],
  ["install.md", "Установка и запуск"],
  ["security.md", "Безопасность и персональные данные"],
  ["performance.md", "Производительность и нагрузка"],
  ["stand.md", "Демо-стенд"],
  ["licenses.md", "Библиотеки и модели"],
];

const CSS = `
@import url("https://fonts.googleapis.com/css2?family=PT+Sans:ital,wght@0,400;0,700;1,400&family=PT+Mono&display=swap");
@page { size: A4; margin: 18mm 16mm 20mm 16mm; }
html { font-family: "PT Sans", "DejaVu Sans", Arial, sans-serif; font-size: 10.5pt; color: #1f2326; line-height: 1.45; }
body { max-width: none; margin: 0; }
header#title-block-header { padding-top: 95mm; text-align: center; break-after: page; page-break-after: always; }
header .title { font-size: 26pt; color: #2f353a; margin: 0 0 6mm; }
header .subtitle { font-size: 15pt; color: #157dbd; margin: 0 0 14mm; font-weight: 400; }
header .date { color: #49555d; }
nav#TOC { break-after: page; page-break-after: always; }
nav#TOC h2 { font-size: 18pt; color: #2f353a; margin: 0 0 4mm; }
nav#TOC ul { list-style: none; padding-left: 0; }
nav#TOC ul ul { padding-left: 6mm; font-size: 9.5pt; }
nav#TOC a { color: #1f2326; text-decoration: none; }
nav#TOC > ul > li { margin-top: 2.5mm; font-weight: 700; }
nav#TOC > ul > li li { font-weight: 400; }
h1 { page-break-before: always; font-size: 20pt; color: #2f353a; border-bottom: 2px solid #ec653b; padding-bottom: 2mm; margin: 0 0 5mm; }
h2 { font-size: 14pt; color: #157dbd; margin: 7mm 0 2mm; page-break-after: avoid; }
h3 { font-size: 12pt; color: #2f353a; margin: 5mm 0 2mm; page-break-after: avoid; }
h4 { font-size: 11pt; margin: 4mm 0 1.5mm; }
p, li { orphans: 3; widows: 3; }
a { color: #157dbd; }
table { border-collapse: collapse; width: 100%; margin: 3mm 0; font-size: 9.2pt; page-break-inside: auto; }
thead { display: table-header-group; }
tr { page-break-inside: avoid; }
th, td { border: 1px solid #c9ced1; padding: 1.4mm 2mm; vertical-align: top; text-align: left; }
th { background: #efefef; }
code { font-family: "PT Mono", "DejaVu Sans Mono", monospace; font-size: 8.8pt; background: #f4f5f6; padding: 0 1px; }
pre { background: #f4f5f6; border: 1px solid #e1e4e6; padding: 2.5mm; white-space: pre-wrap; word-break: break-word; page-break-inside: avoid; }
pre code { background: none; padding: 0; }
img { max-width: 100%; }
figure { margin: 4mm 0; text-align: center; page-break-inside: avoid; }
figcaption { display: none; }
figure.diagram svg { max-width: 100%; height: auto; }
blockquote { border-left: 3px solid #157dbd; margin: 3mm 0; padding: 0 4mm; color: #49555d; }
`;

async function launch(): Promise<Browser> {
  return chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chrome" });
}

/** Renders every diagram to diagram-N.svg (for the PDF) and diagram-N.png at 3× (for the DOCX). */
async function renderDiagrams(browser: Browser, sources: string[]) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 3 });
  await page.setContent(
    `<html><body style="margin:0;background:#fff"><div id="out" style="display:inline-block"></div>
     <script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script></body></html>`,
  );
  await page.waitForFunction(() => "mermaid" in window);
  for (let i = 0; i < sources.length; i++) {
    const svg = await page.evaluate(async ([src, id]) => {
      const m = (window as unknown as { mermaid: { initialize: (o: object) => void; render: (id: string, s: string) => Promise<{ svg: string }> } }).mermaid;
      m.initialize({ startOnLoad: false, theme: "base", fontFamily: "Arial", themeVariables: { primaryColor: "#e8f2fa", primaryBorderColor: "#157dbd", lineColor: "#49555d", fontSize: "15px" } });
      const { svg } = await m.render(id, src);
      document.getElementById("out")!.innerHTML = svg;
      return svg;
    }, [sources[i], `d${i}`] as const);
    writeFileSync(path.join(BUILD, `diagram-${i + 1}.svg`), svg);
    await page.locator("#out svg").screenshot({ path: path.join(BUILD, `diagram-${i + 1}.png`) });
  }
  await page.close();
}

function combinedMarkdown(): { body: string; diagrams: string[] } {
  const diagrams: string[] = [];
  let body = "";
  for (const [file, title] of ORDER) {
    let md = readFileSync(path.join(DOCS, file), "utf8");
    // The chapter title replaces the document's own H1; its headings move one level down.
    md = md.replace(/^# .*\n/, "").replace(/^(#{1,5}) /gm, "#$1 ");
    md = md.replace(/```mermaid\n([\s\S]*?)```/g, (_, src: string) => {
      diagrams.push(src);
      return `![](diagram-${diagrams.length}.EXT)`;
    });
    // Links to other documents become plain text inside one book; images point into docs/img.
    md = md.replace(/\[([^\]]+)\]\((?!https?:)[^)]+\.md(#[^)]*)?\)/g, "$1").replace(/\]\(img\//g, "](../img/");
    body += `\n\n# ${title}\n\n${md}\n`;
  }
  return { body, diagrams };
}

/** Word refreshes the table-of-contents field when the file is opened. */
function markFieldsForUpdate(docx: string) {
  const dir = path.join(BUILD, "docx");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir);
  execFileSync("unzip", ["-q", path.resolve(docx), "-d", dir]);
  const settingsPath = path.join(dir, "word", "settings.xml");
  const settings = readFileSync(settingsPath, "utf8");
  if (!settings.includes("w:updateFields")) {
    writeFileSync(settingsPath, settings.replace(/<w:settings([^>]*)>/, '<w:settings$1><w:updateFields w:val="true"/>'));
  }
  rmSync(docx);
  execFileSync("zip", ["-q", "-r", "-X", path.resolve(docx), "."], { cwd: dir });
}

async function main() {
  rmSync(BUILD, { recursive: true, force: true });
  mkdirSync(BUILD, { recursive: true });
  const browser = await launch();
  const { body, diagrams } = combinedMarkdown();
  await renderDiagrams(browser, diagrams);

  const date = new Date().toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
  const front = ["---", 'title: "Тренажёр оператора 112 и диспетчера ДДС"', 'subtitle: "Техническая документация"', `date: "${date}"`, "lang: ru-RU", 'toc-title: "Содержание"', "---", ""].join("\n");

  // PDF through HTML: static TOC, vector diagrams, the same look in any viewer.
  const htmlSource = path.join(BUILD, "documentation-html.md");
  // Diagrams go into the page inline: mermaid labels are HTML inside the SVG and do not render from <img>.
  const inlined = body.replace(/!\[\]\(diagram-(\d+)\.EXT\)/g, (_, n: string) => {
    const svg = readFileSync(path.join(BUILD, `diagram-${n}.svg`), "utf8");
    return `\n\n<figure class="diagram">${svg}</figure>\n\n`;
  });
  writeFileSync(htmlSource, front + inlined);
  writeFileSync(path.join(BUILD, "print.css"), CSS);
  const html = path.join(BUILD, "documentation.html");
  execFileSync("pandoc", [htmlSource, "-s", "--toc", "--toc-depth=2", "-c", "print.css", "--metadata", "pagetitle=Техническая документация", "-o", html]);
  const page = await browser.newPage();
  await page.goto(pathToFileURL(path.resolve(html)).href, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.pdf({
    path: path.join(DOCS, "documentation.pdf"),
    format: "A4",
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: "<span></span>",
    footerTemplate:
      '<div style="width:100%;font-size:8px;color:#8e9091;padding:0 16mm;display:flex;justify-content:space-between"><span>Тренажёр оператора 112 и диспетчера ДДС · техническая документация</span><span class="pageNumber"></span></div>',
    margin: { top: "18mm", bottom: "20mm", left: "16mm", right: "16mm" },
  });
  await browser.close();

  // DOCX for editing.
  const docxSource = path.join(BUILD, "documentation-docx.md");
  writeFileSync(docxSource, front + body.replaceAll(".EXT)", ".png)"));
  const docx = path.join(DOCS, "documentation.docx");
  execFileSync("pandoc", [docxSource, "-o", docx, "--toc", "--toc-depth=2", `--resource-path=${BUILD}:${DOCS}`]);
  markFieldsForUpdate(docx);

  const pages = execFileSync("pdfinfo", [path.join(DOCS, "documentation.pdf")], { encoding: "utf8" }).match(/Pages:\s+(\d+)/)?.[1];
  console.log(`docs/documentation.pdf (${pages} стр.) и docs/documentation.docx — ${ORDER.length} разделов, ${diagrams.length} схем`);
  copyFileSync(html, path.join(BUILD, "index.html"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
