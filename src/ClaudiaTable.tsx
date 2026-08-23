import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ClaudiaColumn, ClaudiaSort, ClaudiaTableFilter, FetchPage } from './types';

/**
 * ClaudiaTable — paginated, sortable, filterable, searchable, CSV-exportable, mobile-responsive
 * table. Extracted from Lintel's real DataTable.jsx (2026-08-20), which its own source comment
 * already treated as a shared component within Lintel itself ("built once, used by every table
 * in the app") -- the extraction here is making that real, but only within Lintel, into
 * something any Claudia project can use.
 *
 * Two real, different modes, not one forced shape -- checked against PETGI's real
 * TopicsPanel.tsx before deciding this, not assumed: Lintel's real tables do server-side
 * pagination (fetch one page at a time, sort/filter happens in the query) -- the right
 * architecture at Lintel's real scale. PETGI's real TopicsPanel.tsx sorts an already-fetched,
 * in-memory array client-side -- also the right choice for a topic list that never grows large
 * enough to need paging. Forcing PETGI onto server-side pagination would be a real, unforced
 * architecture change, not a reuse win. Forcing Lintel onto client-side fetch-everything would
 * be a real regression at its actual scale. Both are real config here (`mode`), not one
 * pretending to be universal.
 *
 * fetchPage is dependency-injected, not a hardcoded @supabase/supabase-js call -- the original
 * built the query with supabase.from(table)... directly; this component has no opinion on
 * Supabase, GraphQL, or anything else. A caller's fetchPage does whatever real query-building
 * it needs (Supabase, REST, in-memory filtering of a pre-loaded array) and returns
 * {rows, total} -- that's the only contract.
 */
export type ClaudiaTableProps<T> = {
  columns: ClaudiaColumn<T>[];
  searchable?: boolean;
  filters?: ClaudiaTableFilter[];
  defaultSort?: ClaudiaSort;
  urlKey?: string;
  emptyMessage?: string;
  canExport?: boolean;
  csvName?: string;
  rowKey: (row: T) => string;
  /** Bumping this value re-fetches/re-derives the current page -- same purpose as a refresh button. */
  refreshToken?: unknown;
  copy?: Partial<ClaudiaTableCopy>;
} & (
  | { mode: 'server'; fetchPage: FetchPage<T> }
  | { mode: 'client'; rows: T[]; searchColumns?: (keyof T)[] }
);

const PAGE_SIZES = [10, 25, 50, 100];

/**
 * Added 2026-08-20. Every user-facing string this component owns, English defaults -- real
 * gap found in a systematic config audit: 8 strings, including one dynamically-formatted
 * one (the "1-25 of 140" range), were hardcoded with no override path.
 */
export interface ClaudiaTableCopy {
  searchPlaceholder: string;
  exportButton: string;
  loading: string;
  noRows: string;
  noMatches: string;
  perPageSuffix: string; // rendered as "{n} {perPageSuffix}"
  previousButton: string;
  nextButton: string;
  /** Given (from, to, total) -- default renders "1-25 of 140". */
  rangeSummary: (from: number, to: number, total: number) => string;
}
const DEFAULT_COPY: ClaudiaTableCopy = {
  searchPlaceholder: 'Search',
  exportButton: 'Export CSV',
  loading: 'Loading\u2026',
  noRows: 'No rows',
  noMatches: 'Nothing matches that. Clear the search or filters to see everything.',
  perPageSuffix: 'per page',
  previousButton: 'Previous',
  nextButton: 'Next',
  rangeSummary: (from, to, total) => `${from}\u2013${to} of ${total}`,
};

