import { describe, expect, it } from 'vitest';
import { detectFileKind } from './fileType';

describe('detectFileKind', () => {
  it('detects PDF from MIME type', () => {
    expect(detectFileKind('application/pdf', 'notes.pdf')).toBe('pdf');
  });

  it('detects DOCX from MIME type', () => {
    expect(detectFileKind('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'notes.docx')).toBe('docx');
  });

  it('detects DOCX from filename when MIME is absent', () => {
    expect(detectFileKind('', 'notes.DOCX')).toBe('docx');
  });

  it('detects supported image formats from MIME type and filename', () => {
    expect(detectFileKind('image/jpeg', 'paper.jpg')).toBe('image');
    expect(detectFileKind('image/png', 'paper.png')).toBe('image');
    expect(detectFileKind('image/gif', 'paper.gif')).toBe('image');
    expect(detectFileKind('', 'paper.JPEG')).toBe('image');
  });

  it('returns unsupported for unhandled types', () => {
    expect(detectFileKind('text/plain', 'notes.txt')).toBe('unsupported');
  });
});
