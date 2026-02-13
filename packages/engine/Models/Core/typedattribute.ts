export type AttributeDataType =
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "date"
  | "enum"
  | "list"
  | "object";

export type AttributeValue =
  | { type: "string"; value: string }
  | { type: "number"; value: number }
  | { type: "integer"; value: number }
  | { type: "boolean"; value: boolean }
  | { type: "date"; value: string }
  | { type: "enum"; value: string }
  | { type: "list"; value: (string | number)[] }
  | { type: "object"; value: Record<string, unknown> };

export interface ITypedAttribute {
  name: string;
  dataType: AttributeDataType;
  value: AttributeValue;
  category: string;
  sequence: number;
}

export class CTPTypedAttributes {
  private map: Map<string, ITypedAttribute> = new Map();

  public set(
    name: string,
    dataType: AttributeDataType,
    rawValue: unknown,
    category: string = "",
    sequence: number = 0,
  ): void {
    const value = CTPTypedAttributes.createValue(dataType, rawValue);
    this.map.set(name, { name, dataType, value, category, sequence });
  }

  public get(name: string): ITypedAttribute | undefined {
    return this.map.get(name);
  }

  public has(name: string): boolean {
    return this.map.has(name);
  }

  public remove(name: string): boolean {
    return this.map.delete(name);
  }

  public clear(): void {
    this.map.clear();
  }

  public size(): number {
    return this.map.size;
  }

  public names(): string[] {
    return Array.from(this.map.keys());
  }

  public forEach(
    callbackfn: (attr: ITypedAttribute, name: string) => void,
  ): void {
    this.map.forEach((attr, name) => callbackfn(attr, name));
  }

  // Type-safe getters

  public getString(name: string): string | undefined {
    const attr = this.map.get(name);
    if (!attr) return undefined;
    if (
      attr.value.type === "string" ||
      attr.value.type === "enum" ||
      attr.value.type === "date"
    )
      return attr.value.value as string;
    return undefined;
  }

  public getNumber(name: string): number | undefined {
    const attr = this.map.get(name);
    if (!attr) return undefined;
    if (attr.value.type === "number" || attr.value.type === "integer")
      return attr.value.value as number;
    return undefined;
  }

  public getInteger(name: string): number | undefined {
    const attr = this.map.get(name);
    if (!attr) return undefined;
    if (attr.value.type === "integer") return attr.value.value as number;
    return undefined;
  }

  public getBoolean(name: string): boolean | undefined {
    const attr = this.map.get(name);
    if (!attr) return undefined;
    if (attr.value.type === "boolean") return attr.value.value as boolean;
    return undefined;
  }

  public getDate(name: string): string | undefined {
    const attr = this.map.get(name);
    if (!attr) return undefined;
    if (attr.value.type === "date") return attr.value.value as string;
    return undefined;
  }

  public getEnum(name: string): string | undefined {
    const attr = this.map.get(name);
    if (!attr) return undefined;
    if (attr.value.type === "enum") return attr.value.value as string;
    return undefined;
  }

  public getList(name: string): (string | number)[] | undefined {
    const attr = this.map.get(name);
    if (!attr) return undefined;
    if (attr.value.type === "list")
      return attr.value.value as (string | number)[];
    return undefined;
  }

  public getObject(name: string): Record<string, unknown> | undefined {
    const attr = this.map.get(name);
    if (!attr) return undefined;
    if (attr.value.type === "object")
      return attr.value.value as Record<string, unknown>;
    return undefined;
  }

  public getRawValue(name: string): unknown {
    const attr = this.map.get(name);
    if (!attr) return undefined;
    return attr.value.value;
  }

  // Serialization

  public toArray(): ITypedAttribute[] {
    return Array.from(this.map.values());
  }

  public fromArray(arr: ITypedAttribute[]): void {
    this.map.clear();
    for (const item of arr) {
      this.map.set(item.name, {
        name: item.name,
        dataType: item.dataType,
        value: CTPTypedAttributes.createValue(item.dataType, item.value.value),
        category: item.category,
        sequence: item.sequence,
      });
    }
  }

  // Legacy interop

  public fromNameValuePairs(
    pairs: { name: string; value: string; type?: string; sequence?: number }[],
  ): void {
    for (const pair of pairs) {
      this.set(pair.name, "string", pair.value, pair.type ?? "", pair.sequence ?? 0);
    }
  }

  public toNameValuePairs(): { name: string; value: string; type: string; sequence: number }[] {
    const result: { name: string; value: string; type: string; sequence: number }[] = [];
    this.map.forEach((attr) => {
      let strValue: string;
      const v = attr.value.value;
      if (attr.value.type === "list") {
        strValue = (v as (string | number)[]).join(",");
      } else if (attr.value.type === "object") {
        strValue = JSON.stringify(v);
      } else {
        strValue = String(v);
      }
      result.push({
        name: attr.name,
        value: strValue,
        type: attr.category,
        sequence: attr.sequence,
      });
    });
    return result;
  }

  // Factory

  public static createValue(
    dataType: AttributeDataType,
    rawValue: unknown,
  ): AttributeValue {
    switch (dataType) {
      case "string":
        return { type: "string", value: String(rawValue ?? "") };
      case "number":
        return { type: "number", value: Number(rawValue) || 0 };
      case "integer":
        return { type: "integer", value: Math.floor(Number(rawValue) || 0) };
      case "boolean":
        return { type: "boolean", value: Boolean(rawValue) };
      case "date":
        return { type: "date", value: String(rawValue ?? "") };
      case "enum":
        return { type: "enum", value: String(rawValue ?? "") };
      case "list": {
        const arr = Array.isArray(rawValue) ? rawValue : [rawValue];
        return { type: "list", value: arr as (string | number)[] };
      }
      case "object": {
        const obj =
          rawValue !== null &&
          typeof rawValue === "object" &&
          !Array.isArray(rawValue)
            ? (rawValue as Record<string, unknown>)
            : {};
        return { type: "object", value: obj };
      }
      default:
        return { type: "string", value: String(rawValue ?? "") };
    }
  }
}
