#!/usr/bin/env node

import { syncLibraryToObsidian, formatSyncReport } from "./obsidian/sync.js";

const vaultPath = process.env.OBSIDIAN_VAULT_PATH;
if (!vaultPath) {
  console.error("OBSIDIAN_VAULT_PATH не задан");
  process.exit(1);
}

console.error(`[${new Date().toISOString()}] Синхронизация: ${vaultPath}`);

try {
  const report = await syncLibraryToObsidian(vaultPath, false);
  console.log(formatSyncReport(report));

  if (report.errors.length > 0) {
    process.exit(2);
  }
} catch (err) {
  console.error(`Фатальная ошибка: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
