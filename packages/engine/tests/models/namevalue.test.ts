import { describe, it, expect } from 'vitest';
import { NameValue, CTPTag, CTPAttribute, NameValueFilter } from '../../Models/Core/namevalue';

describe('NameValue', () => {
  it('constructor defaults', () => {
    const nv = new NameValue();
    expect(nv.name).toBe('');
    expect(nv.value).toBe('');
    expect(nv.minQty).toBe(0);
    expect(nv.maxQty).toBe(Number.MAX_VALUE);
    expect(nv.type).toBe('');
    expect(nv.sequence).toBe(0);
  });

  it('constructor with arguments', () => {
    const nv = new NameValue('color', 'red', 1, 10);
    expect(nv.name).toBe('color');
    expect(nv.value).toBe('red');
    expect(nv.minQty).toBe(1);
    expect(nv.maxQty).toBe(10);
  });

  it('isList returns true for comma-separated value', () => {
    const nv = new NameValue('tags', 'a,b,c');
    expect(nv.isList()).toBe(true);
  });

  it('isList returns false for single value', () => {
    const nv = new NameValue('tag', 'single');
    expect(nv.isList()).toBe(false);
  });

  it('isList with custom separator', () => {
    const nv = new NameValue('vals', 'a|b|c');
    expect(nv.isList('|')).toBe(true);
    expect(nv.isList(',')).toBe(false);
  });

  it('toList splits on comma', () => {
    const nv = new NameValue('tags', 'a,b,c');
    expect(nv.toList()).toEqual(['a', 'b', 'c']);
  });

  it('toList with custom separator', () => {
    const nv = new NameValue('tags', 'x|y');
    expect(nv.toList('|')).toEqual(['x', 'y']);
  });

  it('toList returns empty array for empty value', () => {
    const nv = new NameValue('tags', '');
    expect(nv.toList()).toEqual([]);
  });

  it('matches returns true for exact name+value match', () => {
    const a = new NameValue('color', 'red');
    const b = new NameValue('color', 'red');
    expect(a.matches(b)).toBe(true);
  });

  it('matches returns false for value mismatch', () => {
    const a = new NameValue('color', 'red');
    const b = new NameValue('color', 'blue');
    expect(a.matches(b)).toBe(false);
  });

  it('matches returns false for name mismatch', () => {
    const a = new NameValue('color', 'red');
    const b = new NameValue('size', 'red');
    expect(a.matches(b)).toBe(false);
  });
});

describe('CTPTag', () => {
  it('sets type to Tag', () => {
    const tag = new CTPTag('priority', 'high');
    expect(tag.type).toBe('Tag');
    expect(tag.name).toBe('priority');
    expect(tag.value).toBe('high');
  });
});

describe('CTPAttribute', () => {
  it('sets type to Attribute', () => {
    const attr = new CTPAttribute('speed', 'fast');
    expect(attr.type).toBe('Attribute');
  });
});

describe('NameValueFilter', () => {
  it('defaults logical to AND', () => {
    const f = new NameValueFilter('name', 'val');
    expect(f.logical).toBe('AND');
    expect(f.type).toBe('NameValueFilter');
  });

  it('accepts custom logical', () => {
    const f = new NameValueFilter('name', 'val', 'OR');
    expect(f.logical).toBe('OR');
  });
});
