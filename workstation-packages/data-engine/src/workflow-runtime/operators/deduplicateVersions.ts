import type { DataRow } from '../../types.js';
import { asText, parseNumeric } from './fieldUtils.js';
import { normalizeDate } from './normalizeDate.js';

export type DuplicateStrategy = 'VERSION_THEN_UPDATED_AT' | 'UPDATED_AT_ONLY';

export type DeduplicateVersionResult = {
  selected: DataRow[];
  discarded: DataRow[];
  conflicts: DataRow[];
  exactDuplicateCount: number;
  multiVersionDuplicateCount: number;
};

function businessKey(row: DataRow, keys: string[]): string {
  return keys.map((key) => asText(row[key]).toLowerCase()).join('||');
}

function parseVersionRank(value: unknown): number | null {
  const text = asText(value);
  if (!text) return null;
  const num = parseNumeric(text.replace(/^v/i, ''));
  return num;
}

function parseUpdatedAtRank(value: unknown): number | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.getTime();
  const text = asText(value);
  if (!text) return null;
  const asDate = normalizeDate(text);
  if (asDate.ok) {
    const [y, m, d] = asDate.value.split('-').map(Number);
    return Date.UTC(y!, m! - 1, d!);
  }
  const ts = Date.parse(text);
  return Number.isFinite(ts) ? ts : null;
}

function rowsEqual(a: DataRow, b: DataRow, ignoreKeys: Set<string>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (ignoreKeys.has(key)) continue;
    if (asText(a[key]) !== asText(b[key])) return false;
  }
  return true;
}

/**
 * Multi-version plan dedupe.
 * Never silently drops losers — discarded/conflicts are returned for output sheets.
 */
