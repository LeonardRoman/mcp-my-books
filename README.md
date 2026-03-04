# Books MCP

MCP-сервер для доступа к библиотекам книг из **Author.Today** и **PocketBook Cloud**. Позволяет через Cursor (или другой MCP-клиент) запрашивать списки «сейчас читаю», «прочитано», отложенные книги и поиск по каталогу.

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

### Объединённые инструменты

| Инструмент | Описание |
|------------|----------|
| `get_all_reading_books` | «Сейчас читаю» из обоих сервисов |
| `get_all_finished_books` | «Прочитано» из обоих сервисов |

## Требования

- Node.js 18+
- Учётные записи: Author.Today и/или PocketBook Cloud

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

#### PocketBook: какой логин использовать

Публичный вход по email на cloud.pocketbook.digital для API часто возвращает «аккаунт не найден». Рабочий доступ даёт **внутренний (синхронизационный) аккаунт** вида `userXXXXX.pbookde@pbsync.com` и пароль к нему. Его можно посмотреть в настройках устройства/приложения PocketBook или в разделе «Для разработчиков» на сайте. В `.env` укажите именно этот логин и пароль в `PB_USERNAME` и `PB_PASSWORD`.

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
        "PB_PASSWORD": "пароль_pocketbook"
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
│   ├── auth.ts           # Логин (login-by-password), refresh token
│   ├── api.ts            # Библиотека, каталог, форматирование
│   └── types.ts          # Типы по API
└── pocketbook/           # PocketBook Cloud API
    ├── auth.ts           # OAuth2: providers → login
    ├── api.ts            # Книги, фильтр по read_status
    └── types.ts          # Типы по API
```

## API

- **Author.Today**: [api.author.today](https://api.author.today/help), [общая информация](https://api.author.today/home/maininfo) — авторизация по токену (Bearer), библиотека через `GET /v1/account/user-library`, каталог через `GET /v1/catalog/search`.
- **PocketBook Cloud**: неофициальный API `https://cloud.pocketbook.digital/api/v1.0/` (auth/login, books), используется в [pocketbook-cloud-sync](https://github.com/micronull/pocketbook-cloud-sync) и [pocketbook2readwise](https://github.com/iterlace/pocketbook2readwise).

## Лицензия

ISC
