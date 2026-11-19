import React from 'react'

export default function CourseProgressPanel({ progress, loading, error, onRetry }) {
  return (
    <section className="mb-5 rounded-lg border border-blue-200 bg-blue-50 p-4" aria-live="polite">
      <h3 className="font-semibold text-blue-900">Your material progress</h3>
      {loading ? (
        <p className="mt-1 text-sm text-blue-800">Loading your saved progress...</p>
      ) : error ? (
        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-red-700">
          <span>{error}</span>
          <button type="button" onClick={onRetry} className="font-semibold underline">
            Try again
          </button>
        </div>
      ) : !progress ? (
        <p className="mt-1 text-sm text-blue-800">Progress is not available right now.</p>
      ) : progress.availableMaterialCount === 0 ? (
        <p className="mt-1 text-sm text-blue-800">
          No available materials to track yet.
          {progress.unavailableMaterialCount > 0 &&
            ` ${progress.unavailableMaterialCount} unavailable material(s) are excluded.`}
        </p>
      ) : (
        <>
          <p className="mt-1 text-sm text-blue-800">
            {progress.completedCount} of {progress.availableMaterialCount} available materials marked complete
            {' '}({progress.completionPercentage}%).
          </p>
          {progress.unavailableMaterialCount > 0 && (
            <p className="mt-1 text-sm text-amber-800">
              {progress.unavailableMaterialCount} unavailable material(s) are excluded from this calculation.
            </p>
          )}
        </>
      )}
      {!loading && !error && progress?.availableMaterialCount > 0 && (
        <p className="mt-2 text-xs text-blue-700">
          Completion is self-reported and does not indicate academic mastery.
        </p>
      )}
    </section>
  )
}
