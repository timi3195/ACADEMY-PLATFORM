import React, { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

export default function Modal({ isOpen, onClose, title, children, footer, fullscreen = false, contentClassName = '' }) {
  const dialogRef = useRef(null)

  useEffect(() => {
    if (!isOpen) return

    const dialog = dialogRef.current
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose?.()
      }
    }

    dialog?.focus()
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  return createPortal(
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div
        ref={dialogRef}
        className={`modal-content${fullscreen ? ' modal-content--fullscreen' : ''}${contentClassName ? ` ${contentClassName}` : ''}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        tabIndex={-1}
      >
        <div className="modal-header">
          <h3 id="modal-title">{title}</h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close dialog">×</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>,
    document.body
  )
}