export function deduplicateByVersion(
  rows: DataRow[],
  options: {
    /** Dynamic key builder; default planNo+productCode[+lineCode if present] */
    keyFields?: string[];
    versionField?: string;
    updatedAtField?: string;
    strategy?: DuplicateStrategy;
  } = {},
): DeduplicateVersionResult {
  const versionField = options.versionField ?? 'version';
  const updatedAtField = options.updatedAtField ?? 'updatedAt';
  const strategy = options.strategy ?? 'VERSION_THEN_UPDATED_AT';

  const groups = new Map<string, DataRow[]>();
  for (const row of rows) {
    const fields =
      options.keyFields ??
      (asText(row.lineCode)
        ? ['planNo', 'productCode', 'lineCode']
        : ['planNo', 'productCode']);
    const key = businessKey(row, fields);
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  const selected: DataRow[] = [];
  const discarded: DataRow[] = [];
  const conflicts: DataRow[] = [];
  let exactDuplicateCount = 0;
  let multiVersionDuplicateCount = 0;

  const ignore = new Set([
    '_sourceRow',
    '_sourceFile',
    '_sourceSheet',
    '_inputSha256',
    '_role',
    'selectedSourceTrace',
    'discardedSourceTrace',
  ]);

  for (const [, list] of groups) {
    if (list.length === 1) {
      selected.push({ ...list[0]!, _dedupeStatus: 'UNIQUE' });
      continue;
    }

    // Collapse exact duplicates first.
    const uniqueRows: DataRow[] = [];
    for (const row of list) {
      const found = uniqueRows.find((item) => rowsEqual(item, row, ignore));
      if (found) {
        exactDuplicateCount += 1;
        discarded.push({
          ...row,
          _dedupeStatus: 'EXACT_DUPLICATE',
          selectedSourceTrace: traceOf(found),
          discardedSourceTrace: traceOf(row),
        });
      } else {
        uniqueRows.push(row);
      }
    }

    if (uniqueRows.length === 1) {
      selected.push({ ...uniqueRows[0]!, _dedupeStatus: 'UNIQUE' });
      continue;
    }

    multiVersionDuplicateCount += uniqueRows.length - 1;

    if (strategy === 'UPDATED_AT_ONLY') {
      const ranked = rankByUpdatedAt(uniqueRows, updatedAtField);
      if (!ranked) {
        for (const row of uniqueRows) {
          conflicts.push({
            ...row,
            _dedupeStatus: 'DUPLICATE_CONFLICT',
            selectedSourceTrace: '',
            discardedSourceTrace: traceOf(row),
          });
        }
        continue;
      }
      selected.push({
        ...ranked.winner,
        _dedupeStatus: 'SELECTED',
        selectedSourceTrace: traceOf(ranked.winner),
      });
      for (const row of ranked.losers) {
        discarded.push({
          ...row,
          _dedupeStatus: 'VERSION_SUPERSEDED',
          selectedSourceTrace: traceOf(ranked.winner),
          discardedSourceTrace: traceOf(row),
        });
      }
      continue;
    }

    // VERSION_THEN_UPDATED_AT
    const versionRanks = uniqueRows.map((row) => parseVersionRank(row[versionField]));
    const allHaveVersion = versionRanks.every((value) => value !== null);
    const allMissingVersion = versionRanks.every((value) => value === null);

    if (allHaveVersion) {
      const maxVersion = Math.max(...(versionRanks as number[]));
      const top = uniqueRows.filter(
        (row) => parseVersionRank(row[versionField]) === maxVersion,
      );
      if (top.length === 1) {
        const winner = top[0]!;
        selected.push({
          ...winner,
          _dedupeStatus: 'SELECTED',
          selectedSourceTrace: traceOf(winner),
        });
        for (const row of uniqueRows) {
          if (row === winner) continue;
          discarded.push({
            ...row,
            _dedupeStatus: 'VERSION_SUPERSEDED',
            selectedSourceTrace: traceOf(winner),
            discardedSourceTrace: traceOf(row),
          });
        }
        continue;
      }
      const ranked = rankByUpdatedAt(top, updatedAtField);
      if (!ranked) {
        for (const row of top) {
          conflicts.push({
            ...row,
            _dedupeStatus: 'DUPLICATE_CONFLICT',
            selectedSourceTrace: '',
            discardedSourceTrace: traceOf(row),
          });
        }
        for (const row of uniqueRows) {
          if (top.includes(row)) continue;
          discarded.push({
            ...row,
            _dedupeStatus: 'VERSION_SUPERSEDED',
            selectedSourceTrace: '',
            discardedSourceTrace: traceOf(row),
          });
        }
        continue;
      }
      selected.push({
        ...ranked.winner,
        _dedupeStatus: 'SELECTED',
        selectedSourceTrace: traceOf(ranked.winner),
      });
      for (const row of uniqueRows) {
        if (row === ranked.winner) continue;
        discarded.push({
          ...row,
          _dedupeStatus: 'VERSION_SUPERSEDED',
          selectedSourceTrace: traceOf(ranked.winner),
          discardedSourceTrace: traceOf(row),
        });
      }
      continue;
    }

    if (allMissingVersion) {
      const ranked = rankByUpdatedAt(uniqueRows, updatedAtField);
      if (!ranked) {
        for (const row of uniqueRows) {
          conflicts.push({
            ...row,
            _dedupeStatus: 'DUPLICATE_CONFLICT',
            selectedSourceTrace: '',
            discardedSourceTrace: traceOf(row),
          });
        }
        continue;
      }
      selected.push({
        ...ranked.winner,
        _dedupeStatus: 'SELECTED',
        selectedSourceTrace: traceOf(ranked.winner),
      });
      for (const row of ranked.losers) {
        discarded.push({
          ...row,
          _dedupeStatus: 'VERSION_SUPERSEDED',
          selectedSourceTrace: traceOf(ranked.winner),
          discardedSourceTrace: traceOf(row),
        });
      }
      continue;
    }

    // Mixed version presence → conflict
    for (const row of uniqueRows) {
      conflicts.push({
        ...row,
        _dedupeStatus: 'DUPLICATE_CONFLICT',
        selectedSourceTrace: '',
        discardedSourceTrace: traceOf(row),
      });
    }
  }

  return {
    selected,
    discarded,
    conflicts,
    exactDuplicateCount,
    multiVersionDuplicateCount,
  };
}

function rankByUpdatedAt(
  rows: DataRow[],
  updatedAtField: string,
): { winner: DataRow; losers: DataRow[] } | null {
  const ranked = rows.map((row) => ({
    row,
    rank: parseUpdatedAtRank(row[updatedAtField]),
  }));
  if (ranked.some((item) => item.rank === null)) return null;
  ranked.sort((a, b) => (b.rank! - a.rank!) || 0);
  const topRank = ranked[0]!.rank!;
  const tops = ranked.filter((item) => item.rank === topRank);
  if (tops.length !== 1) return null;
  const winner = tops[0]!.row;
  return {
    winner,
    losers: rows.filter((row) => row !== winner),
  };
}

function traceOf(row: DataRow): string {
  return `${asText(row._sourceFile)}#${asText(row._sourceSheet)}:${asText(row._sourceRow)}`;
}
