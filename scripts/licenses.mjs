// Writes docs/licenses.md: every production dependency with its license, plus the models we recommend.
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

const models = [
  ["Qwen2.5 7B / 3B Instruct", "языковая модель в контуре (Ollama, llama.cpp)", "Apache 2.0 (7B), Qwen Research (3B)"],
  ["faster-whisper + Whisper large-v3-turbo / small", "распознавание речи в контуре", "MIT"],
  ["Piper TTS + русские голоса", "синтез речи в контуре", "MIT (движок); лицензия голоса указана в карточке голоса"],
  ["Caddy", "HTTPS и собственный центр сертификации", "Apache 2.0"],
  ["PostgreSQL 16", "база данных", "PostgreSQL License"],
];

const md = [
  "# Библиотеки и модели",
  "",
  "Список собран автоматически командой `node scripts/licenses.mjs` из зависимостей production-сборки.",
  "",
  "## Модели и сервисы",
  "",
  "| Компонент | Назначение | Лицензия |",
  "|---|---|---|",
  ...models.map((m) => `| ${m.join(" | ")} |`),
  "",
  `## Библиотеки приложения (${rows.length})`,
  "",
  "| Пакет | Версия | Лицензия |",
  "|---|---|---|",
  ...rows.map((r) => `| ${r.name} | ${r.version} | ${r.license} |`),
  "",
];
writeFileSync("docs/licenses.md", md.join("\n"));
console.log(`docs/licenses.md: ${rows.length} packages`);
