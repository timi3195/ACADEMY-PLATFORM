import React from 'react'

export default function CourseMaterialCompletion({ completed, saving, disabled, onChange }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <button
        type="button"
        aria-pressed={completed}
        disabled={disabled || saving}
        onClick={() => onChange(!completed)}
        className="rounded border border-blue-700 px-3 py-1.5 text-sm font-medium text-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {saving ? 'Saving...' : completed ? 'Reopen material' : 'Mark as complete'}
      </button>
      <span className="text-sm text-gray-700">
        {completed ? 'Marked complete' : 'Not completed'}
      </span>
    </div>
  )
}
