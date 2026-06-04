import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../utils/auth'
import { apiGet } from '../utils/api'

export default function Courses() {
  const { user } = useAuth()
  const [courses, setCourses] = useState([])
  const [searchTerm, setSearchTerm] = useState('')
  const [filterLevel, setFilterLevel] = useState('all')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchCourses()
  }, [])

  const fetchCourses = async () => {
    try {
      setLoading(true)
      const res = await apiGet('/api/courses')
      setCourses(res.courses || [])
    } catch (err) {
      console.error('Error fetching courses:', err)
    } finally {
      setLoading(false)
    }
  }

  const canAccessCourse = (course) => {
    if (!course.isPremium) return true
    if (!user) return false
    if (user.role === 'admin') return true
    const isPremium = user.plan === 'premium' || user.subscriptionType === 'premium'
    const notExpired = !user.subscriptionExpiresAt || new Date(user.subscriptionExpiresAt) > new Date()
    return isPremium && notExpired
  }

  const visibleCourses = user && user.role !== 'admin' && user.department && user.yearOfStudy
    ? courses.filter(course => course.department?._id === (user.department._id || user.department) && course.level === user.yearOfStudy)
    : courses

  const filteredCourses = visibleCourses.filter(course => {
    const matchesSearch = course.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         course.code.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesLevel = filterLevel === 'all' || course.level === filterLevel
    return matchesSearch && matchesLevel
  })

  const levelOptions = ['all', 'ND1', 'ND2', 'HND1', 'HND2']

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 via-blue-500 to-indigo-600 text-white px-6 py-8">
        <div className="max-w-6xl mx-auto">
          <h1 className="text-4xl font-bold mb-4">📚 All Courses</h1>
          <p className="text-blue-100">Browse and access all available courses</p>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Filters */}
        <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Search */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Search courses</label>
              <input
                type="text"
                placeholder="Search by title or code..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            {/* Level Filter */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Filter by level</label>
              <select
                value={filterLevel}
                onChange={(e) => setFilterLevel(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                {levelOptions.map(level => (
                  <option key={level} value={level}>
                    {level === 'all' ? 'All Levels' : level}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Results Info */}
        <div className="mb-4 text-gray-600">
          <p>Showing <span className="font-bold">{filteredCourses.length}</span> of <span className="font-bold">{visibleCourses.length}</span> available courses</p>
          {user && user.role !== 'admin' && user.department && user.yearOfStudy && (
            <p className="text-sm text-gray-500">Only courses for {user.department.name} / {user.yearOfStudy} are shown.</p>
          )}
        </div>

        {/* Courses Grid */}
        {loading ? (
          <div className="text-center py-12">
            <p className="text-gray-500 text-lg">Loading courses...</p>
          </div>
        ) : filteredCourses.length === 0 ? (
          <div className="bg-white rounded-lg shadow-lg p-12 text-center">
            <p className="text-gray-500 text-lg mb-4">No courses found matching your filters.</p>
            <button
              onClick={() => {
                setSearchTerm('')
                setFilterLevel('all')
              }}
              className="text-blue-600 hover:text-blue-700 font-semibold"
            >
              Clear filters →
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredCourses.map(course => {
              const hasAccess = canAccessCourse(course)
              const deptName = course.department?.name || course.department || 'N/A'

              return (
                <div
                  key={course._id}
                  className={`rounded-lg shadow-lg overflow-hidden transition hover:shadow-xl ${
                    hasAccess ? 'bg-white hover:border-blue-300' : 'bg-red-50 border-2 border-red-100'
                  } border-2 ${hasAccess ? 'border-transparent' : 'border-red-100'}`}
                >
                  {/* Card Header */}
                  <div className={`px-6 py-4 ${hasAccess ? 'bg-blue-50' : 'bg-red-50'}`}>
                    <div className="flex items-start justify-between mb-2">
                      <h3 className="text-lg font-bold text-gray-800 flex-1">{course.title}</h3>
                      {course.isPremium && (
                        <span className="bg-gradient-to-r from-yellow-400 to-yellow-500 text-yellow-900 text-xs font-bold px-2 py-1 rounded-full whitespace-nowrap ml-2">
                          ⭐ Premium
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-600 font-semibold">Code: {course.code}</p>
                  </div>

                  {/* Card Body */}
                  <div className="px-6 py-4">
                    <p className="text-sm text-gray-700 mb-4 line-clamp-2">{course.description || 'No description available'}</p>

                    {/* Meta Info */}
                    <div className="space-y-2 mb-4">
                      <div className="flex items-center gap-2 text-sm text-gray-600">
                        <span>🏢</span>
                        <span>{deptName}</span>
                      </div>
                      <div className="flex items-center gap-2 text-sm text-gray-600">
                        <span>📚</span>
                        <span>{course.level}</span>
                      </div>
                      <div className="flex items-center gap-2 text-sm text-gray-600">
                        <span>📖</span>
                        <span>{course.creditUnits} credit units</span>
                      </div>
                    </div>
                  </div>

                  {/* Card Footer */}
                  <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex gap-2">
                    {hasAccess ? (
                      <>
                        <Link
                          to={`/courses/${course._id}`}
                          className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-center px-3 py-2 rounded-lg transition font-semibold"
                        >
                          View Details
                        </Link>
                      </>
                    ) : (
                      <>
                        <span className="flex-1 text-center text-red-700 font-bold py-2">🔒 Locked</span>
                        <Link
                          to="/upgrade"
                          className="bg-yellow-400 hover:bg-yellow-500 text-yellow-900 px-4 py-2 rounded-lg transition font-semibold"
                        >
                          Unlock
                        </Link>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
