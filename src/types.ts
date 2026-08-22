import type { ReactNode } from 'react';

export interface ClaudiaColumn<T> {
  key: string;
  label: string;
  sortable?: boolean;
  /** money/date get right-alignment and the mobile stacked-card label treatment automatically. */
  type?: 'text' | 'money' | 'date';
  render?: (row: T) => ReactNode;
  csv?: (row: T) => string;
}

export interface ClaudiaTableFilter {
  key: string;
  label: string;
  options: { value: string; label: string }[];
}

export interface ClaudiaSort { column: string; ascending: boolean }

export interface FetchPageParams {
  page: number; pageSize: number; search: string;
  filters: Record<string, string>; sort: ClaudiaSort | undefined;
}
export interface FetchPageResult<T> { rows: T[]; total: number }
export type FetchPage<T> = (params: FetchPageParams) => Promise<FetchPageResult<T>>;
