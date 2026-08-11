import React, { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { apiGet, apiPost } from '../utils/api';

const initialForm = {
  name: '',
  email: '',
  password: '',
  confirmPassword: '',
  department: '',
  yearOfStudy: '',
  semester: 'First'
};

const getErrorMessage = (error, fallback) => error?.body?.message || error?.message || fallback;

const Register = () => {
  const [formData, setFormData] = useState(initialForm);
  const [departments, setDepartments] = useState([]);
  const [departmentsLoading, setDepartmentsLoading] = useState(true);
  const [departmentsError, setDepartmentsError] = useState('');
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const navigate = useNavigate();
  const apiBase = import.meta.env.VITE_API_BASE || 'http://localhost:5000';

  useEffect(() => {
    fetchDepartments();
  }, []);

  const fetchDepartments = async () => {
    try {
      setDepartmentsLoading(true);
      setDepartmentsError('');

      const response = await apiGet('/api/departments');

      if (response && Array.isArray(response.departments)) {
        setDepartments(response.departments);
        if (response.departments.length === 0) {
          setDepartmentsError('No departments are available yet. Please contact your administrator.');
        }
      } else {
        throw new Error(response?.message || 'Unable to load departments');
      }
    } catch (error) {
      setDepartmentsError(getErrorMessage(error, 'Unable to load departments right now.'));
    } finally {
      setDepartmentsLoading(false);
    }
  };

  const handleChange = (event) => {
    const { name, value } = event.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: '' }));
    }
  };

  const validateForm = () => {
    const nextErrors = {};

    if (!formData.name.trim()) nextErrors.name = 'Your full name is required.';
    if (!formData.email.trim()) nextErrors.email = 'Email is required.';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) nextErrors.email = 'Enter a valid email address.';
    if (!formData.department) nextErrors.department = 'Please select your department.';
    if (!formData.yearOfStudy) nextErrors.yearOfStudy = 'Please select your academic level.';
    if (!formData.semester) nextErrors.semester = 'Please select your semester.';
    if (!formData.password) nextErrors.password = 'Create a password.';
    else if (formData.password.length < 8) nextErrors.password = 'Password must be at least 8 characters.';
    if (!formData.confirmPassword) nextErrors.confirmPassword = 'Please confirm your password.';
    else if (formData.password !== formData.confirmPassword) nextErrors.confirmPassword = 'Passwords do not match.';

    return nextErrors;
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const nextErrors = validateForm();

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    setLoading(true);
    setErrors({});

    try {
      const response = await apiPost('/api/auth/register', formData);
      if (response?.success) {
        setSuccess(true);
        setFormData(initialForm);
        setTimeout(() => navigate('/verify-email', { state: { email: formData.email } }), 1500);
      }
    } catch (error) {
      setErrors({ submit: getErrorMessage(error, 'Registration failed. Please try again.') });
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = () => {
    window.location.href = `${apiBase}/api/auth/google`;
  };

  return (
    <div className="auth-card auth-card--wide">
      <div className="auth-card__header auth-card__header--stacked">
        <div className="auth-brand" aria-label="AcademicHUB home">
          <span className="auth-brand__mark">A</span>
          <span className="auth-brand__text">AcademicHUB</span>
        </div>
        <div>
          <p className="auth-card__eyebrow">Start learning smarter</p>
          <h1 className="auth-card__title">Create your account</h1>
        </div>
      </div>

      {success && (
        <div className="auth-notice auth-notice--success" role="status">
          Registration successful. Please check your email to verify your account before logging in.
        </div>
      )}

      {errors.submit && (
        <div className="auth-notice auth-notice--error" role="alert">
          {errors.submit}
        </div>
      )}

      <form onSubmit={handleSubmit} className="auth-form" noValidate>
        <div className="auth-field">
          <label htmlFor="name">Full name</label>
          <input
            id="name"
            name="name"
            type="text"
            value={formData.name}
            onChange={handleChange}
            placeholder="Jane Doe"
            autoComplete="name"
            disabled={loading}
            className={errors.name ? 'error' : ''}
          />
          {errors.name && <span className="auth-field__error">{errors.name}</span>}
        </div>

        <div className="auth-field-row">
          <div className="auth-field">
            <label htmlFor="email">Email address</label>
            <input
              id="email"
              name="email"
              type="email"
              value={formData.email}
              onChange={handleChange}
              placeholder="student@school.edu.ng"
              autoComplete="email"
              disabled={loading}
              className={errors.email ? 'error' : ''}
            />
            {errors.email && <span className="auth-field__error">{errors.email}</span>}
          </div>

          <div className="auth-field">
            <label htmlFor="department">Department</label>
            <select
              id="department"
              name="department"
              value={formData.department}
              onChange={handleChange}
              disabled={loading || departmentsLoading}
              className={errors.department ? 'error' : ''}
            >
              <option value="">Select department</option>
              {departments.map((department) => (
                <option key={department._id} value={department._id}>
                  {department.name}
                </option>
              ))}
            </select>
            {errors.department && <span className="auth-field__error">{errors.department}</span>}
          </div>
        </div>

        <div className="auth-field-row">
          <div className="auth-field">
            <label htmlFor="yearOfStudy">Academic level</label>
            <select
              id="yearOfStudy"
              name="yearOfStudy"
              value={formData.yearOfStudy}
              onChange={handleChange}
              disabled={loading}
              className={errors.yearOfStudy ? 'error' : ''}
            >
              <option value="">Select level</option>
              <option value="ND1">ND1</option>
              <option value="ND2">ND2</option>
              <option value="HND1">HND1</option>
              <option value="HND2">HND2</option>
            </select>
            {errors.yearOfStudy && <span className="auth-field__error">{errors.yearOfStudy}</span>}
          </div>

          <div className="auth-field">
            <label htmlFor="semester">Semester</label>
            <select
              id="semester"
              name="semester"
              value={formData.semester}
              onChange={handleChange}
              disabled={loading}
              className={errors.semester ? 'error' : ''}
            >
              <option value="First">First Semester</option>
              <option value="Second">Second Semester</option>
            </select>
            {errors.semester && <span className="auth-field__error">{errors.semester}</span>}
          </div>
        </div>

        <div className="auth-field-row">
          <div className="auth-field auth-field--with-action">
            <label htmlFor="password">Password</label>
            <div className="auth-input-wrap">
              <input
                id="password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                value={formData.password}
                onChange={handleChange}
                placeholder="Create a strong password"
                autoComplete="new-password"
                disabled={loading}
                className={errors.password ? 'error' : ''}
              />
              <button
                type="button"
                className="auth-toggle"
                onClick={() => setShowPassword((value) => !value)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
            {errors.password && <span className="auth-field__error">{errors.password}</span>}
          </div>

          <div className="auth-field auth-field--with-action">
            <label htmlFor="confirmPassword">Confirm password</label>
            <div className="auth-input-wrap">
              <input
                id="confirmPassword"
                name="confirmPassword"
                type={showConfirmPassword ? 'text' : 'password'}
                value={formData.confirmPassword}
                onChange={handleChange}
                placeholder="Re-enter password"
                autoComplete="new-password"
                disabled={loading}
                className={errors.confirmPassword ? 'error' : ''}
              />
              <button
                type="button"
                className="auth-toggle"
                onClick={() => setShowConfirmPassword((value) => !value)}
                aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
              >
                {showConfirmPassword ? 'Hide' : 'Show'}
              </button>
            </div>
            {errors.confirmPassword && <span className="auth-field__error">{errors.confirmPassword}</span>}
          </div>
        </div>

        <div className="auth-helper-text">Use at least 8 characters with a mix of letters and numbers.</div>

        {departmentsError && <div className="auth-notice auth-notice--error">{departmentsError}</div>}

        <button type="submit" className="auth-button auth-button--primary" disabled={loading || departmentsLoading}>
          {loading ? 'Creating account...' : 'Create account'}
        </button>
      </form>

      <div className="auth-divider"><span>or</span></div>

      <button type="button" className="auth-button auth-button--secondary" onClick={handleGoogleLogin}>
        Continue with Google
      </button>

      <p className="auth-footer-text">
        Already have an account? <Link to="/login">Sign in</Link>
      </p>
    </div>
  );
};

export default Register;
