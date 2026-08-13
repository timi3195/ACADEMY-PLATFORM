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

  it('returns unsupported for unhandled types', () => {
    expect(detectFileKind('text/plain', 'notes.txt')).toBe('unsupported');
  });
});
