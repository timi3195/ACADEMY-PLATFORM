import React, { useState } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/esm/Page/AnnotationLayer.css'
import 'react-pdf/dist/esm/Page/TextLayer.css'

// Set up PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`

export default function PDFViewer({ fileUrl, fileName }) {
  const [numPages, setNumPages] = useState(null)
  const [pageNumber, setPageNumber] = useState(1)
  const [scale, setScale] = useState(1)
  const [error, setError] = useState(null)

  const onDocumentLoadSuccess = ({ numPages }) => {
    setNumPages(numPages)
    setPageNumber(1)
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
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
        <p className="text-red-700 font-semibold mb-4">Error loading PDF</p>
        <p className="text-red-600 text-sm mb-4">{error.message}</p>
        <a
          href={fileUrl}
          download
          className="inline-block bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg transition"
        >
          Download Instead
        </a>
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
          <a
            href={fileUrl}
            download={fileName || 'document.pdf'}
            className="inline-block px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition text-sm font-semibold"
            title="Download PDF"
          >
            📥 Download
          </a>
        </div>
      </div>

      {/* PDF Viewer */}
      <div className="bg-white rounded-lg shadow-lg p-4 overflow-auto" style={{ maxHeight: '70vh' }}>
        <div className="flex justify-center">
          <Document
            file={fileUrl}
            onLoadSuccess={onDocumentLoadSuccess}
            onError={(error) => setError(error)}
            loading={<p className="text-gray-600">Loading PDF...</p>}
          >
            <Page
              pageNumber={pageNumber}
              scale={scale}
              renderTextLayer={true}
              renderAnnotationLayer={true}
            />
          </Document>
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
