import { describe, it, expect } from 'vitest';
import { app } from '../src/server';

describe('mock-genius server', () => {
  it('GET /_mock/health returns 200 with ok status', async () => {
    const res = await app.inject({ method: 'GET', url: '/_mock/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', scenario: expect.any(String) });
  });
});
