export function detectFileKind(contentType = '', fileName = '') {
  const mime = (contentType || '').toLowerCase();
  const name = (fileName || '').toLowerCase();

  if (mime.includes('pdf') || name.endsWith('.pdf')) return 'pdf';
  if (
    ['image/jpeg', 'image/png', 'image/gif'].includes(mime.split(';')[0].trim()) ||
    ['.jpg', '.jpeg', '.png', '.gif'].some((extension) => name.endsWith(extension))
  ) {
    return 'image';
  }
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
    case 'image':
      return 'image';
    case 'docx':
      return 'Word document';
    default:
      return 'file';
  }
}
