import React, { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { apiGet, apiPost } from '../utils/api'

export default function SubmissionGrader() {
  const { assignmentId } = useParams()
  const [assignment, setAssignment] = useState(null)
  const [submissions, setSubmissions] = useState([])
  const [selectedSubmission, setSelectedSubmission] = useState(null)
  const [loading, setLoading] = useState(true)
  const [grading, setGrading] = useState(false)
  const [gradeForm, setGradeForm] = useState({
    score: 0,
    feedback: '',
    grade: 'F'
  })

  useEffect(() => {
    if (assignmentId) {
      fetchAssignmentAndSubmissions()
    }
  }, [assignmentId])

  const fetchAssignmentAndSubmissions = async () => {
    try {
      setLoading(true)
      const [assignmentRes, submissionsRes] = await Promise.all([
        apiGet(`/api/assignments/${assignmentId}`),
        apiGet(`/api/assignments/${assignmentId}/submissions`)
      ])

      setAssignment(assignmentRes.assignment)
      setSubmissions(submissionsRes.submissions || [])

      if (submissionsRes.submissions && submissionsRes.submissions.length > 0) {
        setSelectedSubmission(submissionsRes.submissions[0])
        setGradeForm({
          score: submissionsRes.submissions[0].score || 0,
          feedback: submissionsRes.submissions[0].feedback || '',
          grade: submissionsRes.submissions[0].grade || 'F'
        })
      }
    } catch (err) {
      console.error('Error fetching submissions:', err)
      alert('Failed to load submissions')
    } finally {
      setLoading(false)
    }
  }

  const handleSelectSubmission = (submission) => {
    setSelectedSubmission(submission)
    setGradeForm({
      score: submission.score || 0,
      feedback: submission.feedback || '',
      grade: submission.grade || 'F'
    })
  }

  const handleGradeFormChange = (e) => {
    const { name, value } = e.target
    setGradeForm(prev => ({
      ...prev,
      [name]: name === 'score' ? parseInt(value) : value
    }))
  }

  const handleSubmitGrade = async () => {
    if (!selectedSubmission || !assignment) return

    if (gradeForm.score > assignment.totalPoints) {
      alert(`Score cannot exceed ${assignment.totalPoints}`)
      return
    }

    try {
      setGrading(true)
      const res = await apiPost(
        `/api/assignments/${assignmentId}/grade/${selectedSubmission._id}`,
        gradeForm
      )

      if (res.success) {
        // Update the submission in the list
        setSubmissions(prev =>
          prev.map(sub =>
            sub._id === selectedSubmission._id
              ? res.submission
              : sub
          )
        )
        setSelectedSubmission(res.submission)
        alert('Submission graded successfully!')
      }
    } catch (err) {
      alert('Error grading submission: ' + err.message)
    } finally {
      setGrading(false)
    }
  }

  if (loading) {
    return <div className="text-center py-8"><p className="text-gray-600">Loading submissions...</p></div>
  }

  if (!assignment) {
    return <div className="text-center py-8"><p className="text-red-600">Assignment not found</p></div>
  }

  return (
    <div className="grid grid-cols-3 gap-6">
      {/* Submissions List */}
      <div className="col-span-1 bg-white rounded-lg shadow-lg p-6">
        <h3 className="text-lg font-bold mb-4">Submissions ({submissions.length})</h3>
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {submissions.map(submission => (
            <button
              key={submission._id}
              onClick={() => handleSelectSubmission(submission)}
              className={`w-full text-left p-3 rounded-lg transition ${
                selectedSubmission?._id === submission._id
                  ? 'bg-blue-100 border-2 border-blue-600'
                  : 'bg-gray-50 border-2 border-transparent hover:bg-gray-100'
              }`}
            >
              <p className="font-semibold text-gray-900">{submission.student?.name || 'Unknown'}</p>
              <p className="text-xs text-gray-600">{submission.student?.email}</p>
              <div className="flex items-center justify-between mt-2">
                <span className={`text-xs font-bold px-2 py-1 rounded ${
                  submission.status === 'graded'
                    ? 'bg-green-100 text-green-700'
                    : submission.status === 'submitted'
                    ? 'bg-blue-100 text-blue-700'
                    : 'bg-gray-100 text-gray-700'
                }`}>
                  {submission.status.toUpperCase()}
                </span>
                {submission.score && (
                  <span className="text-xs font-bold text-gray-700">
                    {submission.score}/{assignment.totalPoints}
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Submission Details & Grading */}
      <div className="col-span-2 bg-white rounded-lg shadow-lg p-6 space-y-6">
        {selectedSubmission ? (
          <>
            {/* Student Info */}
            <div className="border-b border-gray-200 pb-4">
              <h2 className="text-2xl font-bold mb-2">{selectedSubmission.student?.name}</h2>
              <p className="text-gray-600">{selectedSubmission.student?.email}</p>
              <p className="text-sm text-gray-600 mt-2">
                Submitted: {new Date(selectedSubmission.submittedAt).toLocaleString()}
                {selectedSubmission.isLate && (
                  <span className="ml-2 text-red-600 font-bold">({selectedSubmission.daysLate} days late)</span>
                )}
              </p>
            </div>

            {/* Submission Content */}
            <div className="bg-gray-50 p-4 rounded-lg">
              <h3 className="font-bold mb-3">Student Response</h3>
              {selectedSubmission.textSubmission ? (
                <div className="bg-white p-4 rounded border border-gray-200 max-h-48 overflow-y-auto whitespace-pre-wrap text-sm text-gray-700">
                  {selectedSubmission.textSubmission}
                </div>
              ) : (
                <p className="text-gray-600">No text submission</p>
              )}
            </div>

            {/* Submitted Files */}
            {selectedSubmission.submittedFiles && selectedSubmission.submittedFiles.length > 0 && (
              <div className="bg-blue-50 p-4 rounded-lg">
                <h3 className="font-bold mb-3">Submitted Files</h3>
                <div className="space-y-2">
                  {selectedSubmission.submittedFiles.map((file, idx) => (
                    <a
                      key={idx}
                      href={file.fileUrl}
                      download
                      className="block px-3 py-2 bg-white border border-blue-200 rounded hover:bg-blue-50 transition"
                    >
                      📎 {file.filename}
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Grading Form */}
            <div className="border-t border-gray-200 pt-6">
              <h3 className="text-lg font-bold mb-4">Grade Submission</h3>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-bold mb-2">Score (out of {assignment.totalPoints})</label>
                    <input
                      type="number"
                      name="score"
                      value={gradeForm.score}
                      onChange={handleGradeFormChange}
                      min="0"
                      max={assignment.totalPoints}
                      className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-bold mb-2">Grade</label>
                    <select
                      name="grade"
                      value={gradeForm.grade}
                      onChange={handleGradeFormChange}
                      className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="A">A - Excellent</option>
                      <option value="B">B - Good</option>
                      <option value="C">C - Average</option>
                      <option value="D">D - Below Average</option>
                      <option value="F">F - Fail</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-bold mb-2">Feedback</label>
                  <textarea
                    name="feedback"
                    value={gradeForm.feedback}
                    onChange={handleGradeFormChange}
                    rows="4"
                    placeholder="Provide constructive feedback..."
                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <button
                  onClick={handleSubmitGrade}
                  disabled={grading}
                  className="w-full px-6 py-3 bg-green-600 hover:bg-green-700 disabled:bg-gray-300 text-white rounded-lg transition font-bold"
                >
                  {grading ? 'Submitting...' : '✓ Submit Grade'}
                </button>

                {selectedSubmission.status === 'graded' && (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                    <p className="text-green-700 font-semibold">✓ Already graded</p>
                    <p className="text-sm text-green-600 mt-1">Graded by: {selectedSubmission.gradedBy?.name}</p>
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="text-center py-12 text-gray-600">
            <p>No submissions to grade</p>
          </div>
        )}
      </div>
    </div>
  )
}
