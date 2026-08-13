export function detectFileKind(contentType = '', fileName = '') {
  const mime = (contentType || '').toLowerCase();
  const name = (fileName || '').toLowerCase();

  if (mime.includes('pdf') || name.endsWith('.pdf')) return 'pdf';
  if (
    mime.includes('wordprocessingml.document') ||
    mime.includes('docx') ||
    mime.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document') ||
    mime.includes('application/msword') ||
    name.endsWith('.docx') ||
    name.endsWith('.doc')
  ) {
    return 'docx';
  }

  return 'unsupported';
}

export function getReadableFileTypeLabel(kind) {
  switch (kind) {
    case 'pdf':
      return 'PDF';
    case 'docx':
      return 'Word document';
    default:
      return 'file';
  }
}
