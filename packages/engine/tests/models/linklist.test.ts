import { describe, it, expect } from 'vitest';
import { LinkedList, ListNode } from '../../Models/Core/linklist';

describe('LinkedList', () => {
  describe('insertAtEnd', () => {
    it('inserts into empty list — head and tail point to same node', () => {
      const list = new LinkedList<number>();
      list.insertAtEnd(1);
      expect(list.head?.data).toBe(1);
      expect(list.tail?.data).toBe(1);
      expect(list.head).toBe(list.tail);
      expect(list.head?.prev).toBeNull();
      expect(list.head?.next).toBeNull();
    });

    it('inserts multiple nodes in order', () => {
      const list = new LinkedList<number>();
      list.insertAtEnd(1);
      list.insertAtEnd(2);
      list.insertAtEnd(3);
      expect(list.toArray()).toEqual([1, 2, 3]);
      expect(list.size()).toBe(3);
    });

    it('maintains prev/next pointers correctly', () => {
      const list = new LinkedList<number>();
      const n1 = list.insertAtEnd(10);
      const n2 = list.insertAtEnd(20);
      const n3 = list.insertAtEnd(30);

      expect(n1.prev).toBeNull();
      expect(n1.next).toBe(n2);
      expect(n2.prev).toBe(n1);
      expect(n2.next).toBe(n3);
      expect(n3.prev).toBe(n2);
      expect(n3.next).toBeNull();

      expect(list.head).toBe(n1);
      expect(list.tail).toBe(n3);
    });
  });

  describe('insertAtBegin', () => {
    it('inserts into empty list', () => {
      const list = new LinkedList<number>();
      list.insertAtBegin(1);
      expect(list.head?.data).toBe(1);
      expect(list.tail?.data).toBe(1);
    });

    it('new node becomes head, old head becomes second', () => {
      const list = new LinkedList<number>();
      list.insertAtEnd(2);
      list.insertAtBegin(1);
      expect(list.head?.data).toBe(1);
      expect(list.head?.next?.data).toBe(2);
      expect(list.tail?.data).toBe(2);
      expect(list.tail?.prev?.data).toBe(1);
    });

    it('maintains prev/next pointers', () => {
      const list = new LinkedList<number>();
      const n2 = list.insertAtEnd(2);
      const n1 = list.insertAtBegin(1);
      expect(n1.prev).toBeNull();
      expect(n1.next).toBe(n2);
      expect(n2.prev).toBe(n1);
    });
  });

  describe('insertBefore', () => {
    it('inserts before head — becomes new head', () => {
      const list = new LinkedList<number>();
      const n2 = list.insertAtEnd(2);
      const n1 = list.insertBefore(1, n2);
      expect(list.head).toBe(n1);
      expect(n1.next).toBe(n2);
      expect(n2.prev).toBe(n1);
      expect(list.toArray()).toEqual([1, 2]);
    });

    it('inserts before middle node', () => {
      const list = new LinkedList<number>();
      const n1 = list.insertAtEnd(1);
      const n3 = list.insertAtEnd(3);
      const n2 = list.insertBefore(2, n3);
      expect(list.toArray()).toEqual([1, 2, 3]);
      expect(n1.next).toBe(n2);
      expect(n2.prev).toBe(n1);
      expect(n2.next).toBe(n3);
      expect(n3.prev).toBe(n2);
    });

    it('returns the newly created node', () => {
      const list = new LinkedList<number>();
      const n1 = list.insertAtEnd(1);
      const result = list.insertBefore(0, n1);
      expect(result.data).toBe(0);
      expect(result).toBe(list.head);
    });
  });

  describe('deleteNode', () => {
    it('deletes head — next becomes head with null prev', () => {
      const list = new LinkedList<number>();
      const n1 = list.insertAtEnd(1);
      list.insertAtEnd(2);
      list.deleteNode(n1);
      expect(list.head?.data).toBe(2);
      expect(list.head?.prev).toBeNull();
      expect(list.size()).toBe(1);
    });

    it('deletes tail — prev becomes tail with null next', () => {
      const list = new LinkedList<number>();
      list.insertAtEnd(1);
      const n2 = list.insertAtEnd(2);
      list.deleteNode(n2);
      expect(list.tail?.data).toBe(1);
      expect(list.tail?.next).toBeNull();
      expect(list.size()).toBe(1);
    });

    it('deletes middle node — prev and next link correctly', () => {
      const list = new LinkedList<number>();
      const n1 = list.insertAtEnd(1);
      const n2 = list.insertAtEnd(2);
      const n3 = list.insertAtEnd(3);
      list.deleteNode(n2);
      expect(n1.next).toBe(n3);
      expect(n3.prev).toBe(n1);
      expect(list.toArray()).toEqual([1, 3]);
    });

    it('deletes only node — head and tail become null', () => {
      const list = new LinkedList<number>();
      const n1 = list.insertAtEnd(1);
      list.deleteNode(n1);
      expect(list.head).toBeNull();
      expect(list.tail).toBeNull();
      expect(list.size()).toBe(0);
    });

    it('handles null node gracefully', () => {
      const list = new LinkedList<number>();
      list.insertAtEnd(1);
      list.deleteNode(null);
      expect(list.size()).toBe(1);
    });
  });

  describe('resetMiddle', () => {
    it('sets mid to middle node for even-count list', () => {
      const list = new LinkedList<number>();
      list.insertAtEnd(1);
      list.insertAtEnd(2);
      list.insertAtEnd(3);
      list.insertAtEnd(4);
      list.resetMiddle();
      // size=4, middle = floor(4/2) = 2, so mid is 3rd element (index 2)
      expect(list.mid?.data).toBe(3);
    });

    it('sets mid to middle node for odd-count list', () => {
      const list = new LinkedList<number>();
      list.insertAtEnd(1);
      list.insertAtEnd(2);
      list.insertAtEnd(3);
      list.resetMiddle();
      // size=3, middle = floor(3/2) = 1, so mid is 2nd element (index 1)
      expect(list.mid?.data).toBe(2);
    });

    it('handles empty list', () => {
      const list = new LinkedList<number>();
      list.resetMiddle();
      expect(list.mid).toBeNull();
    });

    it('handles single-node list', () => {
      const list = new LinkedList<number>();
      list.insertAtEnd(1);
      list.resetMiddle();
      expect(list.mid?.data).toBe(1);
    });
  });

  describe('size / toArray / fromArray', () => {
    it('size returns 0 for empty list', () => {
      const list = new LinkedList<number>();
      expect(list.size()).toBe(0);
    });

    it('size returns correct count after insertions', () => {
      const list = new LinkedList<number>();
      list.insertAtEnd(1);
      list.insertAtEnd(2);
      list.insertAtEnd(3);
      expect(list.size()).toBe(3);
    });

    it('toArray returns elements in order', () => {
      const list = new LinkedList<number>();
      list.insertAtEnd(10);
      list.insertAtEnd(20);
      list.insertAtEnd(30);
      expect(list.toArray()).toEqual([10, 20, 30]);
    });

    it('toArray returns empty array for empty list', () => {
      const list = new LinkedList<number>();
      expect(list.toArray()).toEqual([]);
    });

    it('fromArray rebuilds list with correct pointers', () => {
      const list = new LinkedList<number>();
      list.fromArray([5, 10, 15]);
      expect(list.size()).toBe(3);
      expect(list.head?.data).toBe(5);
      expect(list.tail?.data).toBe(15);
      expect(list.head?.next?.data).toBe(10);
      expect(list.tail?.prev?.data).toBe(10);
    });

    it('round-trip: toArray then fromArray preserves order', () => {
      const list = new LinkedList<number>();
      list.insertAtEnd(1);
      list.insertAtEnd(2);
      list.insertAtEnd(3);
      const arr = list.toArray();
      const list2 = new LinkedList<number>();
      list2.fromArray(arr);
      expect(list2.toArray()).toEqual([1, 2, 3]);
    });
  });

  describe('search', () => {
    it('finds existing element', () => {
      const list = new LinkedList<number>();
      list.insertAtEnd(1);
      list.insertAtEnd(2);
      list.insertAtEnd(3);
      const found = list.search((d) => d === 2);
      expect(found?.data).toBe(2);
    });

    it('returns null for missing element', () => {
      const list = new LinkedList<number>();
      list.insertAtEnd(1);
      list.insertAtEnd(2);
      const found = list.search((d) => d === 99);
      expect(found).toBeNull();
    });

    it('returns null for empty list', () => {
      const list = new LinkedList<number>();
      const found = list.search((d) => d === 1);
      expect(found).toBeNull();
    });
  });

  describe('clear', () => {
    it('empties the list', () => {
      const list = new LinkedList<number>();
      list.insertAtEnd(1);
      list.insertAtEnd(2);
      list.insertAtEnd(3);
      list.clear();
      expect(list.head).toBeNull();
      expect(list.tail).toBeNull();
      expect(list.size()).toBe(0);
    });
  });
});
