import type { SqlDatabase } from './types.js';

type Row = Record<string, unknown>;

function parseWhere(whereClause: string, params: unknown[]): { filters: Array<{ col: string; val: unknown }> } {
  const parts = whereClause
    .split(/\s+AND\s+/i)
    .map((p) => p.trim())
    .filter(Boolean);
  const filters: Array<{ col: string; val: unknown }> = [];
  let pi = 0;
  for (const part of parts) {
    const col = part.split('=')[0]!.trim();
    filters.push({ col, val: params[pi++] });
  }
  return { filters };
}

function matchRow(row: Row, filters: Array<{ col: string; val: unknown }>): boolean {
  return filters.every((f) => row[f.col] === f.val);
}

/**
 * 最小内存 SQL 适配器（测试 / 浏览器持久化 / Tauri 未接 plugin-sql 时）。
 * 仅支持本工作流所需的 CREATE/INSERT/UPDATE/SELECT/DELETE。
 */
export function createMemorySqlDatabase(): SqlDatabase & {
  dump(): Record<string, Row[]>;
  load(data: Record<string, Row[]>): void;
} {
  const tables = new Map<string, Row[]>();

  const ensure = (name: string) => {
    if (!tables.has(name)) tables.set(name, []);
    return tables.get(name)!;
  };

  return {
    exec(sql: string) {
      const statements = sql
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean);
      for (const statement of statements) {
        if (/^CREATE TABLE/i.test(statement)) {
          const match = statement.match(/CREATE TABLE IF NOT EXISTS (\w+)/i);
          if (match) ensure(match[1]!);
        }
      }
    },
    run(sql: string, params: unknown[] = []) {
      const text = sql.trim();
      if (/^INSERT INTO/i.test(text)) {
        const m = text.match(/INSERT INTO (\w+) \(([^)]+)\) VALUES \(([^)]+)\)/i);
        if (!m) return;
        const table = ensure(m[1]!);
        const cols = m[2]!.split(',').map((c) => c.trim());
        const row: Row = {};
        cols.forEach((col, i) => {
          row[col] = params[i];
        });
        table.push(row);
        return;
      }
      if (/^UPDATE/i.test(text)) {
        const m = text.match(/UPDATE (\w+) SET (.+) WHERE (.+)/i);
        if (!m) return;
        const table = ensure(m[1]!);
        const setParts = m[2]!.split(',').map((p) => p.trim());
        const { filters } = parseWhere(m[3]!, params.slice(setParts.length));
        let pi = 0;
        for (const row of table) {
          if (!matchRow(row, filters)) continue;
          for (const part of setParts) {
            const col = part.split('=')[0]!.trim();
            row[col] = params[pi++];
          }
        }
        return;
      }
      if (/^DELETE FROM/i.test(text)) {
        const m = text.match(/DELETE FROM (\w+)(?: WHERE (.+))?/i);
        if (!m) return;
        const tableName = m[1]!;
        if (!m[2]) {
          tables.set(tableName, []);
          return;
        }
        const { filters } = parseWhere(m[2], params);
        tables.set(
          tableName,
          ensure(tableName).filter((row) => !matchRow(row, filters)),
        );
      }
    },
    all<T = Row>(sql: string, params: unknown[] = []): T[] {
      const text = sql.trim();
      const m = text.match(/FROM (\w+)/i);
      if (!m) return [];
      let rows = [...ensure(m[1]!)];
      let paramOffset = 0;
      if (/WHERE/i.test(text)) {
        const where = text.split(/WHERE/i)[1]!.split(/ORDER BY/i)[0]!.split(/LIMIT/i)[0]!.trim();
        const { filters } = parseWhere(where, params);
        paramOffset = filters.length;
        rows = rows.filter((row) => matchRow(row, filters));
      }
      if (/ORDER BY/i.test(text)) {
        const order = text.split(/ORDER BY/i)[1]!.split(/LIMIT/i)[0]!.trim();
        const col = order.split(/\s+/)[0]!;
        const desc = /DESC/i.test(order);
        rows.sort((a, b) => {
          const av = String(a[col] ?? '');
          const bv = String(b[col] ?? '');
          return desc ? bv.localeCompare(av) : av.localeCompare(bv);
        });
      }
      if (/LIMIT/i.test(text)) {
        const lit = text.match(/LIMIT\s+(\d+)/i)?.[1];
        const lim = lit ? Number(lit) : Number(params[paramOffset] ?? rows.length);
        rows = rows.slice(0, lim);
      }
      return rows as T[];
    },
    get<T = Row>(sql: string, params: unknown[] = []): T | undefined {
      return this.all<T>(sql, params)[0];
    },
    dump() {
      return Object.fromEntries([...tables.entries()].map(([k, v]) => [k, v.map((r) => ({ ...r }))]));
    },
    load(data: Record<string, Row[]>) {
      tables.clear();
      for (const [name, rows] of Object.entries(data)) {
        tables.set(
          name,
          rows.map((r) => ({ ...r })),
        );
      }
    },
  };
}
