# Step 5 — Mapping Config Schema (Hierarchy + Attribute Population)

**Sprint:** SPRINT-workordergroup-entity, step 5
**Scope:** Schema only. No Stafford-specific field bindings (step 6). No live-endpoint wiring (deferred sprint).
**Branch:** main

---

## Purpose

Every `CTPKeyEntity` (order, task, resource, product, and the new `WorkOrderGroup`) already carries:

- `hierarchy: CTPHierarchies` — 5 named, positional slots
- `attributes: CTPAttributes` — open-ended key/value list

This step defines the **generic, tenant-agnostic config schema** that drives how the mapping layer populates those two structures from a client's raw source records. The schema must be expressive enough that adding a new tenant — or switching a single dimension's data source — is a config change, never a code change.

This is the structural foundation. Stafford's actual field bindings are step 6 and must not appear in the schema.

---

## Design principles

1. **Per-entity-type, not global.** Hierarchy and attribute mappings attach to each entity's mapping block. The same dimension (e.g. "Project") may be sourced differently depending on which entity is being populated — directly from a field on one entity, denormalised from a parent on another. The schema must allow per-entity sourcing.

2. **Source is a tagged union.** Each hierarchy slot and each attribute gets its value from one of several resolution strategies (direct field, join, synthetic, constant, composite). A tagged union (`kind` discriminator) keeps the resolver logic clean and lets new strategies be added without breaking existing config.

3. **Switching source ≠ code change.** Moving Customer from synthetic to live must be an edit to one slot's `source` block. The union makes this possible.

4. **Schema present, resolver optionally deferred.** All `kind`s appear in the type. Resolvers for `field`, `constant`, `composite`, `synthetic` are implemented this sprint. The `join` resolver is schema-present but its implementation is deferred to the live-customer sprint — calling code should throw a clear "not yet implemented" if a `join` source is resolved before then.

---

## Schema

### Hierarchy slot mapping

```typescript
/** Which CTPHierarchies position this mapping fills. */
type HierarchySlot = 1 | 2 | 3 | 4 | 5;

interface HierarchySlotMapping {
  /** Target position in CTPHierarchies (first..fifth). */
  slot: HierarchySlot;

  /** Dimension label shown in UI and used for KPI grouping, e.g. "Customer". */
  name: string;

  /** Where the slot's value comes from. */
  source: HierarchyValueSource;
}
```

### Attribute mapping

```typescript
interface AttributeMapping {
  /** Attribute name in CTP, e.g. "Strategy". */
  name: string;

  /** Where the attribute's value comes from. */
  source: AttributeValueSource;

  /**
   * If false (default), the attribute is omitted when the resolved value is
   * null/empty — avoids polluting entities with empty attributes.
   * If true, the attribute is added even with an empty value.
   */
  includeIfEmpty?: boolean;
}
```

### Value sources (shared union)

Hierarchy and attribute sources share most kinds. Defined as one union with a couple of hierarchy-only / attribute-only refinements noted inline.

```typescript
/**
 * Resolution strategy for a hierarchy or attribute value.
 * Discriminated on `kind`.
 */
type ValueSource =
  /** Value is present directly on the source record. */
  | {
      kind: "field";
      field: string;
      /** Optional value transform applied after extraction. */
      transform?: ValueTransform;
    }

  /** Value is fixed for this tenant/entity — same for every record. */
  | {
      kind: "constant";
      value: string;
    }

  /**
   * Value is built from a template referencing one or more source fields.
   * Template tokens use {fieldName}; unresolved tokens render empty.
   * e.g. "{ProjectNumber} - {ProjectName}"
   */
  | {
      kind: "composite";
      template: string;
    }

  /**
   * Value is generated deterministically. Used for offline/test data where a
   * real dimension isn't available but grouping is still wanted.
   * `strategy: "hash-pool"` assigns each record a pool entry by hashing `hashOn`.
   */
  | {
      kind: "synthetic";
      strategy: "hash-pool";
      /** Candidate values assigned by hash. */
      pool: string[];
      /** Source field whose value is hashed to pick a pool entry. */
      hashOn: string;
    }

  /**
   * Value lives on a related record reachable via a join key.
   * SCHEMA PRESENT, RESOLVER DEFERRED to live-customer sprint.
   * e.g. join salesOrderHeaderEntity via SalesOrderHeaderCode, read BillToCustomerName.
   */
  | {
      kind: "join";
      /** Field on the current record holding the join key. */
      via: string;
      /** Endpoint/entity to look up. */
      endpoint: string;
      /** Field to read from the joined record. */
      field: string;
    };

/** Hierarchy values use ValueSource directly. */
type HierarchyValueSource = ValueSource;

/** Attribute values use the same union. */
type AttributeValueSource = ValueSource;

/** Optional post-extraction transforms. Extend as needed. */
type ValueTransform =
  | "trim"
  | "uppercase"
  | "lowercase"
  | "dateToIso";
```

