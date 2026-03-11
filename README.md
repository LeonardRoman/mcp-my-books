# Books MCP

MCP-сервер для управления книжными библиотеками через **Author.Today**, **PocketBook Cloud** и локальный **OPDS**-каталог. Позволяет через Cursor (или другой MCP-клиент) запрашивать списки «сейчас читаю», «прочитано», отложенные книги, искать по каталогу, загружать книги в PocketBook Cloud и синхронизировать библиотеку в **Obsidian** с автоматическим обогащением метаданными.

## Возможности

### Инструменты Author.Today (`at_*`)

| Инструмент | Описание |
|------------|----------|
| `at_get_reading_books` | Книги со статусом «сейчас читаю» |
| `at_get_finished_books` | Прочитанные книги |
| `at_get_saved_books` | Отложенные на потом |
| `at_search_catalog` | Поиск по каталогу (жанр, сортировка, страница) |

### Инструменты PocketBook Cloud (`pb_*`)

| Инструмент | Описание |
|------------|----------|
| `pb_get_reading_books` | Книги в статусе «сейчас читаю» |
| `pb_get_finished_books` | Прочитанные книги |
| `pb_get_all_books` | Все книги в облаке |

### Инструменты OPDS (`opds_*`)

Работают при заданной переменной окружения `OPDS_URL` (базовый URL OPDS-сервера, например [inpxer](https://github.com/shemanaev/inpxer)).

| Инструмент | Описание |
|------------|----------|
| `opds_browse` | Просмотр каталога: корневой фид (последние книги) или переход по пути/ссылке пагинации |
| `opds_search` | Полнотекстовый поиск по каталогу |
| `opds_book_details` | Детали книги по ID (метаданные и ссылки на скачивание) |

### Объединённые инструменты

| Инструмент | Описание |
|------------|----------|
| `get_all_reading_books` | «Сейчас читаю» из обоих сервисов |
| `get_all_finished_books` | «Прочитано» из обоих сервисов |

### Загрузка книг

| Инструмент | Описание |
|------------|----------|
| `upload_to_pocketbook` | Найти книгу в OPDS по ID, скачать и загрузить в PocketBook Cloud (fb2/epub) |

Типичный сценарий: `opds_search` → выбрать книгу → `upload_to_pocketbook` с полученным ID.

### Obsidian-синхронизация

| Инструмент | Описание |
|------------|----------|
| `sync_library_to_obsidian` | Синхронизация reading + finished + saved из AT и PB в Obsidian vault: создание/обновление карточек книг, авторов, серий. Автоматически обогащает новые книги аннотациями и жанрами, скачивает обложки. |
| `enrich_books` | Пакетное обогащение существующих карточек книг аннотациями и жанрами из Author.Today (с учётом rate limit) |

## Требования

- Node.js 18+
- Учётные записи: Author.Today и/или PocketBook Cloud (опционально)
- Для OPDS: локальный OPDS-сервер и переменная `OPDS_URL`

## Установка и сборка

```bash
npm install
npm run build
```

Сборка использует [TypeScript 7 (tsgo)](https://github.com/microsoft/typescript-go) через `@typescript/native-preview`.

## Конфигурация

### Переменные окружения

Скопируйте пример и заполните данные:

```bash
cp .env.example .env
```

**Author.Today** (обязательно для инструментов `at_*` и объединённых):

| Переменная | Описание |
|------------|----------|
| `AT_LOGIN` | Логин или email на author.today |
| `AT_PASSWORD` | Пароль |

**PocketBook Cloud** (обязательно для инструментов `pb_*` и объединённых):

| Переменная | Описание |
|------------|----------|
| `PB_USERNAME` | Логин PocketBook Cloud (см. ниже) |
| `PB_PASSWORD` | Пароль |
| `PB_CLIENT_ID` | (опционально) по умолчанию используется встроенный |
| `PB_CLIENT_SECRET` | (опционально) по умолчанию используется встроенный |

**OPDS** (обязательно для инструментов `opds_*`):

| Переменная | Описание |
|------------|----------|
| `OPDS_URL` | Базовый URL OPDS-сервера (например `http://books.example.com` или `http://localhost:8080`) |

**Obsidian** (для `sync_library_to_obsidian`):

| Переменная | Описание |
|------------|----------|
| `OBSIDIAN_VAULT_PATH` | Абсолютный путь к Obsidian vault |

#### PocketBook: какой логин использовать

Публичный вход по email на cloud.pocketbook.digital для API часто возвращает «аккаунт не найден». Рабочий доступ даёт **внутренний (синхронизационный) аккаунт** вида `userXXXXX.pbookde@pbsync.com` и пароль к нему.

**Где посмотреть внутренний аккаунт:** в настройках Adobe ID в веб-интерфейсе PocketBook Cloud:

`https://cloud.pocketbook.digital/browser/ru/user/<userID>/settings/adobe`

Подставьте вместо `<userID>` свой идентификатор (число из URL вашего профиля, например `2419035` в `.../user/2419035/`). На странице отображаются UUID, логин (`userXXXXX.pbookde@pbsync.com`) и пароль — их укажите в `PB_USERNAME` и `PB_PASSWORD` в `.env`.

### Подключение в Cursor

В настройках MCP (например, `.cursor/mcp.json` в проекте или в настройках Cursor) добавьте сервер:

```json
{
  "mcpServers": {
    "books": {
      "command": "node",
      "args": ["<абсолютный_путь_к_проекту>/dist/index.js"],
      "env": {
        "AT_LOGIN": "ваш_логин_author_today",
        "AT_PASSWORD": "ваш_пароль",
        "PB_USERNAME": "userXXXXX.pbookde@pbsync.com",
        "PB_PASSWORD": "пароль_pocketbook",
        "OPDS_URL": "http://localhost:8080",
        "OBSIDIAN_VAULT_PATH": "/path/to/your/vault"
      }
    }
  }
}
```

Путь к `dist/index.js` должен вести к собранному проекту (`npm run build`). Пароли и логины лучше не коммитить: используйте переменные окружения системы или храните конфиг MCP вне репозитория.

## Структура проекта

```
src/
├── index.ts              # MCP-сервер, регистрация инструментов
├── author-today/         # Author.Today API
│   ├── auth.ts           # Логин, refresh, fetchWithRetry (timeout + retry + 429)
│   ├── api.ts            # Библиотека (пагинация), каталог, детали произведения
│   ├── genres.ts         # Маппинг жанров: slug ↔ id ↔ русское название
│   └── types.ts          # Типы по API
├── pocketbook/           # PocketBook Cloud API
│   ├── auth.ts           # OAuth2: providers → login
│   ├── api.ts            # Книги, фильтр по read_status
│   ├── upload.ts         # Загрузка книг в PB Cloud из OPDS
│   └── types.ts          # Типы по API
├── opds/                 # OPDS-клиент (локальный каталог)
│   ├── api.ts            # Запрос фидов, поиск, форматирование
│   └── types.ts          # Типы OPDS Feed/Entry/Link
└── obsidian/             # Синхронизация с Obsidian vault
    └── sync.ts           # Обогащение, обложки, авторы, серии, markdown-генерация
```

## Синхронизация с Obsidian — детали

При синхронизации (`sync_library_to_obsidian`):

- **Автоматическое обогащение** — для новых книг из AT загружаются аннотации и жанры через API (пакетно, с паузами для rate limit).
- **Скачивание обложек** — обложки сохраняются в `Meta/Covers/` и встраиваются в карточки через `![[...]]`.
- **Распознавание серий** — для книг из PocketBook серия определяется из названия (паттерны: «Серия. Книга N», «Серия N. Подзаголовок», «Серия-N» и т.д.).
- **Нормализация авторов** — имена из PB сопоставляются с каноническими именами из AT (обработка неполных имён, опечаток, слитных строк вида «Фамилия1 Имя1 Фамилия2 Имя2»).
- **Согласование серий** — названия серий из PB приводятся к каноническим именам из AT.
- **Статусы** — поддерживаются `reading`, `read`, `want-to-read`, `abandoned`; книги с прогрессом ≥95% автоматически помечаются как прочитанные.
- **Структура vault**: `Library/Books/`, `Library/Series/`, `Meta/Authors/`, `Meta/Covers/`.

## API

- **Author.Today**: [api.author.today](https://api.author.today/help), [общая информация](https://api.author.today/home/maininfo) — авторизация по токену (Bearer), библиотека через `GET /v1/account/user-library`, каталог через `GET /v1/catalog/search`.
- **PocketBook Cloud**: неофициальный API `https://cloud.pocketbook.digital/api/v1.0/` — авторизация через OAuth2 (`auth/login`), список книг (`GET /books`), загрузка файлов (`PUT /files/{name}?access_token=...`). Используется в [pocketbook-cloud-sync](https://github.com/micronull/pocketbook-cloud-sync) и [pocketbook2readwise](https://github.com/iterlace/pocketbook2readwise).
- **OPDS**: формат [OPDS 1.1/1.2](https://specs.opds.io/), совместим с [inpxer](https://github.com/shemanaev/inpxer) и другими OPDS-серверами (Calibre, COPS и т.д.). Поиск кодирует пробелы как `+` для совместимости с inpxer.

## Лицензия

ISC
