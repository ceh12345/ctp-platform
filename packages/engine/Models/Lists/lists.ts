"strict";

import { List } from "../Core/list";

import { NameValue, NameValueFilter } from "../Core/namevalue";

export class CTPNameValues extends List<NameValue> {
  constructor() {
    super();
  }

  public sortBySequence(): void {
    this.sort((n1, n2) => {
      if (n1.sequence > n2.sequence) {
        return 1;
      }

      if (n1.sequence < n2.sequence) {
        return -1;
      }

      return 0;
    });
  }
  public debug(): void {
    this.forEach(function (n) {
      if (n.isList()) console.log("List of " + n.name + " " + n.value);
      else console.log(n.name + " " + n.value);
    });
  }
}

export class CTPAttributes extends CTPNameValues {
  constructor() {
    super();
  }
}

export class CTPHierarchies extends CTPNameValues {
  constructor() {
    super();
    this.add(new NameValue("Hierarchy 1"));
    this.add(new NameValue("Hierarchy 2"));
    this.add(new NameValue("Hierarchy 3"));
    this.add(new NameValue("Hierarchy 4"));
    this.add(new NameValue("Hierarchy 5"));
  }

  public get first(): string | undefined {
    return this?.index(0)?.value;
  }
  public get second(): string | undefined {
    return this?.index(1)?.value;
  }
  public get third(): string | undefined {
    return this?.index(2)?.value;
  }
  public get fourth(): string | undefined {
    return this?.index(3)?.value;
  }
  public get fifth(): string | undefined {
    return this?.index(4)?.value;
  }

  public set first(s: string) {
    let n = this?.index(0);
    if (n) n.value = s;
  }
  public set second(s: string) {
    let n = this?.index(1);
    if (n) n.value = s;
  }
  public set third(s: string) {
    let n = this?.index(2);
    if (n) n.value = s;
  }
  public set fourth(s: string) {
    let n = this?.index(3);
    if (n) n.value = s;
  }
  public set fifth(s: string) {
    let n = this?.index(4);
    if (n) n.value = s;
  }
}
export class CTPTags extends CTPNameValues {
  constructor() {
    super();
  }
}

export class CTPNameValueFilters extends List<NameValueFilter> {
  public match(a: NameValue): boolean {
    let list = new CTPNameValues();
    list.add(a);
    let rc = this.matches(list);
    list.clear();

    return rc;
  }

  public matches(attributes: CTPNameValues): boolean {
    let rc = true;

    let orStack = [];

    this.forEach(function (n) {
      attributes.forEach(function (a) {
        rc = rc && a.matches(n);
        if (n.logical == "OR") {
          orStack.push(rc);
          rc = true;
        }
      });
    });

    orStack.push(rc);
    rc = false;
    orStack.forEach(function (o) {
      rc = rc || o;
    });

    return rc;
  }
}
