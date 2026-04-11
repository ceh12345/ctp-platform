export interface IRawDataPayload {
  resources: unknown[];
  tasks: unknown[];
  calendars: unknown[];
  stateChanges: unknown[];
  products: unknown[];
  orders: unknown[];
  materials: unknown[];
  processes: unknown[];
  cadences: unknown[];
  uomConversions: unknown | null;
}

export interface IDataAdapter {
  readonly adapterType: string;
  fetchRawData(): Promise<IRawDataPayload>;
}
