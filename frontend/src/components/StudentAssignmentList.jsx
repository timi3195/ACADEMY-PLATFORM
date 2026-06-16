import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { apiGet } from '../utils/api'

export default function StudentAssignmentList({ courseId }) {
  const [assignments, setAssignments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (courseId) {
      fetchAssignments()
    }
  }, [courseId])

  const fetchAssignments = async () => {
    try {
      setLoading(true)
      const res = await apiGet(`/api/assignments/course/${courseId}`)
      setAssignments(res.assignments || [])
    } catch (err) {
      console.error(err)
      setError('Failed to load assignments')
    } finally {
      setLoading(false)
    }
  }

  const getStatusBadge = (assignment) => {
    const now = new Date()
    const dueDate = new Date(assignment.dueDate)
    const isOverdue = now > dueDate

    if (isOverdue) {
      return <span className="bg-red-100 text-red-700 px-3 py-1 rounded-full text-xs font-bold">Overdue</span>
    }

    const daysLeft = Math.ceil((dueDate - now) / (1000 * 60 * 60 * 24))
    if (daysLeft <= 1) {
      return <span className="bg-yellow-100 text-yellow-700 px-3 py-1 rounded-full text-xs font-bold">Due Soon ({daysLeft}d)</span>
    }

    return <span className="bg-green-100 text-green-700 px-3 py-1 rounded-full text-xs font-bold">Due in {daysLeft}d</span>
  }

  if (loading) {
    return <div className="text-center py-8"><p className="text-gray-600">Loading assignments...</p></div>
  }

  if (error) {
    return <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">{error}</div>
  }

  if (assignments.length === 0) {
    return <div className="text-center py-8"><p className="text-gray-600">No assignments yet</p></div>
  }

  return (
    <div className="space-y-4">
      {assignments.map(assignment => (
        <Link
          key={assignment._id}
          to={`/assignment/${assignment._id}`}
          className="block"
        >
          <div className="bg-white rounded-lg shadow-lg p-6 hover:shadow-xl transition border-l-4 border-blue-600">
            <div className="flex items-start justify-between mb-3">
              <div className="flex-1">
                <h3 className="text-lg font-bold text-gray-900">{assignment.title}</h3>
                <p className="text-sm text-gray-600 mt-1">{assignment.type.charAt(0).toUpperCase() + assignment.type.slice(1)} • {assignment.totalPoints} points</p>
              </div>
              {getStatusBadge(assignment)}
            </div>

            {assignment.description && (
              <p className="text-gray-700 text-sm mb-4 line-clamp-2">{assignment.description}</p>
            )}

            <div className="flex items-center justify-between">
              <div className="text-sm text-gray-600">
                <p className="font-semibold">Due: {new Date(assignment.dueDate).toLocaleDateString()} at {new Date(assignment.dueDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
              </div>
              <button className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition font-semibold">
                Open Assignment →
              </button>
            </div>
          </div>
        </Link>
      ))}
    </div>
  )
}
