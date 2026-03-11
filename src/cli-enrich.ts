#!/usr/bin/env node

import { enrichExistingBooks, formatEnrichReport } from "./obsidian/sync.js";

const vaultPath = process.env.OBSIDIAN_VAULT_PATH;
if (!vaultPath) {
  console.error("OBSIDIAN_VAULT_PATH не задан");
  process.exit(1);
}

const batchSize = Number(process.argv[2]) || 50;

console.error(`[${new Date().toISOString()}] Обогащение карточек: ${vaultPath} (batch: ${batchSize})`);

try {
  const report = await enrichExistingBooks(vaultPath, batchSize);
  console.log(formatEnrichReport(report));

  if (report.errors.length > 0) {
    process.exit(2);
  }
} catch (err) {
  console.error(`Фатальная ошибка: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
