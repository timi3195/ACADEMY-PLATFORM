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
  it('sends only academic material fields and resolves the selected course id', () => {
    const payload = buildMaterialPayload({
      title: 'Notes',
      description: 'Desc',
      course: { _id: 'course-123' },
      previewPages: '3',
      materialType: 'PDF',
      tags: 'math,exam',
      status: 'published'
    });

    expect(payload.course).toBe('course-123');
    expect(payload.previewPages).toBe(3);
    expect(payload.materialType).toBe('PDF');
    expect(payload.tags).toBe('math,exam');
    expect(payload.status).toBe('published');
    expect(payload).not.toHaveProperty('price');
    expect(payload).not.toHaveProperty('department');
    expect(payload).not.toHaveProperty('isPaid');
    expect(payload).not.toHaveProperty('isPremium');
  });

  it('uses the academic defaults when optional material details are missing', () => {
    const payload = buildMaterialPayload({
      title: 'Notes',
      description: 'Desc',
      course: 'course-123',
      previewPages: '1'
    });

    expect(payload.status).toBe('published');
    expect(payload.materialType).toBe('Lecture Note');
  });
});
