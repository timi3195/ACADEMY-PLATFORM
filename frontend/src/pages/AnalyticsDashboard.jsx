import React, { useState, useEffect } from "react";
import axios from "axios";
import PremiumGate from "../components/PremiumGate";
import { apiGet } from "../utils/api";
import "./AnalyticsDashboard.css";

// Mock data for a fictional ND2 Computer Science student
const MOCK_STUDENT_DATA = {
  name: "Chioma Okafor",
  program: "ND2 Computer Science",
  department: "Computer Science",
  semester: "2025/2026 - Semester II",
  overallAccuracy: 76.5,
  examReadiness: 72,
  enrolledCourses: 5,
  coursesStrength: ["Data Structures", "Web Development"],
  coursesWeakness: ["Advanced Algorithms", "Database Design"],
  engagement: {
    conversations: 24,
    processedNotes: 8,
    learningPaths: 3
  }
};

// Mock performance data by topic
const MOCK_TOPIC_DATA = [
  { topic: "Arrays & Lists", accuracy: 88, attempts: 12, mastery: "Mastered" },
  { topic: "Pointers", accuracy: 76, attempts: 9, mastery: "Proficient" },
  { topic: "Linked Lists", accuracy: 82, attempts: 8, mastery: "Mastered" },
  { topic: "Trees & Graphs", accuracy: 68, attempts: 6, mastery: "Proficient" },
  { topic: "Sorting Algorithms", accuracy: 72, attempts: 7, mastery: "Proficient" },
  { topic: "Dynamic Programming", accuracy: 45, attempts: 5, mastery: "Developing" },
  { topic: "Hash Tables", accuracy: 79, attempts: 6, mastery: "Proficient" },
  { topic: "String Manipulation", accuracy: 85, attempts: 10, mastery: "Mastered" }
];

// Mock performance trend data (last 8 weeks)
const MOCK_TREND_DATA = [
  { week: "Week 1", accuracy: 65, attempts: 12 },
  { week: "Week 2", accuracy: 68, attempts: 14 },
  { week: "Week 3", accuracy: 71, attempts: 16 },
  { week: "Week 4", accuracy: 69, attempts: 15 },
  { week: "Week 5", accuracy: 74, attempts: 18 },
  { week: "Week 6", accuracy: 73, attempts: 17 },
  { week: "Week 7", accuracy: 76, attempts: 19 },
  { week: "Week 8", accuracy: 76.5, attempts: 21 }
];

// Mock departmental average (anonymized)
const DEPARTMENTAL_AVG = 68.2;

const SimpleLineChart = ({ data, dataKey, color = "#667eea" }) => {
  const width = 500;
  const height = 200;
  const padding = 40;
  const maxValue = Math.max(...data.map(d => d[dataKey]));
  const minValue = Math.min(...data.map(d => d[dataKey]));
  const range = maxValue - minValue || 1;

  const points = data.map((d, i) => {
    const x = padding + (i / (data.length - 1)) * (width - 2 * padding);
    const y = height - padding - ((d[dataKey] - minValue) / range) * (height - 2 * padding);
    return { x, y, value: d[dataKey] };
  });

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

  return (
    <svg width={width} height={height} className="chart-svg">
      {/* Y-axis */}
      <line x1={padding} y1={padding} x2={padding} y2={height - padding} stroke="#e0e0e0" strokeWidth="2" />
      {/* X-axis */}
      <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="#e0e0e0" strokeWidth="2" />
      
      {/* Y-axis labels */}
      {[0, 0.5, 1].map((v, i) => {
        const val = minValue + (v * range);
        const y = height - padding - (v * (height - 2 * padding));
        return (
          <text key={i} x={padding - 35} y={y + 5} fontSize="12" fill="#999" textAnchor="end">
            {Math.round(val)}
          </text>
        );
      })}

      {/* X-axis labels */}
      {data.map((d, i) => {
        if (i % Math.max(1, Math.floor(data.length / 4)) === 0) {
          const x = padding + (i / (data.length - 1)) * (width - 2 * padding);
          return (
            <text key={i} x={x} y={height - padding + 20} fontSize="11" fill="#999" textAnchor="middle">
              {d.week || i}
            </text>
          );
        }
        return null;
      })}

      {/* Line path */}
      <path d={pathD} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

      {/* Data points */}
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="4" fill={color} opacity="0.8" />
      ))}
    </svg>
  );
};

