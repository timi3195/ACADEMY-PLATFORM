// @vitest-environment jsdom

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { pdfjs } from 'react-pdf';
import fileService from '../services/fileService';
import PDFViewer from './PDFViewer';

vi.mock('react-pdf', async () => {
  const ReactModule = await import('react');
  return {
    pdfjs: { GlobalWorkerOptions: {} },
    Document: ({ file, children }) => ReactModule.createElement(
      'div',
      { 'data-testid': 'pdf-document', 'data-file-url': file.url },
      children
    ),
    Page: () => ReactModule.createElement('div', { 'data-testid': 'pdf-page' })
  };
});

vi.mock('../services/fileService', () => ({
  default: {
    viewFile: vi.fn(),
    viewPastQuestionPaper: vi.fn(),
    downloadFile: vi.fn()
  }
}));

const originalCreateObjectURL = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
const originalRevokeObjectURL = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');

describe('PDFViewer', () => {
  afterEach(() => {
    cleanup();
    if (originalCreateObjectURL) Object.defineProperty(URL, 'createObjectURL', originalCreateObjectURL);
    else delete URL.createObjectURL;
    if (originalRevokeObjectURL) Object.defineProperty(URL, 'revokeObjectURL', originalRevokeObjectURL);
    else delete URL.revokeObjectURL;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:authenticated-pdf')
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn()
    });
    fileService.viewPastQuestionPaper.mockResolvedValue({
      data: new Blob(['%PDF-1.4'], { type: 'application/pdf' }),
      headers: { 'content-type': 'application/pdf' }
    });
  });

  it('configures PDF.js with the locally imported worker URL', () => {
    expect(pdfjs.GlobalWorkerOptions.workerSrc).toBe(pdfjsWorker);
    expect(pdfjsWorker).not.toMatch(/^https?:\/\//);
  });

  it('passes the authenticated PDF response to the renderer without enabling downloads', async () => {
    render(
      <PDFViewer
        pastQuestionPaperId="paper-1"
        fileName="paper.pdf"
        canDownload={false}
      />
    );

    const pdfDocument = await screen.findByTestId('pdf-document');
    expect(fileService.viewPastQuestionPaper).toHaveBeenCalledWith('paper-1');
    expect(pdfDocument.getAttribute('data-file-url')).toBe('blob:authenticated-pdf');
    expect(screen.queryByRole('button', { name: 'Download' })).toBeNull();
  });

  it('previews an authenticated uploaded image', async () => {
    fileService.viewPastQuestionPaper.mockResolvedValue({
      data: new Blob(['image-data'], { type: 'image/png' }),
      headers: { 'content-type': 'image/png' }
    });

    render(
      <PDFViewer
        pastQuestionPaperId="paper-image"
        fileName="paper.png"
        canDownload={false}
      />
    );

    const image = await screen.findByRole('img', { name: 'paper.png' });
    expect(fileService.viewPastQuestionPaper).toHaveBeenCalledWith('paper-image');
    expect(image.getAttribute('src')).toBe('blob:authenticated-pdf');
  });

  it('shows an error when the authenticated PDF request fails', async () => {
    fileService.viewPastQuestionPaper.mockRejectedValue(new Error('Past question file is unavailable.'));
    render(
      <PDFViewer
        pastQuestionPaperId="paper-1"
        fileName="paper.pdf"
        canDownload={false}
      />
    );

    expect(await screen.findByText('Past question file is unavailable.')).toBeTruthy();
    expect(screen.queryByTestId('pdf-document')).toBeNull();
  });
});
