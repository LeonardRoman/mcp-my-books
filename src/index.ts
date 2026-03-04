import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  searchCatalog,
  getLibrary,
  formatCatalogWork,
  formatLibraryWork,
} from "./author-today/api.js";
import {
  getReadingBooks as pbGetReading,
  getFinishedBooks as pbGetFinished,
  getAllBooks as pbGetAll,
  formatPbBook,
} from "./pocketbook/api.js";

const server = new McpServer({
  name: "books-mcp",
  version: "2.0.0",
});

// --- author.today: раздельные инструменты ---

server.tool(
  "at_search_catalog",
  "Поиск по каталогу author.today (жанр, сортировка)",
  {
    genre: z.string().optional().describe('Жанр ("all", "fantasy", "sf" и т.п.)'),
    sorting: z.string().optional().describe('Сортировка: "popular", "new", "rating"'),
    page: z.number().optional().describe("Номер страницы"),
  },
  async ({ genre, sorting, page }) => {
    try {
      const result = await searchCatalog(
        genre ?? "all",
        sorting ?? "popular",
        page ?? 1
      );
      if (result.works.length === 0) {
        return { content: [{ type: "text", text: "По запросу ничего не найдено." }] };
      }
      const text = [
        `Author.Today — найдено: ${result.totalCount} (страница ${page ?? 1})`,
        "",
        ...result.works.map((w, i) => `${i + 1}. ${formatCatalogWork(w)}`),
      ].join("\n");
      return { content: [{ type: "text", text }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Ошибка: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  "at_get_reading_books",
  "Книги author.today со статусом «сейчас читаю»",
  {},
  async () => {
    try {
      const result = await getLibrary("Reading");
      if (result.works.length === 0) {
        return { content: [{ type: "text", text: "Author.Today: список чтения пуст." }] };
      }
      const text = [
        `Author.Today — сейчас читаю (${result.totalCount}):`,
        "",
        ...result.works.map((w, i) => `${i + 1}. ${formatLibraryWork(w)}`),
      ].join("\n");
      return { content: [{ type: "text", text }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Ошибка: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  "at_get_finished_books",
  "Прочитанные книги author.today",
  {},
  async () => {
    try {
      const result = await getLibrary("Finished");
      if (result.works.length === 0) {
        return { content: [{ type: "text", text: "Author.Today: прочитанных книг нет." }] };
      }
      const text = [
        `Author.Today — прочитано (${result.totalCount}):`,
        "",
        ...result.works.map((w, i) => `${i + 1}. ${formatLibraryWork(w)}`),
      ].join("\n");
      return { content: [{ type: "text", text }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Ошибка: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  "at_get_saved_books",
  "Отложенные книги author.today",
  {},
  async () => {
    try {
      const result = await getLibrary("Saved");
      if (result.works.length === 0) {
        return { content: [{ type: "text", text: "Author.Today: отложенных книг нет." }] };
      }
      const text = [
        `Author.Today — отложено (${result.totalCount}):`,
        "",
        ...result.works.map((w, i) => `${i + 1}. ${formatLibraryWork(w)}`),
      ].join("\n");
      return { content: [{ type: "text", text }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Ошибка: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  }
);

// --- PocketBook Cloud: раздельные инструменты ---

server.tool(
  "pb_get_reading_books",
  "Книги PocketBook Cloud со статусом «сейчас читаю»",
  {},
  async () => {
    try {
      const result = await pbGetReading();
      if (result.books.length === 0) {
        return { content: [{ type: "text", text: "PocketBook Cloud: список чтения пуст." }] };
      }
      const text = [
        `PocketBook Cloud — сейчас читаю (${result.totalCount}):`,
        "",
        ...result.books.map((b, i) => `${i + 1}. ${formatPbBook(b)}`),
      ].join("\n");
      return { content: [{ type: "text", text }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Ошибка: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  "pb_get_finished_books",
  "Прочитанные книги PocketBook Cloud",
  {},
  async () => {
    try {
      const result = await pbGetFinished();
      if (result.books.length === 0) {
        return { content: [{ type: "text", text: "PocketBook Cloud: прочитанных книг нет." }] };
      }
      const text = [
        `PocketBook Cloud — прочитано (${result.totalCount}):`,
        "",
        ...result.books.map((b, i) => `${i + 1}. ${formatPbBook(b)}`),
      ].join("\n");
      return { content: [{ type: "text", text }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Ошибка: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  "pb_get_all_books",
  "Все книги в PocketBook Cloud",
  {},
  async () => {
    try {
      const result = await pbGetAll();
      if (result.books.length === 0) {
        return { content: [{ type: "text", text: "PocketBook Cloud: библиотека пуста." }] };
      }
      const text = [
        `PocketBook Cloud — всего книг: ${result.totalCount}`,
        "",
        ...result.books.map((b, i) => `${i + 1}. ${formatPbBook(b)}`),
      ].join("\n");
      return { content: [{ type: "text", text }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Ошибка: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  }
);

// --- Объединённые инструменты ---

server.tool(
  "get_all_reading_books",
  "Сейчас читаю: книги из author.today и PocketBook Cloud вместе",
  {},
  async () => {
    const lines: string[] = [];
    try {
      const at = await getLibrary("Reading");
      lines.push(`Author.Today (${at.totalCount}):`);
      if (at.works.length === 0) lines.push("  (пусто)");
      else at.works.forEach((w, i) => lines.push(`  ${i + 1}. ${formatLibraryWork(w).split("\n")[0]}`));
      lines.push("");
    } catch (e) {
      lines.push(`Author.Today: ошибка — ${e instanceof Error ? e.message : String(e)}`);
      lines.push("");
    }
    try {
      const pb = await pbGetReading();
      lines.push(`PocketBook Cloud (${pb.totalCount}):`);
      if (pb.books.length === 0) lines.push("  (пусто)");
      else pb.books.forEach((b, i) => lines.push(`  ${i + 1}. ${formatPbBook(b).split("\n")[0]}`));
    } catch (e) {
      lines.push(`PocketBook Cloud: ошибка — ${e instanceof Error ? e.message : String(e)}`);
    }
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

server.tool(
  "get_all_finished_books",
  "Прочитано: книги из author.today и PocketBook Cloud вместе",
  {},
  async () => {
    const lines: string[] = [];
    try {
      const at = await getLibrary("Finished");
      lines.push(`Author.Today (${at.totalCount}):`);
      if (at.works.length === 0) lines.push("  (пусто)");
      else at.works.forEach((w, i) => lines.push(`  ${i + 1}. ${formatLibraryWork(w).split("\n")[0]}`));
      lines.push("");
    } catch (e) {
      lines.push(`Author.Today: ошибка — ${e instanceof Error ? e.message : String(e)}`);
      lines.push("");
    }
    try {
      const pb = await pbGetFinished();
      lines.push(`PocketBook Cloud (${pb.totalCount}):`);
      if (pb.books.length === 0) lines.push("  (пусто)");
      else pb.books.forEach((b, i) => lines.push(`  ${i + 1}. ${formatPbBook(b).split("\n")[0]}`));
    } catch (e) {
      lines.push(`PocketBook Cloud: ошибка — ${e instanceof Error ? e.message : String(e)}`);
    }
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Books MCP server (author.today + PocketBook Cloud) started");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
