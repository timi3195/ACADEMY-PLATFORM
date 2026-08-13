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
    expect(result.hasAccess).toBe(true);
    expect(result.canDownload).toBe(true);
    expect(result.reason).toBe('purchased');
  });

  it('treats a successful purchased-material response as full access', () => {
    const result = normalizeMaterialAccess({
      success: true,
      access: true,
      hasAccess: true,
      canView: true,
      canRead: true,
      canDownload: true,
      isPurchased: true,
      reason: 'purchased'
    });

    expect(result.access).toBe(true);
    expect(result.hasAccess).toBe(true);
    expect(result.canView).toBe(true);
    expect(result.canRead).toBe(true);
    expect(result.canDownload).toBe(true);
    expect(result.isPurchased).toBe(true);
  });

  it('rejects failed or missing purchase access', () => {
    const result = normalizeMaterialAccess({
      success: true,
      access: false,
      reason: 'purchase_required'
    });

    expect(result.access).toBe(false);
    expect(result.hasAccess).toBe(false);
    expect(result.canView).toBe(false);
    expect(result.canDownload).toBe(false);
  });
});
