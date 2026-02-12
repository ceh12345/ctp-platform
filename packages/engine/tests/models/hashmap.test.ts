import { describe, it, expect } from 'vitest';
import { HashMap, EntityHashMap } from '../../Models/Core/hashmap';
import { CTPEntityHashed } from '../../Models/Core/entity';

describe('HashMap', () => {
  it('add and get returns value', () => {
    const map = new HashMap<string, number>();
    map.add('a', 1);
    expect(map.get('a')).toBe(1);
  });

  it('overwrite with set', () => {
    const map = new HashMap<string, number>();
    map.add('a', 1);
    map.set('a', 2);
    expect(map.get('a')).toBe(2);
  });

  it('remove deletes entry', () => {
    const map = new HashMap<string, number>();
    map.add('a', 1);
    map.remove('a', 1);
    expect(map.contains('a')).toBe(false);
    expect(map.size()).toBe(0);
  });

  it('contains returns true for existing key', () => {
    const map = new HashMap<string, number>();
    map.add('x', 10);
    expect(map.contains('x')).toBe(true);
  });

  it('contains returns false for missing key', () => {
    const map = new HashMap<string, number>();
    expect(map.contains('missing')).toBe(false);
  });

  it('clear empties map, size = 0', () => {
    const map = new HashMap<string, number>();
    map.add('a', 1);
    map.add('b', 2);
    map.clear();
    expect(map.size()).toBe(0);
    expect(map.contains('a')).toBe(false);
  });

  it('keys and values iterators', () => {
    const map = new HashMap<string, number>();
    map.add('a', 1);
    map.add('b', 2);
    const keys = [...map.keys()];
    const values = [...map.values()];
    expect(keys).toContain('a');
    expect(keys).toContain('b');
    expect(values).toContain(1);
    expect(values).toContain(2);
  });

  it('filterMap returns filtered subset', () => {
    const map = new HashMap<string, number>();
    map.add('a', 1);
    map.add('b', 2);
    map.add('c', 3);
    const filtered = map.filterMap((k, v) => v > 1);
    expect(filtered.size).toBe(2);
    expect(filtered.get('b')).toBe(2);
    expect(filtered.get('c')).toBe(3);
  });

  it('toArray returns all values', () => {
    const map = new HashMap<string, number>();
    map.add('a', 1);
    map.add('b', 2);
    const arr = map.toArray();
    expect(arr).toHaveLength(2);
    expect(arr).toContain(1);
    expect(arr).toContain(2);
  });
});

describe('EntityHashMap', () => {
  // Create a minimal CTPEntityHashed subclass for testing
  class TestEntity extends CTPEntityHashed {
    constructor(name: string, key: string) {
      super('Test', name, key);
    }
  }

  it('addEntity and getEntity work with hashKey', () => {
    const map = new EntityHashMap<TestEntity>();
    const entity = new TestEntity('foo', 'k1');
    map.addEntity(entity);
    const retrieved = map.getEntity(entity.hashKey);
    expect(retrieved).toBe(entity);
  });

  it('removeEntity deletes by hashKey', () => {
    const map = new EntityHashMap<TestEntity>();
    const entity = new TestEntity('bar', 'k2');
    map.addEntity(entity);
    map.removeEntity(entity);
    expect(map.getEntity(entity.hashKey)).toBeUndefined();
  });

  it('fromArray populates using hashKey', () => {
    const map = new EntityHashMap<TestEntity>();
    const e1 = new TestEntity('a', 'k1');
    const e2 = new TestEntity('b', 'k2');
    map.fromArray([e1, e2]);
    expect(map.size()).toBe(2);
    expect(map.getEntity(e1.hashKey)).toBe(e1);
    expect(map.getEntity(e2.hashKey)).toBe(e2);
  });

  it('size tracks correctly', () => {
    const map = new EntityHashMap<TestEntity>();
    expect(map.size()).toBe(0);
    map.addEntity(new TestEntity('a', 'k1'));
    expect(map.size()).toBe(1);
    map.addEntity(new TestEntity('b', 'k2'));
    expect(map.size()).toBe(2);
  });
});
