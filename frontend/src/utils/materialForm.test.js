import { describe, expect, it } from 'vitest';
import { buildMaterialPayload, normalizeMaterialFormValue } from './materialForm';

describe('normalizeMaterialFormValue', () => {
  it('extracts ids from populated course objects', () => {
    expect(normalizeMaterialFormValue({ _id: 'course-123' })).toBe('course-123');
  });

  it('keeps string ids unchanged', () => {
    expect(normalizeMaterialFormValue('course-456')).toBe('course-456');
  });
});

describe('buildMaterialPayload', () => {
  it('converts price fields and derives paid/free flags', () => {
    const payload = buildMaterialPayload({
      title: 'Notes',
      description: 'Desc',
      course: { _id: 'course-123' },
      department: { _id: 'dept-456' },
      price: '150',
      previewPages: '3',
      visibility: 'public',
      level: 'ND1'
    });

    expect(payload.course).toBe('course-123');
    expect(payload.department).toBe('dept-456');
    expect(payload.price).toBe(150);
    expect(payload.previewPages).toBe(3);
    expect(payload.isFree).toBe(false);
    expect(payload.isPaid).toBe(true);
  });
});
