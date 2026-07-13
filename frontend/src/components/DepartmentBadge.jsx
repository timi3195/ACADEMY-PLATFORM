import React from 'react'

export default function DepartmentBadge({ department }) {
  if (!department) return null
  return <span className="badge badge-department">{department.name || department.code}</span>
}
