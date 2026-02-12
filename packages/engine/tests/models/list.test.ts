import { describe, it, expect } from 'vitest';
import { List, List1 } from '../../Models/Core/list';

describe('List', () => {
  describe('add / length', () => {
    it('adds element and length increases', () => {
      const list = new List<number>();
      list.add(1);
      expect(list.length).toBe(1);
    });

    it('adds multiple elements', () => {
      const list = new List<number>();
      list.add(1);
      list.add(2);
      list.add(3);
      expect(list.length).toBe(3);
    });
  });

  describe('remove', () => {
    it('removes existing element', () => {
      const list = new List<number>();
      list.add(1);
      list.add(2);
      list.add(3);
      list.remove(2);
      expect(list.length).toBe(2);
      expect(list.contains(2)).toBe(false);
    });

    it('removes element at index 0', () => {
      const list = new List<number>();
      list.add(1);
      list.add(2);
      list.remove(1);
      expect(list.length).toBe(1);
      expect(list.index(0)).toBe(2);
    });

    it('no-op for missing element', () => {
      const list = new List<number>();
      list.add(1);
      list.remove(99);
      expect(list.length).toBe(1);
    });

    it('removes from single-element list', () => {
      const list = new List<number>();
      list.add(1);
      list.remove(1);
      expect(list.length).toBe(0);
    });
  });

  describe('contains', () => {
    it('returns true for present element', () => {
      const list = new List<number>();
      list.add(5);
      expect(list.contains(5)).toBe(true);
    });

    it('returns false for absent element', () => {
      const list = new List<number>();
      list.add(5);
      expect(list.contains(99)).toBe(false);
    });
  });

  describe('index', () => {
    it('returns element at valid index', () => {
      const list = new List<string>();
      list.add('a');
      list.add('b');
      list.add('c');
      expect(list.index(1)).toBe('b');
    });

    it('returns undefined for out-of-bounds', () => {
      const list = new List<number>();
      list.add(1);
      expect(list.index(5)).toBeUndefined();
    });
  });

  describe('clear', () => {
    it('empties the list, length = 0', () => {
      const list = new List<number>();
      list.add(1);
      list.add(2);
      list.clear();
      expect(list.length).toBe(0);
    });
  });

  describe('insertAfter', () => {
    it('inserts at specified position', () => {
      const list = new List<number>();
      list.add(1);
      list.add(3);
      list.insertAfter(2, 1);
      expect(list.index(0)).toBe(1);
      expect(list.index(1)).toBe(2);
      expect(list.index(2)).toBe(3);
    });
  });
});

describe('List1', () => {
  it('add and remove work correctly', () => {
    const list = new List1<number>();
    list.add(10);
    list.add(20);
    expect(list.length()).toBe(2);
    list.remove(10);
    expect(list.length()).toBe(1);
    expect(list.index(0)).toBe(20);
  });

  it('contains returns correct results', () => {
    const list = new List1<number>();
    list.add(5);
    expect(list.contains(5)).toBe(true);
    expect(list.contains(99)).toBe(false);
  });

  it('clear empties the list', () => {
    const list = new List1<number>();
    list.add(1);
    list.add(2);
    list.clear();
    expect(list.length()).toBe(0);
  });
});
