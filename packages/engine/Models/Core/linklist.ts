"strict";
export class ListNode<T> {
  public next: ListNode<T> | null = null;
  public prev: ListNode<T> | null = null;
  constructor(public data: T) {}
}

interface ILinkedList<T> {
  insertAtBegin(data: T): ListNode<T>;
  insertAtEnd(data: T): ListNode<T>;
  deleteNode(node: ListNode<T>): void;
  insertBefore(data: T, node: ListNode<T>): ListNode<T>;
  toArray(): T[];
  fromArray(arr: T[]): void;
  size(): number;
  clear(): void;
  search(comparator: (data: T) => boolean): ListNode<T> | null;
  resetMiddle(): void;
}

export class LinkedList<T> implements ILinkedList<T> {
  public head: ListNode<T> | null = null;
  public tail: ListNode<T> | null = null;
  public mid: ListNode<T> | null = null;
  public constructor() {}

  public clear(): void {
    while (this.head) {
      let i = this.tail;
      this.deleteNode(i);
    }
    this.mid = this.head;
    this.tail = this.head;
  }

  public resetMiddle(): void {
    let middle = Math.floor(this.size() / 2);
    this.mid = this.head;

    let c = 0;
    while (c < middle && this.mid) {
      if (this.mid.next) this.mid = this.mid.next;
      c += 1;
    }
  }

  public insertAtEnd(data: T): ListNode<T> {
    const node = new ListNode(data);
    if (!this.tail) {
      this.head = node;
      this.tail = node;
    } else {
      /*
            const getLast = (node: ListNode<T>): ListNode<T> => {
                return node.next ? getLast(node.next) : node;
            };

            const lastNode = getLast(this.head);
            node.prev = lastNode;
            lastNode.next = node;
            */

      node.prev = this.tail;
      this.tail.next = node;

      this.tail = node;
    }
    return node;
  }

  public insertAtBegin(data: T): ListNode<T> {
    const node = new ListNode(data);
    if (!this.head) {
      this.head = node;
      this.tail = node;
    } else {
      this.head.prev = node;
      node.next = this.head;
      this.head = node;
    }
    return node;
  }

  public insertBefore(data: T, node: ListNode<T>): ListNode<T> {
    const node1 = new ListNode(data);

    if (!this.head) {
      this.head = node1;
      this.tail = node1;
    } else if (!node.prev) {
      node1.next = this.head;
      this.head.prev = node1;
      this.head = node1;
    } else if (node.prev) {
      // a -> b -> c
      // a.next = d
      // d.next = b
      // b.prev = d
      // d.prev = a

      node.prev.next = node1;
      node1.prev = node.prev;
      node1.next = node;
      node.prev = node1;
    }
    return node1;
  }

  public deleteNode(node: ListNode<T> | null): void {
    if (!node) return;

    if (!node.prev) {
      this.head = node.next;
      if (this.head) this.head.prev = null;
    } else {
      const prevNode = node.prev;
      prevNode.next = node.next;
      if (node.next) node.next.prev = prevNode;
    }
    if (!node.next) {
      this.tail = node.prev;
      if (this.tail) this.tail.next = null;
    }
  }

  public search(comparator: (data: T) => boolean): ListNode<T> | null {
    const checkNext = (node: ListNode<T>): ListNode<T> | null => {
      if (comparator(node.data)) {
        return node;
      }
      return node.next ? checkNext(node.next) : null;
    };

    return this.head ? checkNext(this.head) : null;
  }

  public toArray(): T[] {
    const array: T[] = [];

    if (!this.head) {
      return array;
    }

    const addToArray = (node: ListNode<T>): T[] => {
      array.push(node.data);
      return node.next ? addToArray(node.next) : array;
    };
    return addToArray(this.head);
  }

  public fromArray(arr: T[]) {
    this.clear();
    for (const res of arr) {
      this.insertAtEnd(res);
    }
  }

  public atleastOne(): boolean {
    if (!this.head) {
      return false;
    }
    return true;
  }
  public size(): number {
    var count: number = 0;

    if (!this.head) {
      return 0;
    }

    const countNodes = (node: ListNode<T>): number => {
      count = count + 1;
      return node.next ? countNodes(node.next) : count;
    };
    return countNodes(this.head);
  }
}