function readUrlState(key: string): Record<string, unknown> {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const raw = params.get(key);
  if (!raw) return {};
  try { return JSON.parse(decodeURIComponent(raw)); } catch { return {}; }
}
function writeUrlState(key: string, state: Record<string, unknown>): void {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const compact = Object.fromEntries(Object.entries(state).filter(([, v]) => v !== '' && v != null));
  if (Object.keys(compact).length === 0) params.delete(key);
  else params.set(key, encodeURIComponent(JSON.stringify(compact)));
  const next = params.toString();
  window.history.replaceState(null, '', next ? `#${next}` : window.location.pathname);
}
function toCsv<T>(rows: T[], columns: ClaudiaColumn<T>[]): string {
  const esc = (v: unknown) => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = columns.map((c) => esc(c.label)).join(',');
  const body = rows.map((r) => columns.map((c) => esc(c.csv ? c.csv(r) : (r as Record<string, unknown>)[c.key])).join(',')).join('\n');
  return `${head}\n${body}`;
}

export default function ClaudiaTable<T>(props: ClaudiaTableProps<T>) {
  const { columns, searchable = false, filters = [], defaultSort, urlKey, emptyMessage = 'Nothing here yet.', canExport = false, csvName = 'export', rowKey, refreshToken, copy: copyProp } = props;
  const copy = { ...DEFAULT_COPY, ...copyProp };

  const saved = useMemo(() => (urlKey ? readUrlState(urlKey) : {}), [urlKey]);
  const [page, setPage] = useState((saved.page as number) ?? 0);
  const [pageSize, setPageSize] = useState((saved.size as number) ?? 25);
  const [search, setSearch] = useState((saved.q as string) ?? '');
  const [sort, setSort] = useState<ClaudiaSort | undefined>((saved.sort as ClaudiaSort) ?? defaultSort);
  const [active, setActive] = useState<Record<string, string>>((saved.f as Record<string, string>) ?? {});
  const [rows, setRows] = useState<T[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Client mode: derive the current page from the given array, no async fetch at all.
  const clientResult = useMemo(() => {
    if (props.mode !== 'client') return null;
    let filtered = props.rows;
    if (search.trim() && props.searchColumns?.length) {
      const term = search.trim().toLowerCase();
      filtered = filtered.filter((r) => props.searchColumns!.some((k) => String((r as Record<string, unknown>)[k as string] ?? '').toLowerCase().includes(term)));
    }
    for (const [key, value] of Object.entries(active)) {
      if (value !== '' && value != null) filtered = filtered.filter((r) => String((r as Record<string, unknown>)[key]) === value);
    }
    if (sort?.column) {
      filtered = [...filtered].sort((a, b) => {
        const va = String((a as Record<string, unknown>)[sort.column] ?? '').toLowerCase();
        const vb = String((b as Record<string, unknown>)[sort.column] ?? '').toLowerCase();
        return (va < vb ? -1 : va > vb ? 1 : 0) * (sort.ascending ? 1 : -1);
      });
    }
    const from = page * pageSize;
    return { rows: filtered.slice(from, from + pageSize), total: filtered.length, all: filtered };
  }, [props.mode, props.mode === 'client' ? props.rows : null, props.mode === 'client' ? props.searchColumns : null, search, active, sort, page, pageSize]);

  const buildServerQuery = useCallback((forExport = false) => {
    if (props.mode !== 'server') return null;
    return props.fetchPage({ page: forExport ? 0 : page, pageSize: forExport ? 1000 : pageSize, search, filters: active, sort });
  }, [props.mode, props.mode === 'server' ? props.fetchPage : null, page, pageSize, search, active, sort]);

  useEffect(() => {
    if (props.mode === 'client') {
      setRows(clientResult!.rows); setTotal(clientResult!.total); setError(null);
      return;
    }
    let cancelled = false;
    setError(null);
    buildServerQuery()!.then((result) => {
      if (cancelled) return;
      setRows(result.rows); setTotal(result.total);
    }).catch((e) => { if (!cancelled) { setError(e instanceof Error ? e.message : String(e)); setRows([]); } });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.mode, clientResult, buildServerQuery, refreshToken]);

  useEffect(() => {
    if (!urlKey) return;
    writeUrlState(urlKey, { page: page || '', size: pageSize === 25 ? '' : pageSize, q: search, sort, f: Object.keys(active).length ? active : '' });
  }, [urlKey, page, pageSize, search, sort, active]);

  function toggleSort(col: ClaudiaColumn<T>) {
    if (!col.sortable) return;
    setPage(0);
    setSort((s) => (s?.column === col.key ? { column: col.key, ascending: !s.ascending } : { column: col.key, ascending: false }));
  }

  async function exportCsv() {
    if (props.mode === 'client') {
      const csv = toCsv(clientResult!.all, columns);
      downloadCsv(csv, csvName);
      return;
    }
    const result = await buildServerQuery(true)!;
    downloadCsv(toCsv(result.rows, columns), csvName);
  }

  const lastPage = Math.max(0, Math.ceil(total / pageSize) - 1);
  const hasControls = searchable || filters.length > 0;

  return (
    <div>
      {hasControls && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
          {searchable && (
            <input className="field" style={{ flex: '1 1 220px', maxWidth: 320 }} type="search"
              placeholder={copy.searchPlaceholder} value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }} />
          )}
          {filters.map((f) => (
            <select key={f.key} className="field" style={{ width: 'auto' }} value={active[f.key] ?? ''}
              onChange={(e) => { setActive({ ...active, [f.key]: e.target.value }); setPage(0); }}>
              <option value="">{f.label}: all</option>
              {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          ))}
          {canExport && rows && rows.length > 0 && (
            <button className="btn quiet" onClick={exportCsv}>{copy.exportButton}</button>
          )}
        </div>
      )}

      {error && <p className="err" style={{ fontSize: '.85rem' }}>{error}</p>}
      {rows === null && <p className="dim" style={{ fontSize: '.85rem' }}>{copy.loading}</p>}

      {rows?.length === 0 && (
        <div className="card" style={{ padding: 22 }}>
          <p className="dim" style={{ fontSize: '.85rem', margin: 0 }}>
            {search || Object.values(active).some(Boolean)
              ? copy.noMatches
              : emptyMessage}
          </p>
        </div>
      )}

      {rows && rows.length > 0 && (
        <>
          <div className="table-wrap card" style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  {columns.map((c) => (
                    <th key={c.key}
                      onClick={() => toggleSort(c)}
                      style={{ cursor: c.sortable ? 'pointer' : 'default', whiteSpace: 'nowrap', textAlign: c.type === 'money' ? 'right' : undefined }}
                      aria-sort={sort?.column === c.key ? (sort.ascending ? 'ascending' : 'descending') : 'none'}>
                      {c.label}
                      {c.sortable && <span className="dim" style={{ fontSize: '.78rem' }}>{sort?.column === c.key ? (sort.ascending ? ' \u2191' : ' \u2193') : ' \u2195'}</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={rowKey(r)}>
                    {columns.map((c) => (
                      <td key={c.key} style={{ textAlign: c.type === 'money' ? 'right' : undefined }} data-label={c.label}>
                        {c.render ? c.render(r) : String((r as Record<string, unknown>)[c.key] ?? '\u2014')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
            <span className="dim" style={{ fontSize: '.82rem' }}>
              {total === 0 ? copy.noRows : copy.rangeSummary(page * pageSize + 1, Math.min((page + 1) * pageSize, total), total)}
            </span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <select className="field" style={{ width: 'auto' }} value={pageSize}
                onChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }}>
                {PAGE_SIZES.map((n) => <option key={n} value={n}>{n} {copy.perPageSuffix}</option>)}
              </select>
              <button className="btn quiet" disabled={page === 0} onClick={() => setPage(page - 1)}>{copy.previousButton}</button>
              <button className="btn quiet" disabled={page >= lastPage} onClick={() => setPage(page + 1)}>{copy.nextButton}</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function downloadCsv(csv: string, csvName: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${csvName}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
