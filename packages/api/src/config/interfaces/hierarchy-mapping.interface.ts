// Generic, tenant-agnostic schema for populating CTPHierarchies + CTPAttributes
// on any CTPKeyEntity. Step 5 of SPRINT-workordergroup-entity.
//
// Stafford field bindings are step 6 and must not appear here.

// ─── Hierarchy ─────────────────────────────────────────────────────────────

/** Position in CTPHierarchies (first..fifth). */
export type HierarchySlot = 1 | 2 | 3 | 4 | 5;

export interface HierarchySlotMapping {
  /** Which CTPHierarchies position this fills. */
  slot: HierarchySlot;

  /** Dimension label shown in UI and used for KPI grouping (e.g. "Customer"). */
  name: string;

  /** How the slot's value is resolved at mapping time. */
  source: ValueSource;
}

// ─── Attributes ────────────────────────────────────────────────────────────

export interface AttributeMapping {
  /** Attribute name on the CTP entity (e.g. "Strategy"). */
  name: string;

  /** How the attribute's value is resolved. */
  source: ValueSource;

  /**
   * When false (default), the attribute is omitted if the resolved value is
   * null or empty — avoids polluting entities with empty attributes.
   * When true, the attribute is added even with an empty value.
   */
  includeIfEmpty?: boolean;
}

// ─── Value sources ─────────────────────────────────────────────────────────

/**
 * Discriminated union over the resolution strategies a hierarchy slot or
 * attribute can use. Adding a new strategy adds a new union member; the
 * resolver in MappingEngine dispatches on `kind`.
 *
 * Implemented this sprint: field, constant, composite, synthetic.
 * Schema-present, resolver throws: join (wired in the live-customer sprint).
 */
export type ValueSource =
  | FieldValueSource
  | ConstantValueSource
  | CompositeValueSource
  | SyntheticValueSource
  | JoinValueSource;

/** Read the value directly from a field on the source record. */
export interface FieldValueSource {
  kind: 'field';
  /** Field name on the raw source record. */
  field: string;
  /** Optional post-extraction transform. */
  transform?: ValueTransform;
}

/** Same value for every record (e.g. all Stafford WOs sit under "Stafford" customer in a single-customer pilot). */
export interface ConstantValueSource {
  kind: 'constant';
  value: string;
}

/**
 * Build the value from a template referencing one or more source fields.
 * Template tokens use {fieldName}. Unresolved tokens render as empty string.
 * Example template: "{ProjectNumber} - {ProjectName}".
 */
export interface CompositeValueSource {
  kind: 'composite';
  template: string;
}

/**
 * Deterministic value chosen from a fixed pool by hashing one of the source
 * record's fields. For offline/test data where the real dimension isn't
 * available but consistent grouping is still wanted (e.g. synthetic-customer
 * mode this sprint).
 */
export interface SyntheticValueSource {
  kind: 'synthetic';
  strategy: 'hash-pool';
  /** Candidate values; the chosen one is determined by hashOn. */
  pool: string[];
  /** Field whose value is hashed to pick a pool entry. */
  hashOn: string;
}

/**
 * Value lives on a related record reachable via a join key.
 * SCHEMA PRESENT, RESOLVER DEFERRED to the live-customer sprint.
 * Example: via=SalesOrderHeaderCode, endpoint=salesOrderHeaderEntity, field=BillToCustomerName.
 */
export interface JoinValueSource {
  kind: 'join';
  /** Field on the current record holding the join key. */
  via: string;
  /** Endpoint/entity to look up. */
  endpoint: string;
  /** Field to read from the joined record. */
  field: string;
}

/** Post-extraction transforms. Extend as needed; resolver applies these AFTER fetching the raw value. */
export type ValueTransform =
  | 'trim'
  | 'uppercase'
  | 'lowercase'
  | 'dateToIso';

// ─── Per-entity mapping shape ──────────────────────────────────────────────

/**
 * The mapping block for one entity type. Extends — does not replace — the
 * existing loose Record<string, any> shape used by orders/tasks/resources
 * today. Old keys (mappings, key, capacityResources, linkId, etc.) still go
 * through as Record entries; the hierarchies/attributes slots are typed.
 *
 * This sprint: applied only to the workOrderGroups slot on IMappingProfile.
 * Other entities stay Record<string, any> until there's a reason to tighten.
 */
export interface EntityMapping {
  /** Optional discriminator — useful for tooling, not enforced. */
  entityType?: string;

  /** Raw source endpoint that feeds this entity. */
  sourceEndpoint?: string;

  /** Existing scalar field rules (key, name, sourceStart, etc.). Shape matches the rule conventions used by MappingEngine.applyRule. */
  mappings?: Record<string, any>;

  /** Hierarchy slot population, ordered by slot. */
  hierarchies?: HierarchySlotMapping[];

  /** Attribute population. */
  attributes?: AttributeMapping[];

  /**
   * Predicate for marking records as cancelled at rollup time. Wired by
   * step 7. An empty `values` array intentionally matches nothing —
   * preserves the current "0 cancelled" behaviour until Decision 5 with
   * Stafford confirms which `Wostatus` strings indicate cancellation,
   * after which resolving it is a one-line config edit.
   */
  cancellationPredicate?: CancellationPredicate;
}

export interface CancellationPredicate {
  /** Source-record field whose value is tested. */
  field: string;
  /** Cancellation-marker values; an exact match counts the record as cancelled. */
  values: string[];
}

