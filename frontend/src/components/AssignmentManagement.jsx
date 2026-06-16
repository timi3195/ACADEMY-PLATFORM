import React, { useState, useEffect } from 'react'
import { apiGet, apiPost } from '../utils/api'

export default function AssignmentManagement() {
  const [assignments, setAssignments] = useState([])
  const [courses, setCourses] = useState([])
  const [loading, setLoading] = useState(false)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [selectedCourse, setSelectedCourse] = useState('')
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    instructions: '',
    type: 'assignment',
    dueDate: '',
    totalPoints: 100
  })

  useEffect(() => {
    fetchCourses()
  }, [])

  useEffect(() => {
    if (selectedCourse) {
      fetchCourseAssignments(selectedCourse)
    }
  }, [selectedCourse])

  const fetchCourses = async () => {
    try {
      const res = await apiGet('/api/courses')
      setCourses(res.courses || [])
    } catch (err) {
      console.error('Failed to fetch courses:', err)
    }
  }

  const fetchCourseAssignments = async (courseId) => {
    try {
      setLoading(true)
      const res = await apiGet(`/api/assignments/course/${courseId}`)
      setAssignments(res.assignments || [])
    } catch (err) {
      console.error('Failed to fetch assignments:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleFormChange = (e) => {
    const { name, value } = e.target
    setFormData(prev => ({
      ...prev,
      [name]: name === 'totalPoints' ? parseInt(value) : value
    }))
  }

  const handleCreateAssignment = async (e) => {
    e.preventDefault()
    
    if (!selectedCourse) {
      alert('Please select a course first')
      return
    }

    try {
      setLoading(true)
      const res = await apiPost('/api/assignments', {
        ...formData,
        course: selectedCourse
      })

      if (res.success) {
        setAssignments(prev => [res.assignment, ...prev])
        setFormData({
          title: '',
          description: '',
          instructions: '',
          type: 'assignment',
          dueDate: '',
          totalPoints: 100
        })
        setShowCreateForm(false)
        alert('Assignment created successfully!')
      }
    } catch (err) {
      alert('Error creating assignment: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteAssignment = async (assignmentId) => {
    if (!window.confirm('Are you sure you want to delete this assignment? This will also delete all submissions.')) {
      return
    }

    try {
      const res = await apiPost(`/api/assignments/${assignmentId}/delete`, {})
      if (res.success) {
        setAssignments(prev => prev.filter(a => a._id !== assignmentId))
        alert('Assignment deleted successfully')
      }
    } catch (err) {
      alert('Error deleting assignment: ' + err.message)
    }
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">📝 Assignment Management</h2>

      {/* Course Selection */}
      <div className="bg-white rounded-lg shadow-lg p-6">
        <label className="block text-lg font-bold mb-3">Select Course</label>
        <select
          value={selectedCourse}
          onChange={(e) => setSelectedCourse(e.target.value)}
          className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
        >
          <option value="">-- Choose a course --</option>
          {courses.map(course => (
            <option key={course._id} value={course._id}>
              {course.code} - {course.title}
            </option>
          ))}
        </select>
      </div>

      {selectedCourse && (
        <>
          {/* Create Assignment Button */}
          <button
            onClick={() => setShowCreateForm(!showCreateForm)}
            className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition font-bold"
          >
            {showCreateForm ? '✕ Cancel' : '+ Create New Assignment'}
          </button>

          {/* Create Assignment Form */}
          {showCreateForm && (
            <form onSubmit={handleCreateAssignment} className="bg-white rounded-lg shadow-lg p-6 space-y-4">
              <div>
                <label className="block text-sm font-bold mb-2">Title *</label>
                <input
                  type="text"
                  name="title"
                  value={formData.title}
                  onChange={handleFormChange}
                  required
                  placeholder="Assignment title"
                  className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-bold mb-2">Description</label>
                <textarea
                  name="description"
                  value={formData.description}
                  onChange={handleFormChange}
                  rows="3"
                  placeholder="Brief description"
                  className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-bold mb-2">Instructions *</label>
                <textarea
                  name="instructions"
                  value={formData.instructions}
                  onChange={handleFormChange}
                  rows="5"
                  required
                  placeholder="Detailed instructions for students"
                  className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-bold mb-2">Type *</label>
                  <select
                    name="type"
                    value={formData.type}
                    onChange={handleFormChange}
                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="assignment">Assignment</option>
                    <option value="test">Test</option>
                    <option value="quiz">Quiz</option>
                    <option value="project">Project</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-bold mb-2">Total Points</label>
                  <input
                    type="number"
                    name="totalPoints"
                    value={formData.totalPoints}
                    onChange={handleFormChange}
                    min="1"
                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-bold mb-2">Due Date & Time *</label>
                <input
                  type="datetime-local"
                  name="dueDate"
                  value={formData.dueDate}
                  onChange={handleFormChange}
                  required
                  className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full px-6 py-3 bg-green-600 hover:bg-green-700 disabled:bg-gray-300 text-white rounded-lg transition font-bold"
              >
                {loading ? 'Creating...' : 'Create Assignment'}
              </button>
            </form>
          )}

          {/* Assignments List */}
          <div className="space-y-4">
            <h3 className="text-xl font-bold">{assignments.length} Assignment(s)</h3>
            
            {loading && <p className="text-gray-600">Loading assignments...</p>}

            {assignments.length === 0 && !loading && (
              <p className="text-gray-600 text-center py-8">No assignments yet for this course</p>
            )}

            {assignments.map(assignment => (
              <div key={assignment._id} className="bg-white rounded-lg shadow-lg p-6 border-l-4 border-blue-600">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h4 className="text-lg font-bold text-gray-900">{assignment.title}</h4>
                    <p className="text-sm text-gray-600 mt-1">
                      {assignment.type.toUpperCase()} • {assignment.totalPoints} points
                    </p>
                  </div>
                  <span className={`px-3 py-1 rounded-full text-xs font-bold ${
                    new Date(assignment.dueDate) > new Date()
                      ? 'bg-blue-100 text-blue-700'
                      : 'bg-red-100 text-red-700'
                  }`}>
                    {new Date(assignment.dueDate) > new Date() ? 'Active' : 'Closed'}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-4 mb-4">
                  <div>
                    <p className="text-xs text-gray-500">Due Date</p>
                    <p className="font-semibold text-gray-800">{new Date(assignment.dueDate).toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Submissions</p>
                    <p className="font-semibold text-gray-800">{assignment.totalSubmissions || 0}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Avg. Score</p>
                    <p className="font-semibold text-gray-800">{assignment.averageScore ? `${assignment.averageScore}%` : 'N/A'}</p>
                  </div>
                </div>

                <div className="flex gap-2">
                  <a
                    href={`/admin/assignment/${assignment._id}/submissions`}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition text-sm font-semibold"
                  >
                    View Submissions
                  </a>
                  <a
                    href={`/admin/assignment/${assignment._id}/edit`}
                    className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg transition text-sm font-semibold"
                  >
                    Edit
                  </a>
                  <button
                    onClick={() => handleDeleteAssignment(assignment._id)}
                    className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition text-sm font-semibold"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
