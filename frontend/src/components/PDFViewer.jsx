import React, { useEffect, useMemo, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import Mammoth from 'mammoth';
import fileService from '../services/fileService';
import { detectFileKind } from '../utils/fileType';

pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;

export default function PDFViewer({ fileUrl, fileName, downloadUrl, canDownload, maxPages, materialId, disablePreviewLimit = false }) {
  const [numPages, setNumPages] = useState(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1);
  const [error, setError] = useState(null);
  const [fileWithAuth, setFileWithAuth] = useState(null);
  const [loading, setLoading] = useState(false);
  const [fileKind, setFileKind] = useState(null);
  const [docHtml, setDocHtml] = useState('');

  const storageKey = useMemo(() => `pdf-page:${fileUrl || materialId || 'default'}`, [fileUrl, materialId]);
  const resolvedMaterialId = materialId || (typeof fileUrl === 'string' ? fileUrl.match(/\/api\/files\/(?:view|download)\/([^/?#]+)/)?.[1] : null);
  const effectiveMaxPages = disablePreviewLimit ? 0 : Number(maxPages || 0);

  useEffect(() => {
    let objectUrl;
    let active = true;

    if (disablePreviewLimit) {
      setPageNumber(1);
    }

    const loadAuthorizedFile = async () => {
      if (!resolvedMaterialId && !fileUrl) return;

      const savedPage = Number(window.localStorage.getItem(storageKey)) || 1;
      setPageNumber(savedPage);
      setNumPages(null);
      setError(null);
      setFileKind(null);
      setDocHtml('');
      setFileWithAuth(null);
      setLoading(true);

      try {
        let blob;
        let contentType = 'application/octet-stream';
        let finalFileName = fileName || 'material';

        if (resolvedMaterialId) {
          const response = await fileService.viewFile(resolvedMaterialId);
          const headers = response?.headers || {};
          contentType = headers['content-type'] || headers['Content-Type'] || 'application/octet-stream';
          const disposition = headers['content-disposition'] || headers['Content-Disposition'] || '';
          const match = disposition.match(/filename\s*=\s*"?([^";]+)"?/i);
          if (match?.[1]) {
            finalFileName = match[1];
          }
          blob = new Blob([response.data], { type: contentType });
        } else {
          const token = localStorage.getItem('accessToken');
          const remoteResponse = await fetch(fileUrl, {
            credentials: 'include',
            headers: token ? { Authorization: `Bearer ${token}` } : {}
          });
          if (!remoteResponse.ok) {
            throw new Error(`Unable to load this file (${remoteResponse.status}).`);
          }
          contentType = remoteResponse.headers.get('content-type') || 'application/octet-stream';
          blob = await remoteResponse.blob();
        }

        const kind = detectFileKind(contentType, finalFileName);

        if (!active) return;
        setFileKind(kind);

        if (kind === 'pdf') {
          objectUrl = URL.createObjectURL(blob);
          setFileWithAuth({ url: objectUrl, withCredentials: false });
          return;
        }

        if (kind === 'docx') {
          const arrayBuffer = await blob.arrayBuffer();
          const result = await Mammoth.convertToHtml({ arrayBuffer });
          if (active) {
            setDocHtml(result.value || '<p>Document preview is unavailable for this file.</p>');
          }
          return;
        }

        if (active) {
          setError(new Error('Preview unavailable for this file type. You can still download the original file.'));
        }
      } catch (loadError) {
        const message = loadError?.response?.data?.message || loadError?.message || 'Unable to load this file.';
        if (active) {
          setError(new Error(message));
        }
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
  }, [fileUrl, resolvedMaterialId, storageKey, fileName, disablePreviewLimit]);

  useEffect(() => {
    if (pageNumber > 1) {
      window.localStorage.setItem(storageKey, String(pageNumber));
    }
  }, [pageNumber, storageKey]);

  const onDocumentLoadSuccess = ({ numPages }) => {
    const safeMaxPages = effectiveMaxPages > 0 ? Math.min(numPages, effectiveMaxPages) : numPages;
    setNumPages(safeMaxPages);
    setPageNumber((current) => Math.min(current || 1, safeMaxPages || 1));
    setLoading(false);
  };

  const onDocumentLoadError = (submitError) => {
    setError(submitError || new Error('Unable to render this PDF preview.'));
    setLoading(false);
  };

  const handleDownload = async () => {
    if (!resolvedMaterialId && !downloadUrl) return;

    try {
      const idToDownload = resolvedMaterialId || (typeof downloadUrl === 'string' ? downloadUrl.match(/\/api\/files\/download\/([^/?#]+)/)?.[1] : null);
      if (!idToDownload) {
        if (downloadUrl) {
          const response = await fetch(downloadUrl, {
            credentials: 'include',
            headers: localStorage.getItem('accessToken') ? { Authorization: `Bearer ${localStorage.getItem('accessToken')}` } : {}
          });
          if (!response.ok) {
            throw new Error('Unable to download this file.');
          }
          const blob = await response.blob();
          const objectUrl = URL.createObjectURL(blob);
          const anchor = document.createElement('a');
          anchor.href = objectUrl;
          anchor.download = fileName || 'material';
          document.body.appendChild(anchor);
          anchor.click();
          anchor.remove();
          URL.revokeObjectURL(objectUrl);
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

  const isUnsupported = fileKind === 'unsupported' || (!fileKind && !loading && !fileWithAuth && !docHtml);

  if (process.env.NODE_ENV !== 'production') {
    console.info('[PDFViewer]', {
      materialId: resolvedMaterialId,
      fileKind,
      hasAccess: disablePreviewLimit,
      maxPages: effectiveMaxPages,
      canDownload: Boolean(canDownload),
      pageCount: numPages
    });
  }

  if (error) {
    const isAuthError = error.message && (error.message.includes('403') || error.message.includes('unauthorized') || error.message.includes('premium') || error.message.includes('subscription'));

    return (
      <div style={{ border: '1px solid #fecaca', background: '#fef2f2', borderRadius: '12px', padding: '16px', textAlign: 'center' }}>
        <p style={{ color: '#991b1b', fontWeight: 700, marginBottom: '8px' }}>{isUnsupported ? 'Preview unavailable' : 'Unable to load this file'}</p>
        <p style={{ color: '#7f1d1d', marginBottom: '10px' }}>{error.message || 'This file could not be opened in the browser.'}</p>
        {isAuthError && <p style={{ color: '#b45309', marginBottom: '12px' }}>This material may require access permission.</p>}
        {(canDownload || resolvedMaterialId || downloadUrl) && (
          <button type="button" onClick={handleDownload} style={{ display: 'inline-block', padding: '8px 12px', background: '#2563eb', color: '#fff', borderRadius: '8px', border: 'none', cursor: 'pointer' }}>
            Download file
          </button>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: '12px', width: '100%', minWidth: 0 }}>
      {fileKind === 'pdf' && (
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
            {canDownload && (downloadUrl || resolvedMaterialId) && <button type="button" onClick={handleDownload} style={{ color: '#2563eb', textDecoration: 'none', fontWeight: 600, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}>Download</button>}
          </div>
        </div>
      )}

      <div style={{ background: '#fff', borderRadius: '12px', padding: '12px', border: '1px solid #e2e8f0', overflow: 'auto', maxHeight: '70vh', width: '100%', minWidth: 0 }}>
        {fileKind === 'pdf' && fileWithAuth && (
          <Document file={fileWithAuth} onLoadSuccess={onDocumentLoadSuccess} onError={onDocumentLoadError} loading={<div style={{ padding: '20px', color: '#64748b' }}>Loading PDF…</div>}>
            <Page pageNumber={pageNumber} scale={scale} renderTextLayer renderAnnotationLayer />
          </Document>
        )}

        {fileKind === 'docx' && docHtml && (
          <div
            style={{ lineHeight: 1.6, color: '#1f2937', fontSize: '15px', maxWidth: '100%' }}
            dangerouslySetInnerHTML={{ __html: docHtml }}
          />
        )}

        {fileKind === 'docx' && !docHtml && loading && (
          <div style={{ padding: '20px', color: '#64748b' }}>Preparing document preview…</div>
        )}

        {fileKind === 'unsupported' && (
          <div style={{ padding: '20px', textAlign: 'center', color: '#475569' }}>
            <p style={{ fontWeight: 700, marginBottom: '8px' }}>Preview unavailable</p>
            <p>This file format cannot be displayed in the browser.</p>
            {(canDownload || resolvedMaterialId || downloadUrl) && (
              <button type="button" onClick={handleDownload} style={{ marginTop: '12px', display: 'inline-block', padding: '8px 12px', background: '#2563eb', color: '#fff', borderRadius: '8px', border: 'none', cursor: 'pointer' }}>
                Download file
              </button>
            )}
          </div>
        )}
      </div>

      {fileKind === 'pdf' && effectiveMaxPages > 0 && pageNumber >= effectiveMaxPages && numPages > effectiveMaxPages && (
        <div style={{ borderRadius: '10px', padding: '12px 14px', background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a' }}>
          This preview has ended. Purchase to unlock the full material.
        </div>
      )}

      {fileKind === 'pdf' && loading && <div style={{ textAlign: 'center', color: '#64748b' }}>Preparing PDF reader…</div>}
    </div>
  );
}

