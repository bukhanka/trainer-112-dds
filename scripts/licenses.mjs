// Writes docs/licenses.md: every production dependency with its license, plus the AI models and services.
// Run: node scripts/licenses.mjs
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const raw = execFileSync("pnpm", ["licenses", "list", "--prod", "--json"], { encoding: "utf8", maxBuffer: 64 << 20 });
const byLicense = JSON.parse(raw);
const rows = [];
for (const [license, pkgs] of Object.entries(byLicense)) {
  for (const p of pkgs) rows.push({ name: p.name, version: (p.versions ?? [p.version]).join(", "), license });
}
rows.sort((a, b) => a.name.localeCompare(b.name));

// Cloud models the public demo stand calls by API; nothing of them ships with the product.
const cloud = [
  ["Gemini 3.5 Flash-Lite, Gemini 3.5 Flash (Vertex AI, OpenAI-совместимый API)", "собеседник на телефоне; разбор свободного текста и черновик пояснений к оценке", "облачный сервис, условия Google Cloud"],
  ["Chirp 3 (Google Speech-to-Text v2)", "распознавание речи обучающегося", "облачный сервис, условия Google Cloud"],
  ["Gemini Live native audio; запасной — Google Text-to-Speech (Chirp 3 HD)", "голос собеседника", "облачный сервис, условия Google Cloud"],
];

// Recommended for the closed contour: connected by the same .env lines, not bundled.
const models = [
  ["Qwen2.5 7B / 3B Instruct", "языковая модель в контуре (Ollama, llama.cpp)", "Apache 2.0 (7B), Qwen Research (3B)"],
  ["faster-whisper + Whisper large-v3-turbo / small", "распознавание речи в контуре", "MIT"],
  ["Piper TTS + русские голоса", "синтез речи в контуре", "MIT (движок); лицензия голоса указана в карточке голоса"],
];

const services = [
  ["Caddy", "HTTPS и собственный центр сертификации", "Apache 2.0"],
  ["PostgreSQL 16", "база данных", "PostgreSQL License"],
];

const md = [
  "# Библиотеки и модели",
  "",
  "Список собран автоматически командой `node scripts/licenses.mjs` из зависимостей production-сборки.",
  "",
  "## Модели ИИ",
  "",
  "Модели подключаются строками в `.env` и в поставку не входят. Без модели тренажёр работает на правилах.",
  "",
  "**На демо-стенде** — облачные модели по API:",
  "",
  "| Модель | Назначение | Условия |",
  "|---|---|---|",
  ...cloud.map((m) => `| ${m.join(" | ")} |`),
  "",
  "**В закрытом контуре** — рекомендуемые открытые модели на сервере учебного центра:",
  "",
  "| Модель | Назначение | Лицензия |",
  "|---|---|---|",
  ...models.map((m) => `| ${m.join(" | ")} |`),
  "",
  "## Сервисы",
  "",
  "| Компонент | Назначение | Лицензия |",
  "|---|---|---|",
  ...services.map((m) => `| ${m.join(" | ")} |`),
  "",
  `## Библиотеки приложения (${rows.length})`,
  "",
  "Пакет `unpdf` включает сборку PDF.js (Mozilla, Apache 2.0): ею читается текст PDF-файла билета в «Сценарии из текста». Файлы DOCX тренажёр читает своим кодом, без библиотек.",
  "",
  "| Пакет | Версия | Лицензия |",
  "|---|---|---|",
  ...rows.map((r) => `| ${r.name} | ${r.version} | ${r.license} |`),
  "",
];
writeFileSync("docs/licenses.md", md.join("\n"));
console.log(`docs/licenses.md: ${rows.length} packages`);
