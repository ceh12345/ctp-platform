export interface IRawDataPayload {
  resources: unknown[];
  tasks: unknown[];
  // Operations master (Genius operationEntity): OperationCode → GroupCode
  // routing vocabulary consumed by the dispatch preference pass. Optional —
  // only REST tenants with an `operations` endpoint populate it.
  operations?: unknown[];
  calendars: unknown[];
  stateChanges: unknown[];
  products: unknown[];
  orders: unknown[];
  jobs: unknown[];
  materials: unknown[];
  processes: unknown[];
  cadences: unknown[];
  uomConversions: unknown | null;
}

export interface IDataAdapter {
  readonly adapterType: string;
  fetchRawData(): Promise<IRawDataPayload>;
}
