import { describe, it, expect, beforeEach } from "vitest";
import {
  CTPTypedAttributes,
  AttributeDataType,
  ITypedAttribute,
} from "../../Models/Core/typedattribute";
import { CTPKeyEntity } from "../../Models/Core/entity";
import { CTPTask } from "../../Models/Entities/task";
import { CTPResource } from "../../Models/Entities/resource";

describe("CTPTypedAttributes", () => {
  let attrs: CTPTypedAttributes;

  beforeEach(() => {
    attrs = new CTPTypedAttributes();
  });

  // ── Set/Get for all 8 data types ──────────────────────────────────

  describe("set/get for all data types", () => {
    it("string", () => {
      attrs.set("color", "string", "red");
      const attr = attrs.get("color");
      expect(attr).toBeDefined();
      expect(attr!.dataType).toBe("string");
      expect(attr!.value).toEqual({ type: "string", value: "red" });
    });

    it("number", () => {
      attrs.set("weight", "number", 42.5);
      const attr = attrs.get("weight");
      expect(attr).toBeDefined();
      expect(attr!.dataType).toBe("number");
      expect(attr!.value).toEqual({ type: "number", value: 42.5 });
    });

    it("integer", () => {
      attrs.set("count", "integer", 7);
      const attr = attrs.get("count");
      expect(attr).toBeDefined();
      expect(attr!.dataType).toBe("integer");
      expect(attr!.value).toEqual({ type: "integer", value: 7 });
    });

    it("integer floors non-integer input", () => {
      attrs.set("count", "integer", 3.7);
      expect(attrs.get("count")!.value).toEqual({ type: "integer", value: 3 });
    });

    it("boolean", () => {
      attrs.set("active", "boolean", true);
      const attr = attrs.get("active");
      expect(attr).toBeDefined();
      expect(attr!.dataType).toBe("boolean");
      expect(attr!.value).toEqual({ type: "boolean", value: true });
    });

    it("date", () => {
      attrs.set("dueDate", "date", "2025-06-15T08:00:00");
      const attr = attrs.get("dueDate");
      expect(attr).toBeDefined();
      expect(attr!.dataType).toBe("date");
      expect(attr!.value).toEqual({
        type: "date",
        value: "2025-06-15T08:00:00",
      });
    });

    it("enum", () => {
      attrs.set("priority", "enum", "HIGH");
      const attr = attrs.get("priority");
      expect(attr).toBeDefined();
      expect(attr!.dataType).toBe("enum");
      expect(attr!.value).toEqual({ type: "enum", value: "HIGH" });
    });

    it("list", () => {
      attrs.set("tags", "list", ["fast", "urgent", 3]);
      const attr = attrs.get("tags");
      expect(attr).toBeDefined();
      expect(attr!.dataType).toBe("list");
      expect(attr!.value).toEqual({
        type: "list",
        value: ["fast", "urgent", 3],
      });
    });

    it("object", () => {
      attrs.set("meta", "object", { foo: "bar", n: 1 });
      const attr = attrs.get("meta");
      expect(attr).toBeDefined();
      expect(attr!.dataType).toBe("object");
      expect(attr!.value).toEqual({
        type: "object",
        value: { foo: "bar", n: 1 },
      });
    });
  });

  // ── Overwrite ─────────────────────────────────────────────────────

  it("overwrites existing attribute", () => {
    attrs.set("x", "string", "old");
    attrs.set("x", "number", 99);
    expect(attrs.get("x")!.dataType).toBe("number");
    expect(attrs.get("x")!.value).toEqual({ type: "number", value: 99 });
    expect(attrs.size()).toBe(1);
  });

  // ── Category and sequence tracking ────────────────────────────────

  it("tracks category and sequence", () => {
    attrs.set("temp", "number", 200, "environment", 5);
    const attr = attrs.get("temp");
    expect(attr!.category).toBe("environment");
    expect(attr!.sequence).toBe(5);
  });

  it("defaults category to empty string and sequence to 0", () => {
    attrs.set("x", "string", "v");
    const attr = attrs.get("x");
    expect(attr!.category).toBe("");
    expect(attr!.sequence).toBe(0);
  });

  // ── Type-safe getters: correct type ───────────────────────────────

  describe("type-safe getters return correct value for matching type", () => {
    beforeEach(() => {
      attrs.set("s", "string", "hello");
      attrs.set("n", "number", 3.14);
      attrs.set("i", "integer", 10);
      attrs.set("b", "boolean", false);
      attrs.set("d", "date", "2025-01-01T00:00:00");
      attrs.set("e", "enum", "MEDIUM");
      attrs.set("l", "list", [1, "two"]);
      attrs.set("o", "object", { k: "v" });
    });

    it("getString", () => expect(attrs.getString("s")).toBe("hello"));
    it("getNumber", () => expect(attrs.getNumber("n")).toBe(3.14));
    it("getInteger", () => expect(attrs.getInteger("i")).toBe(10));
    it("getBoolean", () => expect(attrs.getBoolean("b")).toBe(false));
    it("getDate", () => expect(attrs.getDate("d")).toBe("2025-01-01T00:00:00"));
    it("getEnum", () => expect(attrs.getEnum("e")).toBe("MEDIUM"));
    it("getList", () => expect(attrs.getList("l")).toEqual([1, "two"]));
    it("getObject", () => expect(attrs.getObject("o")).toEqual({ k: "v" }));
  });

  // ── Type-safe getters: wrong type → undefined ─────────────────────

  describe("type-safe getters return undefined for wrong type", () => {
    beforeEach(() => {
      attrs.set("s", "string", "hello");
      attrs.set("n", "number", 3.14);
      attrs.set("i", "integer", 10);
      attrs.set("b", "boolean", true);
      attrs.set("d", "date", "2025-01-01");
      attrs.set("e", "enum", "HIGH");
      attrs.set("l", "list", [1]);
      attrs.set("o", "object", { x: 1 });
    });

    it("getString on number → undefined", () =>
      expect(attrs.getString("n")).toBeUndefined());
    it("getString on boolean → undefined", () =>
      expect(attrs.getString("b")).toBeUndefined());
    it("getString on list → undefined", () =>
      expect(attrs.getString("l")).toBeUndefined());
    it("getString on object → undefined", () =>
      expect(attrs.getString("o")).toBeUndefined());
    it("getNumber on string → undefined", () =>
      expect(attrs.getNumber("s")).toBeUndefined());
    it("getNumber on boolean → undefined", () =>
      expect(attrs.getNumber("b")).toBeUndefined());
    it("getBoolean on string → undefined", () =>
      expect(attrs.getBoolean("s")).toBeUndefined());
    it("getBoolean on number → undefined", () =>
      expect(attrs.getBoolean("n")).toBeUndefined());
    it("getDate on string → undefined", () =>
      expect(attrs.getDate("s")).toBeUndefined());
    it("getEnum on string → undefined", () =>
      expect(attrs.getEnum("s")).toBeUndefined());
    it("getList on string → undefined", () =>
      expect(attrs.getList("s")).toBeUndefined());
    it("getObject on string → undefined", () =>
      expect(attrs.getObject("s")).toBeUndefined());
    it("getInteger on number → undefined", () =>
      expect(attrs.getInteger("n")).toBeUndefined());
  });

  // ── getString cross-type support ──────────────────────────────────

  describe("getString works for string, enum, and date types", () => {
    it("getString on enum", () => {
      attrs.set("p", "enum", "LOW");
      expect(attrs.getString("p")).toBe("LOW");
    });

    it("getString on date", () => {
      attrs.set("d", "date", "2025-12-25");
      expect(attrs.getString("d")).toBe("2025-12-25");
    });
  });

  // ── getNumber cross-type support ──────────────────────────────────

  describe("getNumber works for number and integer types", () => {
    it("getNumber on integer", () => {
      attrs.set("i", "integer", 42);
      expect(attrs.getNumber("i")).toBe(42);
    });
  });

  // ── Getters on missing attributes ─────────────────────────────────

  describe("getters return undefined for missing attributes", () => {
    it("getString", () => expect(attrs.getString("nope")).toBeUndefined());
    it("getNumber", () => expect(attrs.getNumber("nope")).toBeUndefined());
    it("getInteger", () => expect(attrs.getInteger("nope")).toBeUndefined());
    it("getBoolean", () => expect(attrs.getBoolean("nope")).toBeUndefined());
    it("getDate", () => expect(attrs.getDate("nope")).toBeUndefined());
    it("getEnum", () => expect(attrs.getEnum("nope")).toBeUndefined());
    it("getList", () => expect(attrs.getList("nope")).toBeUndefined());
    it("getObject", () => expect(attrs.getObject("nope")).toBeUndefined());
    it("getRawValue", () => expect(attrs.getRawValue("nope")).toBeUndefined());
  });

  // ── getRawValue ───────────────────────────────────────────────────

  it("getRawValue returns value regardless of type", () => {
    attrs.set("n", "number", 7);
    expect(attrs.getRawValue("n")).toBe(7);
    attrs.set("l", "list", [1, 2]);
    expect(attrs.getRawValue("l")).toEqual([1, 2]);
  });

  // ── has / remove / clear / size / names ───────────────────────────

  describe("collection operations", () => {
    it("has returns true for existing, false for missing", () => {
      attrs.set("a", "string", "v");
      expect(attrs.has("a")).toBe(true);
      expect(attrs.has("z")).toBe(false);
    });

    it("remove deletes attribute and returns true", () => {
      attrs.set("a", "string", "v");
      expect(attrs.remove("a")).toBe(true);
      expect(attrs.has("a")).toBe(false);
      expect(attrs.size()).toBe(0);
    });

    it("remove returns false for missing attribute", () => {
      expect(attrs.remove("nope")).toBe(false);
    });

    it("clear removes all attributes", () => {
      attrs.set("a", "string", "1");
      attrs.set("b", "number", 2);
      attrs.clear();
      expect(attrs.size()).toBe(0);
      expect(attrs.has("a")).toBe(false);
    });

    it("size tracks count", () => {
      expect(attrs.size()).toBe(0);
      attrs.set("a", "string", "1");
      attrs.set("b", "string", "2");
      expect(attrs.size()).toBe(2);
    });

    it("names returns all attribute names", () => {
      attrs.set("x", "string", "1");
      attrs.set("y", "number", 2);
      attrs.set("z", "boolean", true);
      expect(attrs.names().sort()).toEqual(["x", "y", "z"]);
    });
  });

  // ── forEach ───────────────────────────────────────────────────────

  it("forEach iterates all attributes", () => {
    attrs.set("a", "string", "1");
    attrs.set("b", "number", 2);
    attrs.set("c", "boolean", true);
    const collected: string[] = [];
    attrs.forEach((attr, name) => {
      collected.push(name);
    });
    expect(collected.sort()).toEqual(["a", "b", "c"]);
  });

  // ── toArray / fromArray round-trip ────────────────────────────────

  describe("toArray / fromArray", () => {
    it("round-trips correctly", () => {
      attrs.set("s", "string", "hello", "cat1", 1);
      attrs.set("n", "number", 3.14, "cat2", 2);
      attrs.set("i", "integer", 7, "cat3", 3);
      attrs.set("b", "boolean", true, "", 0);
      attrs.set("d", "date", "2025-06-15", "dates", 4);
      attrs.set("e", "enum", "HIGH", "priority", 5);
      attrs.set("l", "list", ["a", 1], "tags", 6);
      attrs.set("o", "object", { k: "v" }, "meta", 7);

      const arr = attrs.toArray();
      expect(arr).toHaveLength(8);

      const restored = new CTPTypedAttributes();
      restored.fromArray(arr);

      expect(restored.size()).toBe(8);
      expect(restored.getString("s")).toBe("hello");
      expect(restored.getNumber("n")).toBe(3.14);
      expect(restored.getInteger("i")).toBe(7);
      expect(restored.getBoolean("b")).toBe(true);
      expect(restored.getDate("d")).toBe("2025-06-15");
      expect(restored.getEnum("e")).toBe("HIGH");
      expect(restored.getList("l")).toEqual(["a", 1]);
      expect(restored.getObject("o")).toEqual({ k: "v" });

      // Verify category and sequence survive
      expect(restored.get("s")!.category).toBe("cat1");
      expect(restored.get("s")!.sequence).toBe(1);
      expect(restored.get("o")!.category).toBe("meta");
      expect(restored.get("o")!.sequence).toBe(7);
    });

    it("fromArray clears existing attributes", () => {
      attrs.set("old", "string", "stale");
      attrs.fromArray([
        {
          name: "new",
          dataType: "number",
          value: { type: "number", value: 42 },
          category: "",
          sequence: 0,
        },
      ]);
      expect(attrs.has("old")).toBe(false);
      expect(attrs.getNumber("new")).toBe(42);
      expect(attrs.size()).toBe(1);
    });
  });

  // ── fromNameValuePairs ────────────────────────────────────────────

  describe("fromNameValuePairs", () => {
    it("imports as string type and merges without clearing", () => {
      attrs.set("existing", "number", 100);
      attrs.fromNameValuePairs([
        { name: "color", value: "red" },
        { name: "size", value: "large", type: "Attribute", sequence: 3 },
      ]);
      // Existing attribute preserved
      expect(attrs.getNumber("existing")).toBe(100);
      // New attributes imported as string
      expect(attrs.getString("color")).toBe("red");
      expect(attrs.getString("size")).toBe("large");
      expect(attrs.get("size")!.category).toBe("Attribute");
      expect(attrs.get("size")!.sequence).toBe(3);
      expect(attrs.size()).toBe(3);
    });

    it("defaults type to empty and sequence to 0", () => {
      attrs.fromNameValuePairs([{ name: "x", value: "v" }]);
      expect(attrs.get("x")!.category).toBe("");
      expect(attrs.get("x")!.sequence).toBe(0);
    });
  });

  // ── toNameValuePairs ──────────────────────────────────────────────

  describe("toNameValuePairs", () => {
    it("converts all types to string representation", () => {
      attrs.set("s", "string", "hello", "cat", 1);
      attrs.set("n", "number", 42.5);
      attrs.set("i", "integer", 7);
      attrs.set("b", "boolean", true);
      attrs.set("d", "date", "2025-01-01");
      attrs.set("e", "enum", "HIGH");
      attrs.set("l", "list", ["a", "b", 3]);
      attrs.set("o", "object", { k: "v" });

      const pairs = attrs.toNameValuePairs();
      const byName = new Map(pairs.map((p) => [p.name, p]));

      expect(byName.get("s")!.value).toBe("hello");
      expect(byName.get("n")!.value).toBe("42.5");
      expect(byName.get("i")!.value).toBe("7");
      expect(byName.get("b")!.value).toBe("true");
      expect(byName.get("d")!.value).toBe("2025-01-01");
      expect(byName.get("e")!.value).toBe("HIGH");
      expect(byName.get("l")!.value).toBe("a,b,3");
      expect(byName.get("o")!.value).toBe('{"k":"v"}');

      // Category and sequence preserved
      expect(byName.get("s")!.type).toBe("cat");
      expect(byName.get("s")!.sequence).toBe(1);
    });
  });

  // ── createValue static helper edge cases ──────────────────────────

  describe("createValue edge cases", () => {
    it("list from non-array wraps in single-element array", () => {
      const val = CTPTypedAttributes.createValue("list", "solo");
      expect(val).toEqual({ type: "list", value: ["solo"] });
    });

    it("object from non-object returns empty {}", () => {
      const val = CTPTypedAttributes.createValue("object", "notAnObject");
      expect(val).toEqual({ type: "object", value: {} });
    });

    it("object from array returns empty {}", () => {
      const val = CTPTypedAttributes.createValue("object", [1, 2]);
      expect(val).toEqual({ type: "object", value: {} });
    });

    it("object from null returns empty {}", () => {
      const val = CTPTypedAttributes.createValue("object", null);
      expect(val).toEqual({ type: "object", value: {} });
    });

    it("unknown type falls back to string", () => {
      const val = CTPTypedAttributes.createValue(
        "unknown" as AttributeDataType,
        123,
      );
      expect(val).toEqual({ type: "string", value: "123" });
    });

    it("integer floors negative decimals", () => {
      const val = CTPTypedAttributes.createValue("integer", -2.9);
      expect(val).toEqual({ type: "integer", value: -3 });
    });
  });

  // ── Integration: CTPKeyEntity ─────────────────────────────────────

  describe("CTPKeyEntity integration", () => {
    it("has both attributes and typedAttributes", () => {
      const entity = new CTPKeyEntity("type", "name", "key");
      expect(entity.attributes).toBeDefined();
      expect(entity.typedAttributes).toBeDefined();
      expect(entity.typedAttributes).toBeInstanceOf(CTPTypedAttributes);
    });

    it("typedAttributes is independent of attributes", () => {
      const entity = new CTPKeyEntity();
      entity.typedAttributes.set("typed", "number", 42);
      expect(entity.typedAttributes.getNumber("typed")).toBe(42);
      // Legacy attributes unaffected
      expect(entity.attributes.length).toBe(0);
    });
  });

  // ── Integration: CTPTask ──────────────────────────────────────────

  describe("CTPTask integration", () => {
    it("inherits typedAttributes and can set/get typed values", () => {
      const task = new CTPTask("PROCESS", "Task-1", "T1");
      task.typedAttributes.set("priority", "enum", "HIGH");
      task.typedAttributes.set("weight", "number", 5.5);
      task.typedAttributes.set("tags", "list", ["rush", "vip"]);

      expect(task.typedAttributes.getEnum("priority")).toBe("HIGH");
      expect(task.typedAttributes.getNumber("weight")).toBe(5.5);
      expect(task.typedAttributes.getList("tags")).toEqual(["rush", "vip"]);
    });
  });

  // ── Integration: CTPResource ──────────────────────────────────────

  describe("CTPResource integration", () => {
    it("inherits typedAttributes and can set/get typed values", () => {
      const resource = new CTPResource("REUSABLE", "Machines", "Machine-A", "M-A");
      resource.typedAttributes.set("speed", "number", 120);
      resource.typedAttributes.set("active", "boolean", true);
      resource.typedAttributes.set("config", "object", { mode: "auto" });

      expect(resource.typedAttributes.getNumber("speed")).toBe(120);
      expect(resource.typedAttributes.getBoolean("active")).toBe(true);
      expect(resource.typedAttributes.getObject("config")).toEqual({
        mode: "auto",
      });
    });
  });
});
