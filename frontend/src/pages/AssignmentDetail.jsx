import React, { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { apiGet, apiPost } from '../utils/api'
import PDFViewer from '../components/PDFViewer'

export default function AssignmentDetail() {
  const { assignmentId } = useParams()
  const [assignment, setAssignment] = useState(null)
  const [submission, setSubmission] = useState(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [activeTab, setActiveTab] = useState('details')
  const [textResponse, setTextResponse] = useState('')
  const [error, setError] = useState(null)

  useEffect(() => {
    if (assignmentId) {
      fetchAssignmentDetails()
    }
  }, [assignmentId])

  const fetchAssignmentDetails = async () => {
    try {
      setLoading(true)
      const res = await apiGet(`/api/assignments/${assignmentId}/student-view`)
      setAssignment(res.assignment)
      setSubmission(res.submission)
      if (res.submission?.textSubmission) {
        setTextResponse(res.submission.textSubmission)
      }
    } catch (err) {
      console.error(err)
      setError('Failed to load assignment')
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async () => {
    try {
      setSubmitting(true)
      const res = await apiPost(`/api/assignments/${assignmentId}/submit`, {
        textSubmission: textResponse,
        responses: []
      })

      if (res.success) {
        setSubmission(res.submission)
        setError(null)
        alert('Assignment submitted successfully!')
      }
    } catch (err) {
      console.error(err)
      setError(err.message || 'Failed to submit assignment')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto py-8">
        <p className="text-gray-600">Loading assignment...</p>
      </div>
    )
  }

  if (!assignment) {
    return (
      <div className="max-w-6xl mx-auto py-8">
        <p className="text-red-600">Assignment not found</p>
      </div>
    )
  }

  const isSubmitted = submission && submission.status === 'submitted'
  const isGraded = submission && submission.status === 'graded'
  const now = new Date()
  const dueDate = new Date(assignment.dueDate)
  const isOverdue = now > dueDate

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 py-8">
      <div className="max-w-6xl mx-auto px-6">
        {/* Header */}
        <div className="mb-6">
          <Link to={-1} className="text-blue-600 hover:text-blue-700 font-semibold mb-4 inline-block">
            ← Back
          </Link>
          <h1 className="text-4xl font-bold text-gray-900 mb-2">{assignment.title}</h1>
          <p className="text-gray-600">{assignment.type.charAt(0).toUpperCase() + assignment.type.slice(1)} • {assignment.totalPoints} points</p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6 text-red-700">
            {error}
          </div>
        )}

        {isGraded && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
            <h3 className="font-bold text-blue-900 mb-2">✓ Graded</h3>
            <p className="text-blue-800">Score: <span className="font-bold">{submission.score}/{assignment.totalPoints}</span> ({Math.round(submission.percentage)}%)</p>
            {submission.feedback && (
              <div className="mt-3 bg-white p-4 rounded border border-blue-200">
                <p className="text-sm text-gray-700"><strong>Feedback:</strong></p>
                <p className="text-gray-700">{submission.feedback}</p>
              </div>
            )}
          </div>
        )}

        {isSubmitted && !isGraded && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6 text-green-700">
            ✓ Submitted on {new Date(submission.submittedAt).toLocaleString()}
            {submission.isLate && <span className="ml-2 text-orange-600 font-bold">({submission.daysLate} days late)</span>}
          </div>
        )}

        {!isSubmitted && isOverdue && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6 text-red-700">
            ⚠ This assignment is overdue
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-4 border-b border-gray-200 mb-6">
          {['details', 'submit', 'materials'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-3 font-semibold capitalize transition ${
                activeTab === tab
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              {tab === 'details' && '📋 Details'}
              {tab === 'submit' && '📤 Submit'}
              {tab === 'materials' && '📎 Materials'}
            </button>
          ))}
        </div>

        <div className="bg-white rounded-lg shadow-lg p-8">
          {/* Details Tab */}
          {activeTab === 'details' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-bold mb-4">Instructions</h2>
                <p className="text-gray-700 whitespace-pre-wrap">{assignment.instructions || 'No instructions provided'}</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="bg-blue-50 p-4 rounded-lg">
                  <p className="text-sm text-gray-600">Due Date</p>
                  <p className="text-lg font-bold text-blue-600">{new Date(assignment.dueDate).toLocaleString()}</p>
                </div>
                <div className="bg-purple-50 p-4 rounded-lg">
                  <p className="text-sm text-gray-600">Total Points</p>
                  <p className="text-lg font-bold text-purple-600">{assignment.totalPoints}</p>
                </div>
                {submission && (
                  <div className="bg-green-50 p-4 rounded-lg">
                    <p className="text-sm text-gray-600">Status</p>
                    <p className="text-lg font-bold text-green-600 capitalize">{submission.status}</p>
                  </div>
                )}
                {isGraded && (
                  <div className="bg-yellow-50 p-4 rounded-lg">
                    <p className="text-sm text-gray-600">Your Score</p>
                    <p className="text-lg font-bold text-yellow-600">{submission.score}/{assignment.totalPoints}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Submit Tab */}
          {activeTab === 'submit' && !isGraded && (
            <div className="space-y-6">
              <div>
                <label className="block text-lg font-bold mb-3 text-gray-900">Your Response</label>
                <textarea
                  value={textResponse}
                  onChange={(e) => setTextResponse(e.target.value)}
                  placeholder="Type your response here..."
                  rows="12"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
                />
              </div>

              <button
                onClick={handleSubmit}
                disabled={submitting || !textResponse.trim()}
                className="px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white rounded-lg transition font-bold text-lg"
              >
                {submitting ? 'Submitting...' : 'Submit Assignment'}
              </button>

              {isSubmitted && (
                <p className="text-green-600 font-semibold">✓ Already submitted</p>
              )}
            </div>
          )}

          {/* Materials Tab */}
          {activeTab === 'materials' && (
            <div className="space-y-6">
              {assignment.attachments && assignment.attachments.length > 0 ? (
                <div className="space-y-4">
                  {assignment.attachments.map((attachment, idx) => (
                    <div key={idx} className="bg-gray-50 p-4 rounded-lg">
                      <h3 className="font-bold mb-2">{attachment.filename}</h3>
                      {attachment.fileType === 'pdf' ? (
                        <PDFViewer
                          fileUrl={attachment.fileUrl}
                          fileName={attachment.filename}
                        />
                      ) : (
                        <a
                          href={attachment.fileUrl}
                          download
                          className="inline-block px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition"
                        >
                          Download
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-600">No materials attached</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
