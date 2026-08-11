import React, { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../utils/auth'
import { apiGet } from '../utils/api'

const courseColors = ['sand', 'lavender', 'sea', 'nude']

export default function Dashboard() {
  const { user } = useAuth()
  const [courses, setCourses] = useState([])
  const [libraryItems, setLibraryItems] = useState([])
  const [analytics, setAnalytics] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const loadDashboard = async () => {
      try {
        const [coursesRes, libraryRes, analyticsRes] = await Promise.all([
          apiGet('/api/courses'),
          apiGet('/api/library'),
          apiGet('/api/analytics/dashboard').catch(() => null)
        ])

        setCourses(Array.isArray(coursesRes?.courses) ? coursesRes.courses : [])
        setLibraryItems(Array.isArray(libraryRes?.library) ? libraryRes.library : [])
        setAnalytics(analyticsRes || null)
      } catch (error) {
        console.error('Failed to load dashboard data:', error)
      } finally {
        setLoading(false)
      }
    }

    loadDashboard()
  }, [])

  const courseList = useMemo(
    () =>
      courses.slice(0, 4).map((course, index) => ({
        name: course.title || 'Untitled course',
        hours: `${course.creditUnits || 0} credits`,
        color: courseColors[index % courseColors.length],
        code: course.code || ''
      })),
    [courses]
  )

  const statCards = useMemo(() => {
    const dashboard = analytics?.dashboard || {}
    const topicMetrics = Array.isArray(dashboard.topicMetrics) ? dashboard.topicMetrics : []
    const avgAccuracy = Number(dashboard.totalAccuracy || 0)

    return [
      { date: `${courses.length || 0}`, time: 'Courses', label: 'Your active course list', tone: 'soft' },
      { date: `${libraryItems.length || 0}`, time: 'Library', label: 'Purchased materials', tone: 'muted' },
      { date: `${Math.round(avgAccuracy)}%`, time: 'Accuracy', label: 'Overall performance', tone: 'soft' },
      { date: topicMetrics.length ? `${topicMetrics.length}` : '0', time: 'Topics', label: 'Tracked learning areas', tone: 'muted' },
    ]
  }, [analytics, courses.length, libraryItems.length])

  const progressData = useMemo(() => {
    const topicMetrics = Array.isArray(analytics?.dashboard?.topicMetrics) ? analytics.dashboard.topicMetrics : []
    return topicMetrics.slice(0, 3).map((topic, index) => ({
      label: topic.topic || `Topic ${index + 1}`,
      value: Number(topic.accuracy || 0),
      color: index % 2 === 0 ? 'blue' : index % 3 === 0 ? 'purple' : 'pink'
    }))
  }, [analytics])

  const firstName = user?.name?.split(' ')[0] || 'Student'

  return (
    <div className="dashboard-page">
      <div className="dashboard-top-row">
        <div className="hero-banner">
          <div className="hero-rings hero-ring-left" />
          <div className="hero-rings hero-ring-right" />
          <div className="hero-rings hero-ring-bottom" />

          <div className="hero-content">
            <h1>Effective education!</h1>
            <p>
              Welcome back, {firstName}. Your learning dashboard is synced with your real course activity and academic progress.
            </p>
          </div>
        </div>

        <aside className="course-overview">
          <div className="course-overview-header">
            <span>Your Courses</span>
            <Link to="/courses">More →</Link>
          </div>

          <div className="course-list">
            {loading ? (
              <div className="mini-course">Loading courses...</div>
            ) : courseList.length ? (
              courseList.map((course) => (
                <div key={`${course.name}-${course.code}`} className={`mini-course ${course.color}`}>
                  <div className="mini-course-dot" />
                  <div className="mini-course-copy">
                    <span>{course.name}</span>
                    <small>{course.hours}</small>
                  </div>
                  <span className="mini-course-arrow">›</span>
                </div>
              ))
            ) : (
              <div className="mini-course">
                <div className="mini-course-copy">
                  <span>No courses yet</span>
                  <small>Your department courses will appear here</small>
                </div>
              </div>
            )}
          </div>

          <Link to="/upgrade" className="premium-panel" aria-label="Upgrade to premium">
            <div className="premium-graphic" aria-hidden="true" />
            <span className="premium-panel-button">
              {user?.subscriptionType === 'premium' ? 'Premium active' : 'Upgrade to Premium →'}
            </span>
          </Link>
        </aside>
      </div>

      <div className="dashboard-lower-row">
        <div className="left-panel">
          <div className="section-toolbar">
            <h2>Progress snapshot</h2>
            <Link to="/analytics">More →</Link>
          </div>

          <div className="event-grid">
            {statCards.map((item) => (
              <div key={`${item.time}-${item.label}`} className={`event-card ${item.tone}`}>
                <div className="event-date">{item.date}</div>
                <div className="event-time">{item.time}</div>
                <div className="event-label">{item.label}</div>
              </div>
            ))}
          </div>

          <div className="progress-panel">
            <div className="section-toolbar compact">
              <h2>Performance &amp; progress</h2>
              <Link to="/analytics">More →</Link>
            </div>

            <div className="mini-chart-wrap">
              <div className="mini-chart">
                <span className="chart-bar chart-bar-one" />
                <span className="chart-bar chart-bar-two" />
                <span className="chart-bar chart-bar-three" />
                <span className="chart-bar chart-bar-four" />
                <span className="chart-bar chart-bar-five" />
              </div>
            </div>

            <div className="progress-list">
              {progressData.length ? (
                progressData.map((item) => (
                  <div key={item.label} className="progress-item">
                    <div className="progress-label-row">
                      <span>{item.label}</span>
                      <strong>{item.value}%</strong>
                    </div>
                    <div className="progress-track">
                      <span className={`progress-fill ${item.color}`} style={{ width: `${item.value}%` }} />
                    </div>
                  </div>
                ))
              ) : (
                <div className="progress-item">
                  <div className="progress-label-row">
                    <span>No progress data yet</span>
                    <strong>0%</strong>
                  </div>
                  <div className="progress-track">
                    <span className="progress-fill blue" style={{ width: '0%' }} />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
