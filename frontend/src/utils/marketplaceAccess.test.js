import { describe, it, expect } from 'vitest';
import { normalizeMaterialAccess } from './marketplaceAccess';

describe('normalizeMaterialAccess', () => {
  it('reads the nested access object from the backend response', () => {
    const result = normalizeMaterialAccess({
      success: true,
      access: {
        access: false,
        reason: 'purchase_required'
      }
    });

    expect(result.access).toBe(false);
    expect(result.reason).toBe('purchase_required');
  });

  it('accepts a direct access payload as well', () => {
    const result = normalizeMaterialAccess({ access: true, reason: 'purchased' });

    expect(result.access).toBe(true);
    expect(result.reason).toBe('purchased');
  });
});
