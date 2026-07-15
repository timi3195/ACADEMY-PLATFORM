import { beforeEach, describe, expect, it } from 'vitest';
import { createProgressEntry, getProgressPercent, normalizeProgressEntry, clearPendingPurchase, loadLatestPurchase, loadPendingPurchase, saveLatestPurchase, savePendingPurchase } from './libraryState';

const createMemoryStorage = () => {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
    clear() {
      values.clear();
    }
  };
};

beforeEach(() => {
  globalThis.localStorage = createMemoryStorage();
});

describe('getProgressPercent', () => {
  it('returns a percentage capped between 0 and 100', () => {
    expect(getProgressPercent(4, 10)).toBe(40);
    expect(getProgressPercent(12, 10)).toBe(100);
    expect(getProgressPercent(0, 0)).toBe(0);
  });
});

describe('normalizeProgressEntry', () => {
  it('normalizes progress data for storage', () => {
    const entry = normalizeProgressEntry({ materialId: 'material-1', lastPage: 3, totalPages: 8, lastOpened: '2026-07-15T10:00:00.000Z' });

    expect(entry.materialId).toBe('material-1');
    expect(entry.lastPage).toBe(3);
    expect(entry.totalPages).toBe(8);
    expect(entry.percentCompleted).toBe(37.5);
    expect(entry.lastOpened).toBe('2026-07-15T10:00:00.000Z');
  });
});

describe('createProgressEntry', () => {
  it('creates a consistent progress entry with defaults', () => {
    const entry = createProgressEntry('material-2', { lastPage: 1, totalPages: 5 });

    expect(entry.materialId).toBe('material-2');
    expect(entry.lastPage).toBe(1);
    expect(entry.totalPages).toBe(5);
    expect(entry.percentCompleted).toBe(20);
  });
});

describe('pending purchase helpers', () => {
  it('persists and restores the latest pending purchase state', () => {
    clearPendingPurchase();
    savePendingPurchase({ materialId: 'material-3', reference: 'ref-1', status: 'pending' });

    const pending = loadPendingPurchase();
    expect(pending.materialId).toBe('material-3');
    expect(pending.reference).toBe('ref-1');
    expect(pending.status).toBe('pending');

    saveLatestPurchase({ materialId: 'material-3', reference: 'ref-1', status: 'success' });
    const latest = loadLatestPurchase();
    expect(latest.status).toBe('success');
    expect(latest.reference).toBe('ref-1');
  });
});
