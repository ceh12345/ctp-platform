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
