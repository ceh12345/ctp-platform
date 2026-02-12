"strict";

export interface INameValue {
  name: string;
  type: string;
  sequence?: number;
  value: string;
  minQty: number;
  maxQty: number;
}

export class NameValue implements INameValue {
  public value: string;
  public minQty: number;
  public maxQty: number;
  public sequence: number | 0;
  public name: string;
  public type: string;

  constructor(name?: string, value?: string, minQty?: number, maxQty?: number) {
    this.name = name ?? "";
    this.value = value ?? "";
    this.minQty = minQty ?? 0;
    this.maxQty = maxQty || Number.MAX_VALUE;
    this.type = "";
    this.sequence = 0;
  }

  public isList(sep: string = ","): boolean {
    return this.value.includes(sep);
  }

  public toList(sep: string = ","): string[] {
    let v: string[] = [];
    if (this.value) v = this.value.split(sep);

    return v;
  }

  protected _matches(v: string, n: string) {
    let rc = false;
    if (n === this.name && v === this.value) rc = true;
    return rc;
  }
  public matches(node: NameValue) {
    let rc = false;
    if (node.name && node.value && this.name && this.value) {
      let il1 = this.isList();
      let il2 = node.isList();
      if (il1 && il2) {
        this.toList().forEach(function (n) {});
      } else if (il1) {
      } else if (il2) {
      } else {
        rc = this._matches(node.value, node.name);
      }
    }
    return rc;
  }
}

export class CTPTag extends NameValue {
  constructor(name?: string, value?: string, minQty?: number, maxQty?: number) {
    super(name, value, minQty, maxQty);
    this.type = "Tag";
  }
}

export class CTPAttribute extends NameValue {
  constructor(name?: string, value?: string, minQty?: number, maxQty?: number) {
    super(name, value, minQty, maxQty);
    this.type = "Attribute";
  }
}

export class CTPHierarchy extends NameValue {
  constructor(name?: string, value?: string, minQty?: number, maxQty?: number) {
    super(name, value, minQty, maxQty);
    this.type = "Hierarchy";
  }
}

export class NameValueFilter extends NameValue {
  public logical: string = "AND";

  constructor(name?: string, value?: string, logical?: string) {
    super(name, value);
    if (logical) this.logical = logical;
    this.type = "NameValueFilter";
  }
}
