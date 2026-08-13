import React, { useEffect, useState } from 'react';
import { apiGet, apiPatch } from '../utils/api';

export default function AdminLecturerManagement() {
  const [lecturers, setLecturers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('pending');

  const loadLecturers = async () => {
    try {
      setLoading(true);
      const response = await apiGet(`/api/admin/lecturers?status=${statusFilter}`);
      setLecturers(response.lecturers || []);
      setError('');
    } catch (err) {
      setError(err?.body?.message || err?.message || 'Unable to load lecturer applications.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLecturers();
  }, [statusFilter]);

  const updateStatus = async (userId, action, reason = '') => {
    try {
      const endpoint = action === 'approve' ? `/api/admin/lecturers/${userId}/approve` : `/api/admin/lecturers/${userId}/reject`;
      await apiPatch(endpoint, { reason });
      await loadLecturers();
    } catch (err) {
      setError(err?.body?.message || err?.message || 'Unable to update lecturer status.');
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-6 py-10">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-blue-600">Admin</p>
          <h1 className="mt-2 text-3xl font-bold text-slate-900">Lecturer applications</h1>
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-xl border border-slate-300 px-4 py-3"
        >
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
      </div>

      {error && (
        <div className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      <div className="mt-8 space-y-4">
        {loading ? (
          <div className="rounded-xl border border-slate-200 bg-white p-6 text-slate-600">Loading lecturer applications...</div>
        ) : lecturers.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-500">
            No {statusFilter} applications found.
          </div>
        ) : (
          lecturers.map((lecturer) => (
            <div key={lecturer._id} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="text-xl font-bold text-slate-900">{lecturer.name}</h2>
                  <p className="text-sm text-slate-600">{lecturer.email}</p>
                  <p className="text-sm text-slate-500">{lecturer.department?.name || 'No department'} • {lecturer.lecturerProfile?.institution || 'Unknown institution'}</p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="rounded-xl bg-green-600 px-4 py-2 text-sm font-semibold text-white"
                    onClick={() => updateStatus(lecturer._id, 'approve')}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white"
                    onClick={() => updateStatus(lecturer._id, 'reject', 'Application does not meet our requirements.')}
                  >
                    Reject
                  </button>
                </div>
              </div>

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div className="rounded-xl bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Specialty</p>
                  <p className="mt-2 text-slate-800">{lecturer.lecturerProfile?.specialty || 'Not provided'}</p>
                </div>
                <div className="rounded-xl bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Experience</p>
                  <p className="mt-2 text-slate-800">{lecturer.lecturerProfile?.experience || 'Not provided'}</p>
                </div>
              </div>

              <div className="mt-4 rounded-xl bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Bio</p>
                <p className="mt-2 text-slate-800">{lecturer.lecturerProfile?.bio || 'Not provided'}</p>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
