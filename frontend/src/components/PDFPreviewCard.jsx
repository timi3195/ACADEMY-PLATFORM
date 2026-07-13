import React from 'react'
import { Document, Page } from 'react-pdf'

export default function PDFPreviewCard({ fileUrl, title }) {
  return (
    <div className="pdf-preview-card">
      <div className="pdf-preview-header">
        <h3>{title}</h3>
      </div>
      <div className="pdf-preview-body">
        <Document file={fileUrl} options={{ workerSrc: '/pdf.worker.js' }}>
          <Page pageNumber={1} width={320} />
        </Document>
      </div>
    </div>
  )
}
