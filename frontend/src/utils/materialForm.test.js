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
      subtitle: 'A short guide',
      description: 'Desc',
      authorName: 'Ada Lovelace',
      course: { _id: 'course-123' },
      department: { _id: 'dept-456' },
      price: '150',
      previewPages: '3',
      visibility: 'public',
      level: 'ND1',
      semester: 'Second',
      materialType: 'PDF',
      tags: 'math,exam',
      productStatus: 'published',
      language: 'en',
      edition: '2nd',
      publisher: 'Campus Press',
      fileSize: '1024000',
      fileType: 'application/pdf'
    });

    expect(payload.course).toBe('course-123');
    expect(payload.department).toBe('dept-456');
    expect(payload.price).toBe(150);
    expect(payload.previewPages).toBe(3);
    expect(payload.subtitle).toBe('A short guide');
    expect(payload.authorName).toBe('Ada Lovelace');
    expect(payload.edition).toBe('2nd');
    expect(payload.publisher).toBe('Campus Press');
    expect(payload.fileSize).toBe(1024000);
    expect(payload.fileType).toBe('application/pdf');
    expect(payload.isFree).toBe(false);
    expect(payload.isPaid).toBe(true);
    expect(payload.semester).toBe('Second');
    expect(payload.materialType).toBe('PDF');
    expect(payload.tags).toBe('math,exam');
    expect(payload.productStatus).toBe('published');
    expect(payload.language).toBe('en');
  });
});