### Entity mapping block

Hierarchy and attribute mappings nest inside each entity's mapping block. The entity-specific scalar field mappings (key, name, sourceStart, etc.) are separate and may already exist or be added by other steps — this step only adds/standardises the `hierarchies` and `attributes` sections.

```typescript
interface EntityMapping {
  /** Which CTP entity this block populates. */
  entityType: "workOrderGroup" | "order" | "task" | "resource" | "product" | string;

  /** Raw source endpoint that feeds this entity. */
  sourceEndpoint: string;

  // ... entity-specific scalar field mappings handled elsewhere ...

  /** Hierarchy slot population for this entity type. Ordered by slot. */
  hierarchies?: HierarchySlotMapping[];

  /** Attribute population for this entity type. */
  attributes?: AttributeMapping[];
}
```

### Tenant customerSource config

Separate from the per-entity mapping, the tenant config gains a `customerSource` block. This is referenced by hierarchy mappings that use the customer dimension, so the mode can be flipped in one place.

```typescript
interface CustomerSourceConfig {
  /** "synthetic" implemented this sprint; "live" deferred. */
  mode: "synthetic" | "live";

  // --- synthetic mode ---
  /** Pool of synthetic customer names. Required when mode === "synthetic". */
  syntheticPool?: string[];
  /** Source field hashed to assign a pool entry. */
  hashOn?: string;

  // --- live mode (schema present, wiring deferred) ---
  /** Endpoint to join for the real customer. */
  endpoint?: string;
  /** Field on the joined record holding the customer name. */
  field?: string;
  /** Field on the current record holding the join key. */
  joinKey?: string;
}
```

> **Note on the relationship between `customerSource` and the hierarchy `source` union:** there are two valid design choices here, and CC should pick the one that fits the existing config conventions better:
>
> - **(a)** The Customer hierarchy slot uses a normal `synthetic` / `join` `ValueSource` inline in its `HierarchySlotMapping`, and `CustomerSourceConfig` is a *convenience indirection* the mapping references. Flipping mode edits `customerSource.mode`, and the resolver consults it.
> - **(b)** The Customer hierarchy slot's `source` *is* derived from `customerSource` at config-load time — i.e. `customerSource` is the single source of truth and the hierarchy mapping just says `{ kind: "tenantCustomerSource" }` or similar.
>
> Lean toward (a) — it keeps the `ValueSource` union the single resolution mechanism and makes `customerSource` just a named, reusable source config. But defer to whatever the existing strategy-config / scoring-config pattern suggests is idiomatic. Flag the choice in the PR.

---

## Resolver sketch (for context — full impl is step 6 wiring)

The mapping engine gains a resolver dispatching on `kind`. Schema step doesn't need the full engine, but the schema must support this shape:

```typescript
function resolveValue(
  source: ValueSource,
  record: RawRecord,
  ctx: MappingContext,   // hash utils; joined-endpoint access (deferred)
): string | null {
  switch (source.kind) {
    case "field": {
      const raw = record[source.field] ?? null;
      return source.transform ? applyTransform(raw, source.transform) : raw;
    }
    case "constant":  return source.value;
    case "composite": return fillTemplate(source.template, record);
    case "synthetic": return hashToPool(record[source.hashOn], source.pool);
    case "join":      throw new Error("join source resolver not implemented (live-customer sprint)");
  }
}
```

