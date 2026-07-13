import React from 'react'

export default function CourseBadge({ course }) {
  if (!course) return null
  return <span className="badge badge-course">{course.title || course.code || 'Course'}</span>
}
