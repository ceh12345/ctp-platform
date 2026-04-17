export interface GeniusResponse<T = unknown> {
  Result: T[];
  Messages: unknown[];
  PagingInfos: {
    CurrentPageIndex: number;
    PageSize: number;
    TotalElementsFound: number;
    TotalPagesFound: number;
    English: string;
    French: string;
  };
  Tag: null;
}

export function geniusEnvelope<T>(records: T[], pageSize = 100): GeniusResponse<T> {
  return {
    Result: records,
    Messages: [],
    PagingInfos: {
      CurrentPageIndex: 1,
      PageSize: pageSize,
      TotalElementsFound: records.length,
      TotalPagesFound: 1,
      English: `${records.length} record(s) found`,
      French: `${records.length} enregistrement(s) trouvé(s)`,
    },
    Tag: null,
  };
}

// Paginated envelope — slices the full record set to the requested page and
// reports the correct PagingInfos so adapters that consume all pages can loop.
export function geniusPagedEnvelope<T>(
  allRecords: T[],
  pageIndex: number,
  pageSize: number,
): GeniusResponse<T> {
  const total = allRecords.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.max(1, Math.min(pageIndex, totalPages));
  const start = (page - 1) * pageSize;
  const slice = allRecords.slice(start, start + pageSize);
  return {
    Result: slice,
    Messages: [],
    PagingInfos: {
      CurrentPageIndex: page,
      PageSize: pageSize,
      TotalElementsFound: total,
      TotalPagesFound: totalPages,
      English: `${total} record(s) found, page ${page}/${totalPages}`,
      French: `${total} enregistrement(s) trouvé(s), page ${page}/${totalPages}`,
    },
    Tag: null,
  };
}