---

## CC PROMPT

> **Task: implement step 5 of SPRINT-workordergroup-entity — the mapping config schema for hierarchy and attribute population. Schema only. No Stafford field bindings (step 6), no live-endpoint wiring (deferred sprint).**
>
> **Before writing anything, establish the conventions:**
>
> 1. Read `config/strategy-config.service.ts` (imported by `ctp_service.ts` as `'../../config/strategy-config.service'`). It is the confirmed precedent for tenant-scoped config. Note how it declares its config type, how it's tenant-scoped, how it's registered as a NestJS provider, and how it's consumed. Mirror this pattern.
> 2. Read `config/config.service.ts` (`getTenantId()` lives here). Determine whether the new schema belongs on the tenant config object this manages, or in a sibling service following the strategy-config pattern.
> 3. Locate the existing per-entity mapping config (the thing that already maps WO/task/SO scalar fields). Targeted search only — try globs like `**/config/*config*.ts`, `**/*mapping*.ts`, `**/integration/**`. Do NOT do a wide recursive find (respects CLAUDE.md). If you can't locate it in 2–3 targeted searches, stop and report what you found rather than guessing.
>
> **Then implement the schema** as defined in this doc's Schema section:
>
> - `HierarchySlotMapping`, `AttributeMapping`
> - the shared `ValueSource` union (`field` | `constant` | `composite` | `synthetic` | `join`) with `ValueTransform`
> - `hierarchies?` and `attributes?` sections added to the entity mapping block (wherever entity mappings are defined — extend the existing structure, don't create a parallel one)
> - `CustomerSourceConfig` on the tenant config
>
> **Resolver implementation scope for this sprint:** implement resolvers for `field`, `constant`, `composite`, and `synthetic` (`hash-pool`). The `join` resolver must be schema-present but throw a clear not-yet-implemented error if invoked — it's wired in the live-customer sprint.
>
> **For the `customerSource` ↔ hierarchy-source relationship:** read the note in the schema doc. Lean toward keeping `ValueSource` the single resolution mechanism with `customerSource` as a named reusable config, but defer to whatever the existing config pattern makes idiomatic. State your choice in the PR description.
>
> **Constraints:**
> - Schema only — no Stafford values, no synthetic pool contents, no real field names. Use the types and leave bindings for step 6.
> - All five `ValueSource` kinds in the type; four resolvers live, `join` deferred-with-throw.
> - Optional fields for live mode (`endpoint?`, `field?`, `joinKey?`) present but undefined in synthetic mode — don't stub placeholder values.
> - Mirror the existing config service's provider registration, file location, and naming conventions. Don't invent a new pattern.
>
> **Deliverable:** the schema types, the resolver dispatch (4 live + 1 throwing), provider wiring consistent with strategy-config, and a PR note stating: (a) where you located the existing mapping config, (b) the customerSource/hierarchy-source design choice you made, (c) anything about the existing conventions that diverged from this spec so we can reconcile.
>
> **If the existing mapping-config structure conflicts with the per-entity `hierarchies`/`attributes` nesting proposed here, stop and report the conflict rather than forcing the schema in — the nesting location is a real design decision and I'd rather resolve it than have it guessed.**

---

## Notes for Chris (not for CC)

- The big open design call embedded here is **whether Order/Task carry their own hierarchy mappings or denormalise from their WorkOrderGroup.** This schema supports both (an entity can have a `hierarchies` block or not). You don't have to decide it for step 5 — the schema is agnostic — but it's the first thing to resolve in step 6 when you write Stafford's actual bindings. The per-entity sourcing table (the worksheet I offered) is where that decision gets made.
- `customerSource` design choice (a vs b in the note) — I've told CC to lean (a) but defer to convention. If you have a strong view, override in the prompt before sending.
- The `ValueTransform` list is minimal (`trim`, `uppercase`, `lowercase`, `dateToIso`). Add any you know you'll need — date handling especially may want more given the timezone-aware Genius timestamps.
