import React, { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../utils/auth'
import { apiGet } from '../utils/api'
import { useLibrary } from '../context/LibraryContext'
import { useMarketplace } from '../context/MarketplaceContext'
import MaterialCard from '../components/MaterialCard'
import { getProgressEntry, getProgressPercent, loadWishlistEntries } from '../utils/libraryState'

export default function Dashboard() {
  const { user, isAuthenticated } = useAuth()
  const navigate = useNavigate()
  const { items: libraryItems, loadLibrary } = useLibrary()
  const { materials, loadMaterials } = useMarketplace()
  const [courses, setCourses] = useState([])
  const [loading, setLoading] = useState(true)
  const [expandedDepts, setExpandedDepts] = useState({})
  const [expandedLevels, setExpandedLevels] = useState({})

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login')
      return
    }
    fetchCourses()
    loadLibrary({ limit: 8 }).catch(() => undefined)
    loadMaterials({ limit: 8 }).catch(() => undefined)
  }, [isAuthenticated, loadLibrary, loadMaterials, navigate])

  const fetchCourses = async () => {
    try {
      const data = await apiGet('/api/courses')
      if (data.success) {
        setCourses(data.courses)
      }
    } catch (error) {
      console.error('Error fetching courses:', error)
    } finally {
      setLoading(false)
    }
  }

  // Organize courses by Department → Level → Course
  const organizeCourses = () => {
    const organized = {}
    const visibleCourses = user && user.role !== 'admin' && user.department && user.yearOfStudy
      ? courses.filter(course => course.department?._id === (user.department._id || user.department) && course.level === user.yearOfStudy)
      : courses

    visibleCourses.forEach(course => {
      const deptName = course.department?.name || 'Uncategorized'
      const deptId = course.department?._id || 'uncategorized'
      const level = course.level || 'Other'
      
      if (!organized[deptName]) {
        organized[deptName] = { id: deptId, levels: {} }
      }
      
      if (!organized[deptName].levels[level]) {
        organized[deptName].levels[level] = []
      }
      
      organized[deptName].levels[level].push(course)
    })
    
    return organized
  }

  const toggleDepartment = (deptName) => {
    setExpandedDepts(prev => ({
      ...prev,
      [deptName]: !prev[deptName]
    }))
  }

  const toggleLevel = (deptName, level) => {
    const key = `${deptName}-${level}`
    setExpandedLevels(prev => ({
      ...prev,
      [key]: !prev[key]
    }))
  }

  const canAccessCourse = (course) => {
    if (!course.isPremium) return true
    if (user?.role === 'admin') return true
    // Only premium subscribers with a non-expired subscription may access premium courses
    if (user?.subscriptionType !== 'premium') return false
    if (isSubscriptionExpired()) return false
    return true
  }

  const isSubscriptionExpired = () => {
    if (!user?.subscriptionExpiresAt) return false
    return new Date(user.subscriptionExpiresAt) < new Date()
  }

  const organizedCourses = organizeCourses()
  const deptArray = Object.entries(organizedCourses).sort((a, b) => a[0].localeCompare(b[0]))
  const continueReading = useMemo(() => {
    const source = Array.isArray(libraryItems) ? libraryItems : []
    return source
      .map((item) => ({ ...item, progress: getProgressEntry(item.material?._id) }))
      .filter((item) => item.progress)
      .sort((a, b) => new Date(b.progress.lastOpened || 0) - new Date(a.progress.lastOpened || 0))
      .slice(0, 5)
  }, [libraryItems])
  const recommendations = useMemo(() => (Array.isArray(materials) ? materials : []).slice(0, 4), [materials])
  const wishlistCount = useMemo(() => loadWishlistEntries().length, [])

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      {/* Header Section */}
      <div className="bg-gradient-to-r from-blue-600 via-blue-500 to-indigo-600 text-white px-6 py-8">
        <div className="max-w-7xl mx-auto">
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-4xl font-bold mb-2">📚 Learning Dashboard</h1>
              <p className="text-blue-100 text-lg">Welcome back, {user?.name?.split(' ')[0]}!</p>
            </div>
            <div className="bg-white/20 backdrop-blur px-6 py-4 rounded-xl">
              <p className="text-sm text-blue-100 mb-2">Your Plan</p>
              <p className="text-xl font-bold capitalize flex items-center gap-2">
                {user?.subscriptionType === 'free' ? '🎓 Free' : user?.subscriptionType === 'premium' ? '⭐ Premium' : '📖 Basic'}
                {user?.subscriptionType !== 'free' && !isSubscriptionExpired() && (
                  <span className="text-xs bg-green-400 text-green-900 px-2 py-1 rounded-full">Active</span>
                )}
              </p>
              {user?.subscriptionExpiresAt && !isSubscriptionExpired() && (
                <p className="text-xs text-blue-100 mt-1">
                  Expires: {new Date(user.subscriptionExpiresAt).toLocaleDateString()}
                </p>
              )}
            </div>
          </div>

          {/* Premium CTA */}
          {user?.subscriptionType === 'free' && (
            <div className="mt-6 bg-white/10 backdrop-blur border border-white/30 rounded-lg p-4 flex justify-between items-center">
              <div>
                <p className="font-semibold text-white">🚀 Unlock Premium Features</p>
                <p className="text-blue-100 text-sm">Get AI-powered study tools & full quiz engine</p>
              </div>
              <Link to="/upgrade" className="bg-white text-blue-600 font-bold px-6 py-2 rounded-lg hover:bg-blue-50 transition">
                Upgrade Now
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        {loading ? (
          <div className="text-center py-12">
            <p className="text-gray-500 text-lg">Loading your courses...</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
              <div className="bg-white rounded-2xl shadow-lg p-6 border border-slate-200">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-slate-900">Continue Reading</h2>
                  <span className="text-sm text-slate-500">{continueReading.length} items</span>
                </div>
                {continueReading.length > 0 ? (
                  <div className="space-y-3">
                    {continueReading.map((item) => {
                      const progress = getProgressEntry(item.material?._id)
                      const percent = getProgressPercent(progress?.lastPage || 0, progress?.totalPages || item.material?.pageCount || 1)
                      return (
                        <div key={item.transactionId || item.material?._id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-3">
                          <div>
                            <p className="font-semibold text-slate-800">{item.material?.title}</p>
                            <p className="text-sm text-slate-500">{percent}% complete</p>
                          </div>
                          <Link to="/library" className="text-sm text-blue-600 font-semibold">Resume</Link>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">Buy materials to start a reading streak.</p>
                )}
              </div>

              <div className="bg-white rounded-2xl shadow-lg p-6 border border-slate-200">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-slate-900">Quick Links</h2>
                  <span className="text-sm text-slate-500">{wishlistCount} saved</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Link to="/marketplace" className="rounded-xl border border-slate-200 px-3 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Marketplace</Link>
                  <Link to="/library" className="rounded-xl border border-slate-200 px-3 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Library</Link>
                  <Link to="/past-questions" className="rounded-xl border border-slate-200 px-3 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Past Questions</Link>
                  <Link to="/ai-chat" className="rounded-xl border border-slate-200 px-3 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">AI Assistant</Link>
                </div>
              </div>

              <div className="bg-white rounded-2xl shadow-lg p-6 border border-slate-200">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-slate-900">Recent Purchases</h2>
                  <span className="text-sm text-slate-500">{libraryItems?.length || 0} total</span>
                </div>
                {libraryItems?.length > 0 ? (
                  <div className="space-y-3">
                    {libraryItems.slice(0, 3).map((item) => (
                      <div key={item.transactionId || item.material?._id} className="rounded-lg border border-slate-200 px-3 py-3">
                        <p className="font-semibold text-slate-800">{item.material?.title}</p>
                        <p className="text-sm text-slate-500">{item.purchasedAt ? new Date(item.purchasedAt).toLocaleDateString() : 'Purchased recently'}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">No purchases yet. Explore the marketplace to fill your library.</p>
                )}
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-lg p-6 border border-slate-200 mb-8">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-slate-900">Recommended for you</h2>
                <Link to="/marketplace" className="text-sm text-blue-600 font-semibold">Browse marketplace</Link>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                {recommendations.map((material) => (
                  <MaterialCard key={material._id} material={material} />
                ))}
              </div>
            </div>
          </>
        )}

        {deptArray.length === 0 ? (
          <div className="bg-white rounded-xl shadow-lg p-12 text-center">
            <p className="text-gray-500 text-lg mb-4">No courses available yet.</p>
            <Link to="/courses" className="text-blue-600 hover:text-blue-700 font-semibold">
              Browse all courses →
            </Link>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Departments */}
            {deptArray.map(([deptName, deptData]) => {
              const levelArray = Object.entries(deptData.levels).sort()
              const deptCourseCount = levelArray.reduce((sum, [_, courses]) => sum + courses.length, 0)
              const isExpanded = expandedDepts[deptName]

              return (
                <div key={deptName} className="bg-white rounded-xl shadow-lg overflow-hidden hover:shadow-xl transition">
                  {/* Department Header */}
                  <button
                    onClick={() => toggleDepartment(deptName)}
                    className="w-full px-6 py-5 flex items-center justify-between bg-gradient-to-r from-blue-50 to-indigo-50 hover:from-blue-100 hover:to-indigo-100 transition"
                  >
                    <div className="flex items-center gap-4 text-left">
                      <span className="text-3xl">🏢</span>
                      <div>
                        <h2 className="text-xl font-bold text-gray-800">{deptName}</h2>
                        <p className="text-sm text-gray-600">{deptCourseCount} courses</p>
                      </div>
                    </div>
                    <span className={`text-2xl transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
                      ▼
                    </span>
                  </button>

                  {/* Department Content */}
                  {isExpanded && (
                    <div className="px-6 py-6 space-y-4">
                      {/* Levels */}
                      {levelArray.map(([level, levelCourses]) => {
                        const levelKey = `${deptName}-${level}`
                        const levelExpanded = expandedLevels[levelKey]

                        // Determine level icon and color (explicit Tailwind classes)
                        const levelConfig = {
                          'ND1': { icon: '1️⃣', border: 'border-blue-200', headerBg: 'bg-blue-50', headerHover: 'hover:bg-blue-100', label: 'ND Year 1' },
                          'ND2': { icon: '2️⃣', border: 'border-purple-200', headerBg: 'bg-purple-50', headerHover: 'hover:bg-purple-100', label: 'ND Year 2' },
                          'HND1': { icon: '3️⃣', border: 'border-orange-200', headerBg: 'bg-orange-50', headerHover: 'hover:bg-orange-100', label: 'HND Year 1' },
                          'HND2': { icon: '4️⃣', border: 'border-red-200', headerBg: 'bg-red-50', headerHover: 'hover:bg-red-100', label: 'HND Year 2' }
                        }
                        const config = levelConfig[level] || { icon: '📚', border: 'border-gray-200', headerBg: 'bg-gray-50', headerHover: 'hover:bg-gray-100', label: level }

                        return (
                          <div key={levelKey} className={`border-2 ${config.border} rounded-lg overflow-hidden`}>
                            {/* Level Header */}
                            <button
                              onClick={() => toggleLevel(deptName, level)}
                              className={`w-full px-4 py-4 flex items-center justify-between ${config.headerBg} ${config.headerHover} transition`}
                            >
                              <div className="flex items-center gap-3 text-left">
                                <span className="text-2xl">{config.icon}</span>
                                <div>
                                  <h3 className="font-bold text-gray-800">{config.label}</h3>
                                  <p className="text-xs text-gray-600">{levelCourses.length} courses</p>
                                </div>
                              </div>
                              <span className={`text-lg transition-transform ${levelExpanded ? 'rotate-180' : ''}`}>
                                ▼
                              </span>
                            </button>

                            {/* Courses */}
                            {levelExpanded && (
                              <div className="px-4 py-4 bg-white space-y-3">
                                {levelCourses.map(course => {
                                  const hasAccess = canAccessCourse(course)
                                  
                                  return (
                                    <div
                                      key={course._id}
                                      className={`p-4 rounded-lg border-2 transition ${
                                        hasAccess
                                          ? `border-green-200 bg-green-50 hover:bg-green-100`
                                          : `border-red-200 bg-red-50 hover:bg-red-100`
                                      }`}
                                    >
                                      <div className="flex items-start justify-between">
                                        <div className="flex-1">
                                          <div className="flex items-center gap-2 mb-1">
                                            <h4 className="font-bold text-gray-800 text-lg">{course.title}</h4>
                                            {course.isPremium && (
                                              <span className="bg-gradient-to-r from-yellow-400 to-yellow-500 text-yellow-900 text-xs font-bold px-3 py-1 rounded-full">
                                                ⭐ Premium
                                              </span>
                                            )}
                                          </div>
                                          <p className="text-sm text-gray-600 mb-2">
                                            <span className="font-semibold">Code:</span> {course.code} • 
                                            <span className="font-semibold ml-2">Credits:</span> {course.creditUnits} units • 
                                            <span className="font-semibold ml-2">Semester:</span> {course.semester}
                                          </p>
                                          {course.description && (
                                            <p className="text-sm text-gray-700 italic">{course.description}</p>
                                          )}
                                        </div>

                                        {/* Access Status & Actions */}
                                        <div className="ml-4 text-right flex flex-col items-end gap-2">
                                          {hasAccess ? (
                                            <>
                                              <span className="inline-block bg-green-500 text-white text-xs font-bold px-3 py-1 rounded-full">
                                                ✓ Access Granted
                                              </span>
                                              <div className="flex gap-2">
                                                <Link
                                                  to={`/courses/${course._id}`}
                                                  className="bg-blue-600 hover:bg-blue-700 text-white text-xs px-3 py-2 rounded-lg transition"
                                                >
                                                  📖 Course
                                                </Link>
                                                <Link
                                                  to={`/courses/${course._id}/materials`}
                                                  className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs px-3 py-2 rounded-lg transition"
                                                >
                                                  📁 Materials
                                                </Link>
                                                <Link
                                                  to="/notes"
                                                  className="bg-purple-600 hover:bg-purple-700 text-white text-xs px-3 py-2 rounded-lg transition"
                                                >
                                                  📝 Notes
                                                </Link>
                                                <Link
                                                  to="/cbt-quiz"
                                                  className="bg-orange-600 hover:bg-orange-700 text-white text-xs px-3 py-2 rounded-lg transition"
                                                >
                                                  🎯 Quiz
                                                </Link>
                                              </div>
                                            </>
                                          ) : (
                                            <>
                                              <span className="inline-block bg-red-500 text-white text-xs font-bold px-3 py-1 rounded-full">
                                                🔒 Premium Only
                                              </span>
                                              <Link
                                                to="/upgrade"
                                                className="bg-gradient-to-r from-yellow-400 to-yellow-500 hover:from-yellow-500 hover:to-yellow-600 text-yellow-900 text-xs font-bold px-3 py-2 rounded-lg transition"
                                              >
                                                ⭐ Unlock
                                              </Link>
                                            </>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Quick Stats */}
        <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white rounded-lg shadow p-6 text-center">
            <p className="text-4xl mb-2">📚</p>
            <p className="text-gray-600 text-sm">Total Courses</p>
            <p className="text-3xl font-bold text-blue-600">{courses.length}</p>
          </div>
          <div className="bg-white rounded-lg shadow p-6 text-center">
            <p className="text-4xl mb-2">🏢</p>
            <p className="text-gray-600 text-sm">Departments</p>
            <p className="text-3xl font-bold text-purple-600">{deptArray.length}</p>
          </div>
          <div className="bg-white rounded-lg shadow p-6 text-center">
            <p className="text-4xl mb-2">{user?.subscriptionType === 'free' ? '🔓' : '⭐'}</p>
            <p className="text-gray-600 text-sm">Your Status</p>
            <p className="text-3xl font-bold text-indigo-600 capitalize">{user?.subscriptionType}</p>
          </div>
        </div>
      </div>
    </div>
  )
}