const AnalyticsDashboard = () => {
  const [courses, setCourses] = useState([]);
  const [selectedCourse, setSelectedCourse] = useState(null);
  const [loading, setLoading] = useState(true);
  const [studentData, setStudentData] = useState(null);
  const [topicData, setTopicData] = useState(MOCK_TOPIC_DATA);
  const [trendData, setTrendData] = useState(MOCK_TREND_DATA);
  const [departmentalAvg, setDepartmentalAvg] = useState(DEPARTMENTAL_AVG);
  const [usingRealData, setUsingRealData] = useState(false);
  const [error, setError] = useState(null);

  const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

  // Load all dashboard data on component mount
  useEffect(() => {
    loadAllData();
  }, []);

  // Load performance data when course changes
  useEffect(() => {
    if (selectedCourse && studentData) {
      loadCoursePerformance(selectedCourse._id);
    }
  }, [selectedCourse]);

  const loadAllData = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem("token");
      
      // Fetch courses
      const coursesRes = await apiGet('/api/courses');
      setCourses(coursesRes.courses || []);
      if (coursesRes.courses?.length > 0) {
        setSelectedCourse(coursesRes.courses[0]);
      }

      // Fetch dashboard overview
      try {
        const dashRes = await axios.get(`${API_BASE}/analytics/dashboard`, {
          headers: { Authorization: `Bearer ${token}` }
        });

        if (dashRes.data?.student) {
          // Real student data from backend
          const realStudent = {
            name: dashRes.data.student.name || "Student",
            program: dashRes.data.student.program || "Unknown",
            department: dashRes.data.student.department || "Unknown",
            semester: dashRes.data.student.semester || "Current Semester",
            overallAccuracy: dashRes.data.overall?.accuracy || MOCK_STUDENT_DATA.overallAccuracy,
            examReadiness: dashRes.data.overall?.examReadiness || MOCK_STUDENT_DATA.examReadiness,
            enrolledCourses: coursesRes.courses?.length || 0,
            engagement: {
              conversations: dashRes.data.engagement?.conversations || 0,
              processedNotes: dashRes.data.engagement?.processedNotes || 0,
              learningPaths: dashRes.data.engagement?.learningPaths || 0
            }
          };
          setStudentData(realStudent);
          setUsingRealData(true);

          // Set departmental average if available
          if (dashRes.data.departmentalAvg) {
            setDepartmentalAvg(dashRes.data.departmentalAvg);
          }

          // Set topic data if available
          if (dashRes.data.topicMetrics?.length > 0) {
            const topics = dashRes.data.topicMetrics.map(t => ({
              topic: t.name,
              accuracy: Math.round(t.accuracy),
              attempts: t.attempts,
              mastery: t.accuracy >= 80 ? "Mastered" : t.accuracy >= 60 ? "Proficient" : "Developing"
            }));
            setTopicData(topics);
          }

          // Set trend data if available
          if (dashRes.data.performanceTrend?.length > 0) {
            const trends = dashRes.data.performanceTrend.map((t, idx) => ({
              week: `Week ${idx + 1}`,
              accuracy: Math.round(t.accuracy),
              attempts: t.attempts
            }));
            setTrendData(trends);
          }
        }
      } catch (dashError) {
        console.warn("Dashboard data not available, using mock data:", dashError.message);
        setStudentData(MOCK_STUDENT_DATA);
      }

      setError(null);
    } catch (error) {
      console.error("Error loading dashboard:", error);
      setError(error.message);
      setStudentData(MOCK_STUDENT_DATA);
    } finally {
      setLoading(false);
    }
  };

  const loadCoursePerformance = async (courseId) => {
    try {
      const token = localStorage.getItem("token");

      const perfRes = await axios.get(
        `${API_BASE}/analytics/performance/${courseId}`,
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );

      if (perfRes.data?.topicMetrics?.length > 0) {
        const topics = perfRes.data.topicMetrics.map(t => ({
          topic: t.topic,
          accuracy: Math.round(t.accuracy),
          attempts: t.attempts,
          mastery: t.accuracy >= 80 ? "Mastered" : t.accuracy >= 60 ? "Proficient" : "Developing"
        }));
        setTopicData(topics);

        // Update student accuracy for this course
        if (perfRes.data.overallAccuracy && studentData) {
          setStudentData(prev => ({
            ...prev,
            overallAccuracy: Math.round(perfRes.data.overallAccuracy)
          }));
        }
      }
    } catch (error) {
      console.warn("Performance data not available:", error.message);
      // Keep existing mock data
    }
  };

  // Use real data if available, otherwise mock data
  const mockData = studentData || MOCK_STUDENT_DATA;
  const activeTrendData = trendData;

  // Calculate strengths and weaknesses FIRST
  const strengths = topicData.filter(t => t.accuracy >= 75).map(t => t.topic);
  const weaknesses = topicData.filter(t => t.accuracy < 65).map(t => t.topic);

  // Get top weakness for recommendations
  const topWeakness = weaknesses.length > 0 ? weaknesses[0] : "Dynamic Programming";
  const topWeaknessData = topicData.find(t => t.topic === topWeakness);
  const topWeaknessAccuracy = topWeaknessData?.accuracy || 45;

  // Get second weakness
  const secondWeakness = weaknesses.length > 1 ? weaknesses[1] : "Advanced Algorithms";
  const secondWeaknessData = topicData.find(t => t.topic === secondWeakness);
  const secondWeaknessAccuracy = secondWeaknessData?.accuracy || 68;

  // Get top strengths for congratulations
  const topStrengths = strengths.slice(0, 3).join(", ");

  return (
    <PremiumGate feature="Performance Analytics">
      <div className="page analytics-dashboard">
        {/* Header */}
        <div className="analytics-header">
          <div>
            <h1>📊 Performance Analytics</h1>
            <p>Comprehensive insights into your learning progress</p>
          </div>
          <div className="header-info">
            <div className="info-item">
              <span className="label">Student</span>
              <span className="value">{mockData.name}</span>
            </div>
            <div className="info-item">
              <span className="label">Program</span>
              <span className="value">{mockData.program}</span>
            </div>
            {usingRealData && (
              <div className="info-item">
                <span className="data-badge real">✓ Real Data</span>
              </div>
            )}
            {!usingRealData && !loading && (
              <div className="info-item">
                <span className="data-badge demo">📋 Demo Data</span>
              </div>
            )}
          </div>
        </div>

        {/* Loading Indicator */}
        {loading && (
          <div className="loading-banner">
            <span>⏳ Loading your performance data...</span>
          </div>
        )}

        {/* Error Indicator */}
        {error && (
          <div className="error-banner">
            <span>⚠️ Could not load real data: {error}</span>
            <p style={{margin: '0.5rem 0 0 0', fontSize: '0.9rem'}}>Showing sample data for demonstration</p>
          </div>
        )}

        {/* Course Selector */}
        {courses.length > 0 && (
          <div className="course-selector">
            <label>📚 Select Course:</label>
            <select
              value={selectedCourse?._id || ""}
              onChange={(e) => {
                const course = courses.find(c => c._id === e.target.value);
                setSelectedCourse(course);
              }}
              className="course-select"
            >
              {courses.map(course => (
                <option key={course._id} value={course._id}>
                  {course.title} ({course.code})
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Key Metrics - Premium Layout */}
        <div className="metrics-section">
          <h2 className="section-title">📊 Your Performance Snapshot</h2>
          <div className="metrics-grid">
            {/* Accuracy Card - Large Feature */}
            <div className="metric-card primary large-card">
              <div className="metric-header">
                <div className="metric-icon-large">📈</div>
                <div>
                  <p className="metric-label">Overall Accuracy</p>
                  <p className="metric-subtitle">Your mastery level across all topics</p>
                </div>
              </div>
              <div className="metric-body">
                <p className="metric-value-large">{mockData.overallAccuracy}%</p>
                <div className="progress-bar large">
                  <div 
                    className="progress-fill" 
                    style={{ width: `${mockData.overallAccuracy}%` }}
                  ></div>
                </div>
                <div className="progress-labels">
                  <span className="label-0">0%</span>
                  <span className="label-mid">50%</span>
                  <span className="label-100">100%</span>
                </div>
                <div className="achievement-badge">
                  {mockData.overallAccuracy >= 80 ? '⭐ Excellent' : mockData.overallAccuracy >= 70 ? '✨ Strong' : '📈 On Track'}
                </div>
              </div>
            </div>

            {/* Exam Readiness Card */}
            <div className="metric-card primary">
              <div className="metric-icon">🎯</div>
              <div className="metric-content">
                <p className="metric-label">Exam Readiness</p>
                <div className="circular-progress">
                  <svg viewBox="0 0 120 120">
                    <circle cx="60" cy="60" r="54" className="bg" />
                    <circle 
                      cx="60" 
                      cy="60" 
                      r="54" 
                      className="progress"
                      style={{
                        strokeDasharray: `${(mockData.examReadiness / 100) * 339.3} 339.3`
                      }}
                    />
                  </svg>
                  <div className="circle-text">
                    <p className="circle-value">{mockData.examReadiness}%</p>
                  </div>
                </div>
                <p className={`readiness-status status-${mockData.examReadiness > 80 ? 'excellent' : mockData.examReadiness > 70 ? 'good' : 'fair'}`}>
                  {mockData.examReadiness > 80 ? '🟢 Ready' : mockData.examReadiness > 70 ? '🟢 Good' : '🟡 Building'}
                </p>
              </div>
            </div>

            {/* Engagement Metrics */}
            <div className="metric-card">
              <div className="metric-icon">💬</div>
              <div className="metric-content">
                <p className="metric-label">AI Tutoring</p>
                <p className="metric-value engagement">{mockData.engagement.conversations}</p>
                <p className="metric-subtext">Learning conversations</p>
                <div className="micro-progress" style={{width: `${(mockData.engagement.conversations / 30) * 100}%`}}></div>
              </div>
            </div>

            <div className="metric-card">
              <div className="metric-icon">📝</div>
              <div className="metric-content">
                <p className="metric-label">Study Materials</p>
                <p className="metric-value engagement">{mockData.engagement.processedNotes}</p>
                <p className="metric-subtext">Enhanced study notes</p>
                <div className="micro-progress" style={{width: `${(mockData.engagement.processedNotes / 12) * 100}%`}}></div>
              </div>
            </div>

            <div className="metric-card">
              <div className="metric-icon">🎓</div>
              <div className="metric-content">
                <p className="metric-label">Growth Paths</p>
                <p className="metric-value engagement">{mockData.engagement.learningPaths}</p>
                <p className="metric-subtext">Personalized plans started</p>
                <div className="micro-progress" style={{width: `${(mockData.engagement.learningPaths / 5) * 100}%`}}></div>
              </div>
            </div>

            {/* Comparison Card */}
            <div className="metric-card comparison">
              <div className="metric-icon">📊</div>
              <div className="metric-content">
                <p className="metric-label">Class Standing</p>
                <div className="comparison-display">
                  <div className="you">
                    <span className="comp-label">You</span>
                    <span className="comp-value">{mockData.overallAccuracy}%</span>
                  </div>
                  <div className="vs">vs</div>
                  <div className="average">
                    <span className="comp-label">Class Avg</span>
                    <span className="comp-value">{departmentalAvg}%</span>
                  </div>
                </div>
                <p className="comparison-text">
                  {mockData.overallAccuracy > departmentalAvg ? `🔝 +${(mockData.overallAccuracy - departmentalAvg).toFixed(1)}% above average` : `📍 ${Math.abs(mockData.overallAccuracy - departmentalAvg).toFixed(1)}% below average`}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Strength vs Weakness */}
        <div className="strength-weakness-section">
          <div className="strength-box">
            <h3>🟢 Top Strengths</h3>
            <ul className="topics-list">
              {strengths.length > 0 ? strengths.map((topic, idx) => {
                const topic_data = topicData.find(t => t.topic === topic);
                return (
                  <li key={idx} className="topic-item">
                    <div className="topic-info">
                      <span className="topic-name">✓ {topic}</span>
                      <span className="topic-accuracy">{topic_data?.accuracy}%</span>
                    </div>
                  </li>
                );
              }) : <li className="topic-item" style={{color: '#999'}}>Keep practicing to build strengths</li>}
            </ul>
          </div>

          <div className="weakness-box">
            <h3>🔴 Areas for Improvement</h3>
            <ul className="topics-list">
              {weaknesses.length > 0 ? weaknesses.map((topic, idx) => {
                const topic_data = topicData.find(t => t.topic === topic);
                return (
                  <li key={idx} className="topic-item weak">
                    <div className="topic-info">
                      <span className="topic-name">◆ {topic}</span>
                      <span className="topic-accuracy">{topic_data?.accuracy}%</span>
                    </div>
                  </li>
                );
              }) : <li className="topic-item" style={{color: '#999'}}>Great! No major weak areas</li>}
            </ul>
          </div>
        </div>

        {/* Topics Section - Premium */}
        <div className="topics-section">
          <div className="section-header">
            <h2>📚 Topic Mastery Breakdown</h2>
            <p className="section-description">Track your progress on each topic and identify areas to focus on</p>
          </div>
          <div className="topics-table premium">
            <div className="table-header">
              <div className="col-topic">Topic</div>
              <div className="col-accuracy">Accuracy</div>
              <div className="col-level">Status</div>
              <div className="col-action">Progress</div>
            </div>
            {topicData
              .sort((a, b) => b.accuracy - a.accuracy)
              .map((topic, idx) => {
                const isStrength = topic.accuracy >= 75;
                const isWeak = topic.accuracy < 65;
                return (
                  <div key={idx} className={`table-row ${isStrength ? 'strength-row' : isWeak ? 'weak-row' : ''}`}>
                    <div className="col-topic">
                      <span className="topic-badge">{isStrength ? '⭐' : isWeak ? '⚠️' : '✓'}</span>
                      {topic.topic}
                    </div>
                    <div className="col-accuracy">
                      <div className="mini-progress-container">
                        <div className="mini-progress">
                          <div
                            className="mini-progress-fill"
                            style={{ 
                              width: `${topic.accuracy}%`,
                              background: topic.accuracy >= 80 ? '#10b981' : topic.accuracy >= 60 ? '#f59e0b' : '#ef4444'
                            }}
                          ></div>
                        </div>
                        <span className="accuracy-text">{topic.accuracy}%</span>
                      </div>
                    </div>
                    <div className="col-level">
                      <span className={`level-badge level-${
                        topic.accuracy >= 80 ? 'mastered' :
                        topic.accuracy >= 60 ? 'proficient' : 'developing'
                      }`}>
                        {topic.mastery}
                      </span>
                    </div>
                    <div className="col-action">
                      <button className={`action-btn ${topic.accuracy < 75 ? 'practice' : 'advance'}`}>
                        {topic.accuracy < 60 ? '🔄 Practice' : topic.accuracy < 75 ? '📖 Review' : '🚀 Master'}
                      </button>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>

        {/* Performance Trend */}
        <div className="trend-section">
          <h2>📈 Performance Trend (Last 8 Weeks)</h2>
          <div className="trend-chart">
            <SimpleLineChart data={activeTrendData} dataKey="accuracy" color="#667eea" />
            <div className="trend-stats">
              <div className="trend-stat">
                <span className="stat-label">Starting Accuracy</span>
                <span className="stat-value">{activeTrendData[0].accuracy}%</span>
              </div>
              <div className="trend-stat">
                <span className="stat-label">Current Accuracy</span>
                <span className="stat-value">{activeTrendData[activeTrendData.length - 1].accuracy}%</span>
              </div>
              <div className="trend-stat positive">
                <span className="stat-label">Improvement</span>
                <span className="stat-value">+{(activeTrendData[activeTrendData.length - 1].accuracy - activeTrendData[0].accuracy).toFixed(1)}%</span>
              </div>
              <div className="trend-stat">
                <span className="stat-label">Total Questions</span>
                <span className="stat-value">{activeTrendData.reduce((sum, d) => sum + d.attempts, 0)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Recommendations */}
        <div className="recommendations-section">
          <div className="section-header">
            <h2>💡 Personalized Study Roadmap</h2>
            <p className="section-description">AI-generated recommendations based on your learning patterns</p>
          </div>
          <div className="recommendations-grid">
            <div className="recommendation-card priority-high animated">
              <div className="card-header">
                <div className="priority-badge high">URGENT</div>
                <div className="priority-icon">🔥</div>
              </div>
              <h4>{topWeakness}</h4>
              <p className="accuracy-note">Current: {topWeaknessAccuracy}% → Target: 75%+</p>
              <p>This topic is critical for exam success. Master the fundamentals with guided practice and AI explanations.</p>
              <div className="action-items">
                <button className="btn-primary">📖 Start Learning</button>
                <button className="btn-secondary">🤖 Ask Tutor</button>
              </div>
            </div>

            <div className="recommendation-card priority-medium animated" style={{animationDelay: '0.1s'}}>
              <div className="card-header">
                <div className="priority-badge medium">IMPORTANT</div>
                <div className="priority-icon">📈</div>
              </div>
              <h4>{secondWeakness}</h4>
              <p className="accuracy-note">Current: {secondWeaknessAccuracy}% → Target: 80%+</p>
              <p>You're making good progress here. Review key concepts and tackle harder problems to reach mastery.</p>
              <div className="action-items">
                <button className="btn-primary">🧠 Review Notes</button>
                <button className="btn-secondary">❓ Practice More</button>
              </div>
            </div>

            <div className="recommendation-card priority-low animated" style={{animationDelay: '0.2s'}}>
              <div className="card-header">
                <div className="priority-badge low">MAINTAIN</div>
                <div className="priority-icon">⭐</div>
              </div>
              <h4>Strengthen Your Wins</h4>
              <p className="accuracy-note">Excellent work on: {topStrengths}</p>
              <p>Keep the momentum going! Challenge yourself with advanced problems to deepen mastery.</p>
              <div className="action-items">
                <button className="btn-primary">🚀 Advanced Problems</button>
                <button className="btn-secondary">🏆 Earn Badges</button>
              </div>
            </div>

            <div className="recommendation-card insight animated" style={{animationDelay: '0.3s'}}>
              <div className="card-header">
                <div className="priority-badge insight-badge">INSIGHT</div>
                <div className="priority-icon">📊</div>
              </div>
              <h4>Your Learning Velocity</h4>
              <p className="accuracy-note">+{(activeTrendData[activeTrendData.length - 1].accuracy - activeTrendData[0].accuracy).toFixed(1)}% improvement in 8 weeks</p>
              <p>At this pace, you'll reach 80%+ accuracy by exam day. Stay consistent with daily practice!</p>
              <div className="action-items">
                <button className="btn-primary">📅 Set Goals</button>
                <button className="btn-secondary">📊 See Trends</button>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Note */}
        <div className="analytics-footer">
          {usingRealData ? (
            <p>✅ <strong>Real Data Connected:</strong> This dashboard is displaying your actual performance metrics from the backend API.</p>
          ) : (
            <p>📌 <strong>Demo Mode:</strong> Showing sample data for demonstration. Your real performance metrics will appear here once the backend API is connected.</p>
          )}
        </div>
      </div>

      <style>{`
        .analytics-dashboard {
          display: flex;
          flex-direction: column;
          gap: 2rem;
        }

        .loading-banner {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          background: linear-gradient(135deg, #e0e7ff 0%, #f3e8ff 100%);
          border: 1px solid #c7d2fe;
          border-radius: 8px;
          padding: 0.75rem 1rem;
          color: #4c1d95;
          font-weight: 500;
          font-size: 0.95rem;
          animation: pulse 1.5s ease-in-out infinite;
        }

        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.8; }
        }

        .error-banner {
          background: linear-gradient(135deg, #fef3f2 0%, #fef08a 100%);
          border: 1px solid #fca5a5;
          border-radius: 8px;
          padding: 0.75rem 1rem;
          color: #991b1b;
          font-weight: 500;
          font-size: 0.95rem;
        }

        .data-badge {
          display: inline-block;
          padding: 0.3rem 0.8rem;
          border-radius: 20px;
          font-size: 0.8rem;
          font-weight: 600;
          text-transform: uppercase;
        }

        .data-badge.real {
          background: #d1fae5;
          color: #065f46;
        }

        .data-badge.demo {
          background: #fef3c7;
          color: #92400e;
        }

        .analytics-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 2rem;
          padding-bottom: 1rem;
          border-bottom: 2px solid #f0f0f0;
        }

        .analytics-header h1 {
          margin: 0;
          font-size: 2rem;
          color: #1a1a1a;
        }

        .analytics-header p {
          margin: 0.5rem 0 0 0;
          color: #666;
        }

        .header-info {
          display: flex;
          gap: 2rem;
          padding-top: 0.5rem;
        }

        .info-item {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }

        .info-item .label {
          font-size: 0.8rem;
          color: #999;
          text-transform: uppercase;
        }

        .info-item .value {
          font-weight: 600;
          color: #333;
        }

        .course-selector {
          display: flex;
          align-items: center;
          gap: 1rem;
          background: linear-gradient(135deg, #667eea15 0%, #764ba215 100%);
          padding: 1rem;
          border-radius: 12px;
          border: 1px solid #667eea30;
        }

        .course-selector label {
          font-weight: 600;
          color: #333;
          white-space: nowrap;
        }

        .course-select {
          flex: 1;
          max-width: 300px;
          padding: 0.5rem 1rem;
          border: 1px solid #ddd;
          border-radius: 8px;
          font-size: 0.95rem;
        }

        .metrics-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 1.2rem;
        }

        .metric-card {
          background: white;
          border: 1px solid #e0e0e0;
          border-radius: 12px;
          padding: 1.5rem;
          display: flex;
          gap: 1rem;
          transition: all 0.3s ease;
        }

        .metric-card:hover {
          border-color: #667eea;
          box-shadow: 0 4px 12px rgba(102, 126, 234, 0.15);
        }

        .metric-card.primary {
          background: linear-gradient(135deg, #667eea15 0%, #764ba215 100%);
          border-color: #667eea30;
        }

        .metric-card.comparison {
          background: linear-gradient(135deg, #10b98115 0%, #059669215 100%);
          border-color: #10b98130;
        }

        .metric-icon {
          font-size: 2.5rem;
          flex-shrink: 0;
        }

        .metric-content {
          flex: 1;
        }

        .metric-label {
          margin: 0;
          font-size: 0.85rem;
          color: #999;
          text-transform: uppercase;
          font-weight: 600;
        }

        .metric-value {
          margin: 0.5rem 0;
          font-size: 1.8rem;
          font-weight: 700;
          color: #1a1a1a;
        }

        .metric-subtext {
          margin: 0;
          font-size: 0.8rem;
          color: #666;
        }

        .progress-bar {
          width: 100%;
          height: 6px;
          background: #e0e0e0;
          border-radius: 3px;
          overflow: hidden;
          margin-top: 0.5rem;
        }

        .progress-fill {
          height: 100%;
          background: linear-gradient(90deg, #667eea, #764ba2);
          transition: width 0.5s ease;
        }

        .readiness-status {
          margin: 0;
          font-size: 0.85rem;
          font-weight: 600;
        }

        .readiness-status.status-excellent {
          color: #10b981;
        }

        .readiness-status.status-good {
          color: #f59e0b;
        }

        .readiness-status.status-fair {
          color: #ef4444;
        }

        .strength-weakness-section {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 1.5rem;
        }

        .strength-box, .weakness-box {
          background: white;
          border: 1px solid #e0e0e0;
          border-radius: 12px;
          padding: 1.5rem;
        }

        .strength-box h3, .weakness-box h3 {
          margin: 0 0 1rem 0;
          font-size: 1.1rem;
        }

        .topics-list {
          list-style: none;
          padding: 0;
          margin: 0;
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }

        .topic-item {
          display: flex;
          align-items: center;
          padding: 0.75rem;
          background: #f9f9f9;
          border-radius: 8px;
          border-left: 3px solid #10b981;
        }

        .topic-item.weak {
          background: #fef3f2;
          border-left-color: #ef4444;
        }

        .topic-info {
          display: flex;
          justify-content: space-between;
          align-items: center;
          width: 100%;
        }

        .topic-name {
          font-weight: 500;
          color: #333;
        }

        .topic-accuracy {
          font-weight: 700;
          color: #667eea;
          font-size: 0.9rem;
        }

        .topics-section {
          background: white;
          border: 1px solid #e0e0e0;
          border-radius: 12px;
          padding: 1.5rem;
        }

        .topics-section h2 {
          margin: 0 0 1.5rem 0;
          font-size: 1.2rem;
          color: #1a1a1a;
        }

        .topics-table {
          border: 1px solid #e0e0e0;
          border-radius: 8px;
          overflow: hidden;
        }

        .table-header {
          display: grid;
          grid-template-columns: 2fr 1.5fr 1.2fr 1.5fr;
          gap: 1rem;
          background: linear-gradient(135deg, #667eea15 0%, #764ba215 100%);
          padding: 1rem;
          font-weight: 600;
          font-size: 0.85rem;
          color: #666;
          border-bottom: 2px solid #e0e0e0;
        }

        .table-row {
          display: grid;
          grid-template-columns: 2fr 1.5fr 1.2fr 1.5fr;
          gap: 1rem;
          padding: 1rem;
          border-bottom: 1px solid #f0f0f0;
          align-items: center;
        }

        .table-row:last-child {
          border-bottom: none;
        }

        .col-topic {
          font-weight: 500;
          color: #333;
        }

        .col-accuracy {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }

        .col-level {
          text-align: center;
        }

        .col-action {
          text-align: right;
        }

        .mini-progress {
          flex: 1;
          height: 6px;
          background: #e0e0e0;
          border-radius: 3px;
          overflow: hidden;
          min-width: 50px;
        }

        .mini-progress-fill {
          height: 100%;
          transition: width 0.3s ease;
        }

        .level-badge {
          display: inline-block;
          padding: 0.4rem 0.8rem;
          border-radius: 20px;
          font-size: 0.75rem;
          font-weight: 600;
        }

        .level-badge.level-mastered {
          background: #d1fae5;
          color: #065f46;
        }

        .level-badge.level-proficient {
          background: #fef3c7;
          color: #92400e;
        }

        .level-badge.level-developing {
          background: #fee2e2;
          color: #991b1b;
        }

        .trend-section {
          background: white;
          border: 1px solid #e0e0e0;
          border-radius: 12px;
          padding: 1.5rem;
        }

        .trend-section h2 {
          margin: 0 0 1.5rem 0;
          font-size: 1.2rem;
          color: #1a1a1a;
        }

        .trend-chart {
          display: flex;
          gap: 2rem;
          align-items: flex-start;
        }

        .chart-svg {
          flex-shrink: 0;
        }

        .trend-stats {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 1rem;
          flex: 1;
        }

        .trend-stat {
          background: #f9f9f9;
          padding: 1rem;
          border-radius: 8px;
          border-left: 3px solid #ddd;
        }

        .trend-stat.positive {
          background: #d1fae5;
          border-left-color: #10b981;
        }

        .stat-label {
          display: block;
          font-size: 0.8rem;
          color: #999;
          margin-bottom: 0.5rem;
        }

        .stat-value {
          display: block;
          font-size: 1.5rem;
          font-weight: 700;
          color: #1a1a1a;
        }

        .analytics-footer {
          text-align: center;
          padding: 1.5rem;
          background: #fffbeb;
          border: 1px solid #fef3c7;
          border-radius: 8px;
          font-size: 0.9rem;
          color: #92400e;
        }

        /* Premium Metrics Section */
        .metrics-section {
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }

        .section-title {
          font-size: 1.5rem;
          font-weight: 700;
          color: #1a1a1a;
          margin: 0;
        }

        .section-header {
          margin-bottom: 0.5rem;
        }

        .section-header h2 {
          font-size: 1.4rem;
          font-weight: 700;
          color: #1a1a1a;
          margin: 0 0 0.5rem 0;
        }

        .section-description {
          font-size: 0.95rem;
          color: #666;
          margin: 0;
        }

        .metrics-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          gap: 1.2rem;
        }

        .metric-card.large-card {
          grid-column: 1 / -1;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          padding: 2rem;
        }

        .metric-card.large-card .metric-label,
        .metric-card.large-card .metric-subtitle {
          color: rgba(255, 255, 255, 0.9);
        }

        .metric-header {
          display: flex;
          gap: 1rem;
          align-items: flex-start;
          margin-bottom: 1.5rem;
        }

        .metric-icon-large {
          font-size: 2.5rem;
          flex-shrink: 0;
        }

        .metric-value-large {
          font-size: 3rem;
          font-weight: 800;
          margin: 0.5rem 0;
        }

        .progress-bar.large {
          height: 12px;
          border-radius: 6px;
          background: rgba(255, 255, 255, 0.3);
          overflow: hidden;
          margin: 1rem 0;
        }

        .progress-bar.large .progress-fill {
          background: linear-gradient(90deg, #fbbf24 0%, #10b981 100%);
          height: 100%;
          transition: width 0.8s cubic-bezier(0.34, 1.56, 0.64, 1);
        }

        .progress-labels {
          display: flex;
          justify-content: space-between;
          font-size: 0.85rem;
          color: rgba(255, 255, 255, 0.8);
          margin-bottom: 1rem;
        }

        .achievement-badge {
          background: rgba(255, 255, 255, 0.2);
          border: 1px solid rgba(255, 255, 255, 0.3);
          color: white;
          padding: 0.5rem 1rem;
          border-radius: 20px;
          font-size: 0.9rem;
          font-weight: 600;
          display: inline-block;
        }

        .circular-progress {
          position: relative;
          width: 120px;
          height: 120px;
          margin: 1rem 0;
        }

        .circular-progress svg {
          width: 100%;
          height: 100%;
          transform: rotate(-90deg);
        }

        .circular-progress circle {
          fill: none;
          stroke-linecap: round;
        }

        .circular-progress .bg {
          stroke: #e5e7eb;
          stroke-width: 8;
        }

        .circular-progress .progress {
          stroke: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          stroke-width: 8;
          transition: stroke-dasharray 0.8s cubic-bezier(0.34, 1.56, 0.64, 1);
        }

        .circle-text {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          text-align: center;
        }

        .circle-value {
          font-size: 1.8rem;
          font-weight: 700;
          color: #667eea;
          margin: 0;
        }

        .micro-progress {
          height: 4px;
          background: #e5e7eb;
          border-radius: 2px;
          margin-top: 0.75rem;
          overflow: hidden;
          background: linear-gradient(90deg, #e5e7eb 0%, #f3f4f6 100%);
        }

        .metric-card .micro-progress {
          background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
        }

        .comparison-display {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 1rem;
          margin: 1rem 0;
        }

        .you, .average {
          flex: 1;
          text-align: center;
        }

        .comp-label {
          display: block;
          font-size: 0.85rem;
          color: #999;
          margin-bottom: 0.25rem;
        }

        .comp-value {
          display: block;
          font-size: 1.8rem;
          font-weight: 700;
          color: #667eea;
        }

        .vs {
          font-size: 0.9rem;
          color: #ccc;
          font-weight: 600;
        }

        .comparison-text {
          margin: 0;
          font-size: 0.9rem;
          color: #666;
          font-weight: 500;
        }

        /* Premium Topics Table */
        .topics-table.premium {
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 12px;
          overflow: hidden;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
        }

        .table-row.strength-row {
          background: linear-gradient(90deg, #f0fdf4 0%, rgba(16, 185, 129, 0.05) 100%);
          border-left: 3px solid #10b981;
        }

        .table-row.weak-row {
          background: linear-gradient(90deg, #fef2f2 0%, rgba(239, 68, 68, 0.05) 100%);
          border-left: 3px solid #ef4444;
        }

        .topic-badge {
          margin-right: 0.5rem;
          font-size: 1.1rem;
        }

        .mini-progress-container {
          display: flex;
          align-items: center;
          gap: 0.75rem;
        }

        .accuracy-text {
          font-weight: 600;
          color: #667eea;
          min-width: 40px;
        }

        .col-action {
          text-align: right;
        }

        .action-btn {
          padding: 0.4rem 0.8rem;
          border: none;
          border-radius: 6px;
          font-size: 0.85rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s ease;
          white-space: nowrap;
        }

        .action-btn.practice {
          background: #fef3c7;
          color: #92400e;
        }

        .action-btn.practice:hover {
          background: #fcd34d;
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(252, 211, 77, 0.3);
        }

        .action-btn.advance {
          background: #d1fae5;
          color: #065f46;
        }

        .action-btn.advance:hover {
          background: #a7f3d0;
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(167, 243, 208, 0.3);
        }

        /* Premium Recommendations */
        .recommendations-section {
          background: linear-gradient(135deg, #f9fafb 0%, #f3f4f6 100%);
          border-radius: 12px;
          padding: 2rem;
          border: 1px solid #e5e7eb;
        }

        .recommendation-card {
          background: white;
          border-radius: 12px;
          padding: 1.5rem;
          border: 1px solid #e5e7eb;
          transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
          position: relative;
          overflow: hidden;
        }

        .recommendation-card.animated {
          animation: slideUp 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) both;
        }

        @keyframes slideUp {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .recommendation-card:hover {
          transform: translateY(-8px);
          box-shadow: 0 12px 24px rgba(102, 126, 234, 0.15);
          border-color: #667eea;
        }

        .card-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 1rem;
        }

        .priority-icon {
          font-size: 1.8rem;
        }

        .recommendation-card h4 {
          margin: 0 0 0.5rem 0;
          font-size: 1.1rem;
          color: #1a1a1a;
        }

        .accuracy-note {
          color: #667eea;
          font-weight: 600;
          font-size: 0.9rem;
          margin: 0 0 0.75rem 0;
        }

        .recommendation-card p {
          color: #666;
          font-size: 0.95rem;
          line-height: 1.5;
          margin: 0 0 1rem 0;
        }

        .action-items {
          display: flex;
          gap: 0.75rem;
          flex-wrap: wrap;
        }

        .btn-primary, .btn-secondary {
          padding: 0.5rem 1rem;
          border: none;
          border-radius: 6px;
          font-size: 0.85rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s ease;
          white-space: nowrap;
        }

        .btn-primary {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
        }

        .btn-primary:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
        }

        .btn-secondary {
          background: #f3f4f6;
          color: #333;
          border: 1px solid #e5e7eb;
        }

        .btn-secondary:hover {
          background: #e5e7eb;
          border-color: #d1d5db;
        }

        .recommendation-card.priority-high {
          border-top: 3px solid #ef4444;
        }

        .recommendation-card.priority-medium {
          border-top: 3px solid #f59e0b;
        }

        .recommendation-card.priority-low {
          border-top: 3px solid #10b981;
        }

        .recommendation-card.insight {
          border-top: 3px solid #667eea;
        }

        @media (max-width: 768px) {
          .analytics-header {
            flex-direction: column;
          }

          .header-info {
            flex-direction: column;
            gap: 0.5rem;
          }

          .strength-weakness-section {
            grid-template-columns: 1fr;
          }

          .recommendations-grid {
            grid-template-columns: 1fr;
          }

          .trend-chart {
            flex-direction: column;
          }

          .table-header,
          .table-row {
            grid-template-columns: 1fr 1fr;
            gap: 0.75rem;
          }
        }
      `}</style>
    </PremiumGate>
  );
};

export default AnalyticsDashboard;
