import React, { useState, useEffect } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'

// Set up PDF.js worker from CDN
pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`

export default function PDFViewer({ fileUrl, fileName, downloadUrl, canDownload }) {
  const [numPages, setNumPages] = useState(null)
  const [pageNumber, setPageNumber] = useState(1)
  const [scale, setScale] = useState(1)
  const [error, setError] = useState(null)
  const [fileWithAuth, setFileWithAuth] = useState(null)

  useEffect(() => {
    // Prepare file object with authentication headers for protected routes
    if (fileUrl) {
      const token = localStorage.getItem('accessToken')
      console.log('📄 PDFViewer: Setting up file', { fileUrl, hasToken: !!token })
      const fileObj = {
        url: fileUrl,
        withCredentials: true
      }
      // Include auth header if token exists
      if (token) {
        fileObj.httpHeaders = {
          'Authorization': `Bearer ${token}`
        }
        console.log('✅ PDFViewer: Auth token added to headers')
      } else {
        console.warn('⚠️ PDFViewer: No auth token found in localStorage.accessToken')
      }
      setFileWithAuth(fileObj)
    }
  }, [fileUrl])

  const onDocumentLoadSuccess = ({ numPages }) => {
    console.log(`✅ PDF loaded successfully with ${numPages} pages`)
    setNumPages(numPages)
    setPageNumber(1)
  }

  const onDocumentLoadError = (error) => {
    console.error('❌ PDF load error:', error)
    setError(error)
  }

  const goToPreviousPage = () => {
    setPageNumber(prev => Math.max(1, prev - 1))
  }

  const goToNextPage = () => {
    setPageNumber(prev => Math.min(numPages, prev + 1))
  }

  const zoomIn = () => {
    setScale(prev => Math.min(2.5, prev + 0.2))
  }

  const zoomOut = () => {
    setScale(prev => Math.max(0.5, prev - 0.2))
  }

  const resetZoom = () => {
    setScale(1)
  }

  if (error) {
    const isAuthError = error.message && (error.message.includes('403') || error.message.includes('unauthorized') || error.message.includes('premium') || error.message.includes('subscription'));
    
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
        <p className="text-red-700 font-semibold mb-4">❌ Cannot Load PDF</p>
        <p className="text-red-600 text-sm mb-2">{error.message || 'Failed to load the PDF file'}</p>
        {isAuthError && (
          <p className="text-amber-600 text-sm mb-4 font-semibold">💡 This may require a premium subscription to access</p>
        )}
        <div className="flex gap-2 justify-center flex-wrap">
          {downloadUrl && (
            <a
              href={downloadUrl}
              className="inline-block bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg transition"
            >
              📥 Try Direct Download
            </a>
          )}
          {!downloadUrl && fileUrl && (
            <a
              href={fileUrl}
              className="inline-block bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg transition"
            >
              🔗 Open Link
            </a>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="bg-white rounded-lg shadow-lg p-4 flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-700">
            {fileName && `📄 ${fileName}`}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Navigation */}
          <button
            onClick={goToPreviousPage}
            disabled={pageNumber <= 1}
            className="px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white rounded-lg transition text-sm font-semibold"
            title="Previous page"
          >
            ← Prev
          </button>

          <span className="text-sm font-semibold text-gray-700 px-3 py-2 bg-gray-100 rounded-lg">
            {pageNumber} / {numPages || '...'}
          </span>

          <button
            onClick={goToNextPage}
            disabled={pageNumber >= numPages}
            className="px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white rounded-lg transition text-sm font-semibold"
            title="Next page"
          >
            Next →
          </button>
        </div>

        <div className="flex items-center gap-2">
          {/* Zoom Controls */}
          <button
            onClick={zoomOut}
            disabled={scale <= 0.5}
            className="px-3 py-2 bg-gray-200 hover:bg-gray-300 disabled:bg-gray-100 text-gray-700 rounded-lg transition text-sm font-semibold"
            title="Zoom out"
          >
            −
          </button>

          <span className="text-sm font-semibold text-gray-700 px-3 py-2 bg-gray-100 rounded-lg min-w-16 text-center">
            {Math.round(scale * 100)}%
          </span>

          <button
            onClick={zoomIn}
            disabled={scale >= 2.5}
            className="px-3 py-2 bg-gray-200 hover:bg-gray-300 disabled:bg-gray-100 text-gray-700 rounded-lg transition text-sm font-semibold"
            title="Zoom in"
          >
            +
          </button>

          <button
            onClick={resetZoom}
            className="px-3 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg transition text-sm font-semibold"
            title="Reset zoom"
          >
            Reset
          </button>
        </div>

        <div>
          {canDownload && downloadUrl && (
            <a
              href={downloadUrl}
              className="inline-block px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition text-sm font-semibold"
              title="Download PDF"
            >
              📥 Download
            </a>
          )}
        </div>
      </div>

      {/* PDF Viewer */}
      <div className="bg-white rounded-lg shadow-lg p-4 overflow-auto" style={{ maxHeight: '70vh' }}>
        <div className="flex justify-center">
          {fileWithAuth && (
            <Document
              file={fileWithAuth}
              onLoadSuccess={onDocumentLoadSuccess}
              onError={onDocumentLoadError}
              loading={<p className="text-gray-600">📄 Loading PDF...</p>}
            >
              <Page
                pageNumber={pageNumber}
                scale={scale}
                renderTextLayer={true}
                renderAnnotationLayer={true}
              />
            </Document>
          )}
        </div>
      </div>

      {/* Loading Message */}
      {!numPages && (
        <div className="text-center py-8">
          <p className="text-gray-600">Loading document...</p>
        </div>
      )}
    </div>
  )
}
