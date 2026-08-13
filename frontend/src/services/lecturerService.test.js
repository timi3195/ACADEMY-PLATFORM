import { afterEach, describe, expect, it, vi } from 'vitest';
import apiClient from './apiClient';
import lecturerService, { normalizeSalesResponse } from './lecturerService';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('normalizeSalesResponse', () => {
  it('returns an empty sales array when the response is empty', () => {
    expect(normalizeSalesResponse({})).toEqual({
      sales: [],
      total: 0,
      count: 0,
      page: 1,
      limit: 20
    });
  });

  it('accepts a direct sales array response', () => {
    const sales = [{ _id: '1', studentName: 'Ada' }];

    expect(normalizeSalesResponse({ sales, total: 1, count: 1, page: 1, limit: 20 })).toEqual({
      sales,
      total: 1,
      count: 1,
      page: 1,
      limit: 20
    });
  });

  it('handles the current nested backend response contract', () => {
    const payload = {
      success: true,
      sales: {
        sales: [],
        total: 0,
        count: 0,
        page: 1,
        limit: 20
      }
    };

    expect(normalizeSalesResponse(payload)).toEqual({
      sales: [],
      total: 0,
      count: 0,
      page: 1,
      limit: 20
    });
  });

  it('defensively handles malformed or null sales payloads', () => {
    expect(normalizeSalesResponse(null)).toEqual({
      sales: [],
      total: 0,
      count: 0,
      page: 1,
      limit: 20
    });

    expect(normalizeSalesResponse({ sales: null, total: null, count: null, page: null, limit: null })).toEqual({
      sales: [],
      total: 0,
      count: 0,
      page: 1,
      limit: 20
    });
  });

  it('preserves pagination metadata from nested payloads', () => {
    const payload = {
      sales: {
        sales: [{ _id: '1' }, { _id: '2' }],
        total: 42,
        count: 2,
        page: 3,
        limit: 10
      }
    };

    expect(normalizeSalesResponse(payload)).toEqual({
      sales: [{ _id: '1' }, { _id: '2' }],
      total: 42,
      count: 2,
      page: 3,
      limit: 10
    });
  });
});

describe('lecturerService.getSales', () => {
  it('normalizes the nested backend response before returning it to the UI', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: {
        success: true,
        sales: {
          sales: [{ _id: 'sale-1', studentName: 'Ada Lovelace' }],
          total: 1,
          count: 1,
          page: 1,
          limit: 20
        }
      }
    });

    await expect(lecturerService.getSales()).resolves.toEqual({
      sales: [{ _id: 'sale-1', studentName: 'Ada Lovelace' }],
      total: 1,
      count: 1,
      page: 1,
      limit: 20
    });
  });
});
