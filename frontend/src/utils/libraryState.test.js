import { describe, expect, it } from 'vitest';
import { createProgressEntry, getProgressPercent, normalizeProgressEntry } from './libraryState';

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
