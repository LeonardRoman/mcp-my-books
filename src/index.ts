import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  searchCatalog,
  getLibrary,
  formatCatalogWork,
  formatLibraryWork,
} from "./api.js";

const server = new McpServer({
  name: "author-today",
  version: "1.0.0",
});

server.tool(
  "search_catalog",
  "Поиск по каталогу author.today с фильтрами (жанр, сортировка)",
  {
    genre: z
      .string()
      .optional()
      .describe('Жанр (например "all", "fantasy", "sf" и т.п., по умолчанию "all")'),
    sorting: z
      .string()
      .optional()
      .describe('Сортировка: "popular", "new", "rating", "likes" и т.п. (по умолчанию "popular")'),
    page: z.number().optional().describe("Номер страницы (по умолчанию 1)"),
  },
  async ({ genre, sorting, page }) => {
    try {
      const result = await searchCatalog(
        genre ?? "all",
        sorting ?? "popular",
        page ?? 1
      );
      if (result.works.length === 0) {
        return {
          content: [{ type: "text", text: "По запросу ничего не найдено." }],
        };
      }
      const text = [
        `Найдено: ${result.totalCount} книг (страница ${page ?? 1})`,
        "",
        ...result.works.map((w, i) => `${i + 1}. ${formatCatalogWork(w)}`),
      ].join("\n");
      return { content: [{ type: "text", text }] };
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: `Ошибка поиска: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

server.tool(
  "get_reading_books",
  "Книги, которые сейчас читаются (с прогрессом чтения)",
  {},
  async () => {
    try {
      const result = await getLibrary("Reading");
      if (result.works.length === 0) {
        return {
          content: [{ type: "text", text: "Список чтения пуст." }],
        };
      }
      const text = [
        `Сейчас читаю (${result.totalCount} книг):`,
        "",
        ...result.works.map((w, i) => `${i + 1}. ${formatLibraryWork(w)}`),
      ].join("\n");
      return { content: [{ type: "text", text }] };
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: `Ошибка: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

server.tool(
  "get_finished_books",
  "Прочитанные книги из библиотеки",
  {},
  async () => {
    try {
      const result = await getLibrary("Finished");
      if (result.works.length === 0) {
        return {
          content: [{ type: "text", text: "Список прочитанных книг пуст." }],
        };
      }
      const text = [
        `Прочитано (${result.totalCount} книг):`,
        "",
        ...result.works.map((w, i) => `${i + 1}. ${formatLibraryWork(w)}`),
      ].join("\n");
      return { content: [{ type: "text", text }] };
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: `Ошибка: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

server.tool(
  "get_saved_books",
  "Книги, отложенные на потом",
  {},
  async () => {
    try {
      const result = await getLibrary("Saved");
      if (result.works.length === 0) {
        return {
          content: [{ type: "text", text: "Список отложенных книг пуст." }],
        };
      }
      const text = [
        `Отложено (${result.totalCount} книг):`,
        "",
        ...result.works.map((w, i) => `${i + 1}. ${formatLibraryWork(w)}`),
      ].join("\n");
      return { content: [{ type: "text", text }] };
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: `Ошибка: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Author.Today MCP server started");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
