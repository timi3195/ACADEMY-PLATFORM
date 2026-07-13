import React from 'react'
import Modal from './Modal'

export default function ConfirmationDialog({ isOpen, title, description, confirmLabel = 'Confirm', cancelLabel = 'Cancel', onConfirm, onCancel }) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onCancel}
      title={title}
      footer={(
        <div className="dialog-actions">
          <button className="btn btn-secondary" onClick={onCancel}>{cancelLabel}</button>
          <button className="btn btn-primary" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      )}
    >
      <p>{description}</p>
    </Modal>
  )
}
