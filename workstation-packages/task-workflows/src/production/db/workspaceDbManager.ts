import { createMemorySqlDatabase } from '../material-daily-close/localDb/memorySql.js';
import type { SqlDatabase } from '../material-daily-close/localDb/types.js';

/** 工作区白名单：禁止任意路径 */
export const ALLOWED_WORKSPACES = [
  'production',
  'hr',
  'finance',
  'logistics',
  'ecommerce',
  'sales',
] as const;

export type WorkspaceId = (typeof ALLOWED_WORKSPACES)[number];

const SYSTEM_DB = 'app';

export type ManagedDatabaseId = WorkspaceId | typeof SYSTEM_DB;

const DB_RELATIVE_PATH: Record<ManagedDatabaseId, string> = {
  app: 'data/system/app.db',
  production: 'data/production/production.db',
  hr: 'data/hr/hr.db',
  finance: 'data/finance/finance.db',
  logistics: 'data/logistics/logistics.db',
  ecommerce: 'data/ecommerce/ecommerce.db',
  sales: 'data/sales/sales.db',
};

type MemoryDb = ReturnType<typeof createMemorySqlDatabase>;

const cache = new Map<ManagedDatabaseId, MemoryDb>();

function assertWorkspace(id: string): asserts id is ManagedDatabaseId {
  if (id !== 'app' && !(ALLOWED_WORKSPACES as readonly string[]).includes(id)) {
    throw new Error(`禁止打开未授权工作区数据库: ${id}`);
  }
}

function persistKey(id: ManagedDatabaseId) {
  return `aw.workspace.db.${id}`;
}

function loadPersisted(id: ManagedDatabaseId, db: MemoryDb) {
  if (typeof localStorage === 'undefined') return;
  try {
    const raw = localStorage.getItem(persistKey(id));
    if (raw) db.load(JSON.parse(raw) as Record<string, Array<Record<string, unknown>>>);
  } catch {
    // ignore
  }
}

function savePersisted(id: ManagedDatabaseId, db: MemoryDb) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(persistKey(id), JSON.stringify(db.dump()));
  } catch {
    // quota
  }
}

/**
 * WorkspaceDatabaseManager
 * - 只允许白名单工作区
 * - 禁止接收任意文件系统路径打开业务库
 * - production 模块只能拿 production.db
 */
export class WorkspaceDatabaseManager {
  static relativePath(id: ManagedDatabaseId): string {
    assertWorkspace(id);
    return DB_RELATIVE_PATH[id];
  }

  static open(id: ManagedDatabaseId): SqlDatabase & { persist(): void; dump(): Record<string, unknown[]> } {
    assertWorkspace(id);
    let db = cache.get(id);
    if (!db) {
      db = createMemorySqlDatabase();
      loadPersisted(id, db);
      cache.set(id, db);
    }
    return {
      exec: (sql) => db!.exec(sql),
      run: (sql, params) => db!.run(sql, params),
      all: (sql, params) => db!.all(sql, params),
      get: (sql, params) => db!.get(sql, params),
      dump: () => db!.dump(),
      persist: () => savePersisted(id, db!),
    };
  }

  /** 生产模块唯一入口 */
  static openProduction(): ReturnType<typeof WorkspaceDatabaseManager.open> {
    return this.open('production');
  }

  static openApp(): ReturnType<typeof WorkspaceDatabaseManager.open> {
    return this.open('app');
  }

  /** 本轮初始化：仅 app.db + production.db */
  static initRoundDatabases(): { app: string; production: string } {
    const app = this.openApp();
    app.exec(`
CREATE TABLE IF NOT EXISTS AppMeta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);`);
    app.run('INSERT INTO AppMeta (key, value, updated_at) VALUES (?, ?, ?)', [
      'schema_version',
      '1',
      new Date().toISOString(),
    ]);
    app.persist();

    const production = this.openProduction();
    // schema applied by ProductionRepository
    production.persist();

    return {
      app: DB_RELATIVE_PATH.app,
      production: DB_RELATIVE_PATH.production,
    };
  }

  /** 测试用：清空缓存 */
  static _resetForTests() {
    cache.clear();
  }
}
