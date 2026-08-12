import React, { useEffect, useMemo, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import fileService from '../services/fileService';

pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;

export default function PDFViewer({ fileUrl, fileName, downloadUrl, canDownload, maxPages, materialId }) {
  const [numPages, setNumPages] = useState(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1);
  const [error, setError] = useState(null);
  const [fileWithAuth, setFileWithAuth] = useState(null);
  const [loading, setLoading] = useState(false);

  const storageKey = useMemo(() => `pdf-page:${fileUrl || materialId || 'default'}`, [fileUrl, materialId]);
  const resolvedMaterialId = materialId || (typeof fileUrl === 'string' ? fileUrl.match(/\/api\/files\/(?:view|download)\/([^/?#]+)/)?.[1] : null);

  useEffect(() => {
    let objectUrl;
    let active = true;

    const loadAuthorizedFile = async () => {
      if (!resolvedMaterialId && !fileUrl) return;

      const savedPage = Number(window.localStorage.getItem(storageKey)) || 1;
      setPageNumber(savedPage);
      setNumPages(null);
      setError(null);
      setLoading(true);

      try {
        if (resolvedMaterialId) {
          const response = await fileService.viewFile(resolvedMaterialId);
          const blob = new Blob([response.data], {
            type: response.headers?.['content-type'] || 'application/pdf'
          });
          objectUrl = URL.createObjectURL(blob);
          if (active) {
            setFileWithAuth({ url: objectUrl, withCredentials: false });
          }
          return;
        }

        const token = localStorage.getItem('accessToken');
        const fileObj = { url: fileUrl, withCredentials: true };
        if (token) {
          fileObj.httpHeaders = { Authorization: `Bearer ${token}` };
        }
        if (active) setFileWithAuth(fileObj);
      } catch (loadError) {
        const message = loadError?.response?.data?.message || loadError?.message || 'Unable to load this file.';
        if (active) setError(new Error(message));
      } finally {
        if (active) setLoading(false);
      }
    };

    loadAuthorizedFile();

    return () => {
      active = false;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [fileUrl, resolvedMaterialId, storageKey]);

  useEffect(() => {
    if (pageNumber > 1) {
      window.localStorage.setItem(storageKey, String(pageNumber));
    }
  }, [pageNumber, storageKey]);

  const onDocumentLoadSuccess = ({ numPages }) => {
    const effectiveMaxPages = Number(maxPages || 0);
    const safeMaxPages = effectiveMaxPages > 0 ? Math.min(numPages, effectiveMaxPages) : numPages;
    setNumPages(safeMaxPages);
    setPageNumber((current) => Math.min(current || 1, safeMaxPages || 1));
    setLoading(false);
  };

  const onDocumentLoadError = (error) => {
    setError(error);
    setLoading(false);
  };

  const handleDownload = async () => {
    if (!resolvedMaterialId && !downloadUrl) return;

    try {
      const idToDownload = resolvedMaterialId || (typeof downloadUrl === 'string' ? downloadUrl.match(/\/api\/files\/download\/([^/?#]+)/)?.[1] : null);
      if (!idToDownload) {
        if (downloadUrl) {
          window.open(downloadUrl, '_blank', 'noopener,noreferrer');
        }
        return;
      }

      const response = await fileService.downloadFile(idToDownload);
      const blob = new Blob([response.data], {
        type: response.headers?.['content-type'] || 'application/octet-stream'
      });
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = fileName || 'material';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (downloadError) {
      const message = downloadError?.response?.data?.message || downloadError?.message || 'Unable to download this file.';
      setError(new Error(message));
    }
  };

  const effectiveMaxPages = Number(maxPages || 0);
  const clampPage = (value) => {
    if (effectiveMaxPages > 0) {
      return Math.min(effectiveMaxPages, Math.max(1, value));
    }
    return Math.max(1, value);
  };
  const goToPreviousPage = () => setPageNumber((prev) => clampPage(prev - 1));
  const goToNextPage = () => setPageNumber((prev) => clampPage(prev + 1));
  const zoomIn = () => setScale((prev) => Math.min(2.5, prev + 0.2));
  const zoomOut = () => setScale((prev) => Math.max(0.5, prev - 0.2));
  const resetZoom = () => setScale(1);

  if (error) {
    const isAuthError = error.message && (error.message.includes('403') || error.message.includes('unauthorized') || error.message.includes('premium') || error.message.includes('subscription'));

    return (
      <div style={{ border: '1px solid #fecaca', background: '#fef2f2', borderRadius: '12px', padding: '16px', textAlign: 'center' }}>
        <p style={{ color: '#991b1b', fontWeight: 700, marginBottom: '8px' }}>Cannot load PDF</p>
        <p style={{ color: '#7f1d1d', marginBottom: '10px' }}>{error.message || 'Unable to open this file.'}</p>
        {isAuthError && <p style={{ color: '#b45309', marginBottom: '12px' }}>This material may require access permission.</p>}
        {downloadUrl && canDownload && (
          <button type="button" onClick={handleDownload} style={{ display: 'inline-block', padding: '8px 12px', background: '#2563eb', color: '#fff', borderRadius: '8px', border: 'none', cursor: 'pointer' }}>
            Open file link
          </button>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: '12px', width: '100%', minWidth: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap', background: '#fff', borderRadius: '12px', padding: '12px', border: '1px solid #e2e8f0' }}>
        <div style={{ minWidth: 0 }}>{fileName && <strong style={{ display: 'block', overflowWrap: 'anywhere' }}>{fileName}</strong>}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <button type="button" onClick={goToPreviousPage} disabled={pageNumber <= 1}>← Prev</button>
          <span>{pageNumber} / {numPages || '…'}</span>
          <button type="button" onClick={goToNextPage} disabled={pageNumber >= (numPages || 1)}>Next →</button>
          <button type="button" onClick={zoomOut} disabled={scale <= 0.5}>−</button>
          <span>{Math.round(scale * 100)}%</span>
          <button type="button" onClick={zoomIn} disabled={scale >= 2.5}>+</button>
          <button type="button" onClick={resetZoom}>Reset</button>
          {canDownload && (downloadUrl || resolvedMaterialId) && <button type="button" onClick={handleDownload} style={{ color: '#2563eb', textDecoration: 'none', fontWeight: 600, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}>Open</button>}
        </div>
      </div>

      <div style={{ background: '#fff', borderRadius: '12px', padding: '12px', border: '1px solid #e2e8f0', overflow: 'auto', maxHeight: '70vh', width: '100%', minWidth: 0 }}>
        {fileWithAuth && (
          <Document file={fileWithAuth} onLoadSuccess={onDocumentLoadSuccess} onError={onDocumentLoadError} loading={<div style={{ padding: '20px', color: '#64748b' }}>Loading PDF…</div>}>
            <Page pageNumber={pageNumber} scale={scale} renderTextLayer renderAnnotationLayer />
          </Document>
        )}
      </div>

      {effectiveMaxPages > 0 && pageNumber >= effectiveMaxPages && numPages > effectiveMaxPages && (
        <div style={{ borderRadius: '10px', padding: '12px 14px', background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a' }}>
          This preview has ended. Purchase to unlock the full material.
        </div>
      )}

      {loading && <div style={{ textAlign: 'center', color: '#64748b' }}>Preparing PDF reader…</div>}
    </div>
  );
}

