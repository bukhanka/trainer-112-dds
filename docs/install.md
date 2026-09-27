# Установка и запуск

Три способа: для разработки, в Docker на одном сервере, офлайн в изолированном контуре учебного класса. Во всех случаях модели ИИ подключаются настройкой в `.env`, код менять не нужно.

## Требования

| Что | Минимум |
|---|---|
| Сервер | Ubuntu 20.04+ или Windows 10/11 с Docker Desktop; 4 ядра, 8 ГБ ОЗУ, 20 ГБ диска (без локальных моделей) |
| Локальные модели (по желанию) | + 16 ГБ ОЗУ для языковой модели 7B на процессоре или видеокарта от 8 ГБ |
| Рабочие места | Chrome, Firefox или Яндекс.Браузер; для голоса — гарнитура и HTTPS |

## 1. Разработка

```bash
cp .env.example .env
pnpm install
pnpm db:up && pnpm db:migrate && pnpm db:seed
pnpm dev                      # http://localhost:3100
```

## 2. Docker на одном сервере

```bash
cp .env.example .env          # при необходимости задайте адреса моделей
docker compose --profile app up -d --build
# приложение: http://<сервер>:3000, демо-учётки — в README
```

На Windows 10/11 те же команды выполняются в PowerShell при запущенном Docker Desktop (движок WSL 2). Переводы строк в репозитории закреплены файлом `.gitattributes`, поэтому скрипты контейнера не ломаются при клонировании на Windows.

При старте контейнер сам применяет миграции и загружает демо-учётки и справочники (повторный запуск ничего не дублирует). У всех сервисов `restart: always` и проверка здоровья: после сбоя или перезагрузки сервера всё поднимается само.

### HTTPS

Браузер даёт доступ к микрофону только по HTTPS, поэтому для голосовых звонков нужен профиль `https` (Caddy перед приложением):

```bash
# публичный стенд с доменом — сертификат Let's Encrypt выпускается автоматически
SITE_ADDRESS=trainer.example.ru docker compose --profile app --profile https up -d

# учебный класс без интернета — собственный центр сертификации Caddy
SITE_ADDRESS=192.168.1.10 TLS_MODE="tls internal" docker compose --profile app --profile https up -d
docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt ./root.crt
```

На сервере с HTTPS задайте в `.env` `APP_PUBLISH=127.0.0.1:3000` и свой `POSTGRES_PASSWORD`: тогда из сети доступен только Caddy, а база — только с самого сервера.

`root.crt` один раз устанавливается на компьютеры класса в «Доверенные корневые центры сертификации» (Windows: двойной щелчок → «Установить сертификат» → «Локальный компьютер»). После этого адрес `https://192.168.1.10` открывается без предупреждений и с микрофоном.

## 3. Офлайн-установка (без интернета)

На машине с интернетом одна команда собирает два архива — образы Docker и файлы проекта:

```bash
scripts/offline-bundle.sh      # → ../trainer-offline-images.tar.gz и ../trainer-offline-project.tar.gz
```

В контуре:

```bash
tar xzf trainer-offline-project.tar.gz && cd trainer
gunzip -c ../trainer-offline-images.tar.gz | docker load
cp .env.example .env
docker compose --profile app --profile https up -d
```

## Модели ИИ

Все три сервиса говорят на OpenAI-совместимом HTTP API, поэтому облачный и локальный вариант отличаются только строками в `.env`:

| Назначение | Переменные | Облако (стенд) | Локально (контур) |
|---|---|---|---|
| Языковая модель | `LLM_BASE_URL`, `LLM_MODEL`, `LLM_MODEL_SMART`, `LLM_API_KEY` или `LLM_AUTH=google` | Gemini через OpenAI-совместимый вход Vertex AI | Ollama или llama.cpp: `http://<хост>:11434/v1`, модель Qwen2.5 7B Instruct |
| Распознавание речи | `STT_PROVIDER`, `STT_BASE_URL`, `STT_MODEL` | Google Speech-to-Text (Chirp 3) | faster-whisper-server |
| Синтез речи | `TTS_PROVIDER`, `TTS_BASE_URL`, `TTS_VOICE_*` | голос Gemini Live потоком, запасной — Google Text-to-Speech | Piper через OpenAI-совместимый сервер |

Для Google Cloud нужен ключ сервисного аккаунта с ролями «Vertex AI User» и «Speech Client» (`GOOGLE_APPLICATION_CREDENTIALS`); пример всех строк — в `.env.example`. Ключ хранится только на сервере и в репозиторий не попадает.

Без `LLM_BASE_URL` приложение работает в режиме заглушки: заявитель отвечает по фактам сценария правилами, проверки, которым нужна модель, помечаются «не применимо». Текущие адреса видны администратору на странице «Состояние».

## Резервные копии и восстановление

См. [admin.md](admin.md).
