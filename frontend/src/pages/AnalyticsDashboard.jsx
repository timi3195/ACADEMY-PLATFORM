import React, { useState, useEffect } from "react";
import axios from "axios";
import PremiumGate from "../components/PremiumGate";
import "./AnalyticsDashboard.css";

const AnalyticsDashboard = () => {
  const [courses, setCourses] = useState([]);
  const [selectedCourse, setSelectedCourse] = useState(null);
  const [performance, setPerformance] = useState(null);
  const [prediction, setPrediction] = useState(null);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);

  const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

  useEffect(() => {
    const fetchData = async () => {
      try {
        const token = localStorage.getItem("token");

        // Get user
        const userRes = await axios.get(`${API_BASE}/users/profile`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        setUser(userRes.data.user);

        // Get courses
        const coursesRes = await axios.get(`${API_BASE}/courses`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        setCourses(coursesRes.data.courses || []);

        if (coursesRes.data.courses?.length > 0) {
          setSelectedCourse(coursesRes.data.courses[0]);
        }
      } catch (error) {
        console.error("Error fetching courses:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  useEffect(() => {
    if (selectedCourse) {
      loadPerformance();
    }
  }, [selectedCourse]);

  const loadPerformance = async () => {
    try {
      const token = localStorage.getItem("token");

      const perfRes = await axios.get(
        `${API_BASE}/analytics/performance/${selectedCourse._id}`,
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );

      const predRes = await axios.get(
        `${API_BASE}/analytics/prediction/${selectedCourse._id}`,
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );

      setPerformance(perfRes.data.performance);
      setPrediction(predRes.data.prediction);
    } catch (error) {
      console.error("Error loading performance:", error);
    }
  };

  if (!user?.subscriptionType || user.subscriptionType === "free") {
    return <PremiumGate feature="Performance Analytics" />;
  }

  if (loading) {
    return <div className="analytics-loading">Loading...</div>;
  }

  const readinessScore = performance?.estimatedExamScore || 0;
  const accuracy = performance?.overallAccuracy || 0;
  const strengths = performance?.topStrengths || [];
  const weaknesses = performance?.areasToImprove || [];

  return (
    <div className="analytics-dashboard">
      <div className="analytics-header">
        <h1>📊 Performance Analytics</h1>
        <p>Track your progress and identify areas for improvement</p>
      </div>

      <div className="analytics-content">
        {/* Course Selector */}
        {courses.length > 0 && (
          <div className="course-selector-box">
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

        {performance && (
          <div className="analytics-grid">
            {/* Overall Score */}
            <div className="metric-card large">
              <div className="metric-label">Overall Accuracy</div>
              <div className="metric-value">
                <span className="main-value">{accuracy.toFixed(1)}%</span>
              </div>
              <div className="progress-bar">
                <div 
                  className="progress-fill" 
                  style={{ width: `${accuracy}%` }}
                ></div>
              </div>
            </div>

            {/* Exam Readiness */}
            <div className="metric-card large">
              <div className="metric-label">Exam Readiness</div>
              <div className="metric-value">
                <span className={`main-value readiness-${
                  readinessScore > 80 ? "excellent" :
                  readinessScore > 70 ? "good" :
                  readinessScore > 60 ? "fair" : "poor"
                }`}>
                  {readinessScore.toFixed(0)}%
                </span>
              </div>
              <div className="readiness-label">
                {readinessScore > 80 ? "🟢 Excellent" :
                 readinessScore > 70 ? "🟢 Good" :
                 readinessScore > 60 ? "🟡 Fair" : "🔴 Needs Work"}
              </div>
            </div>

            {/* Trend */}
            <div className="metric-card">
              <div className="metric-label">Trend</div>
              <div className="metric-value trend">
                {performance.improvementTrend === "improving" ? "📈 Improving" :
                 performance.improvementTrend === "declining" ? "📉 Declining" :
                 "➡️ Stable"}
              </div>
            </div>

            {/* Topics Mastered */}
            <div className="metric-card">
              <div className="metric-label">Topics Mastered</div>
              <div className="metric-value">
                {performance.topicMetrics?.filter(t => t.accuracy >= 80).length || 0}
              </div>
            </div>

            {/* Topics to Focus */}
            <div className="metric-card">
              <div className="metric-label">Topics to Focus</div>
              <div className="metric-value">
                {performance.topicMetrics?.filter(t => t.accuracy < 60).length || 0}
              </div>
            </div>
          </div>
        )}

        {/* Detailed Topics Table */}
        {performance?.topicMetrics && performance.topicMetrics.length > 0 && (
          <div className="topics-section">
            <h2>Topic Breakdown</h2>
            <div className="topics-table">
              <div className="table-header">
                <div className="col-topic">Topic</div>
                <div className="col-accuracy">Accuracy</div>
                <div className="col-attempts">Attempts</div>
                <div className="col-level">Mastery</div>
              </div>
              {performance.topicMetrics
                .sort((a, b) => b.accuracy - a.accuracy)
                .map((topic, idx) => (
                  <div key={idx} className="table-row">
                    <div className="col-topic">{topic.topic}</div>
                    <div className="col-accuracy">
                      <div className="mini-progress">
                        <div
                          className="mini-progress-fill"
                          style={{ width: `${topic.accuracy}%` }}
                        ></div>
                      </div>
                      <span>{topic.accuracy.toFixed(0)}%</span>
                    </div>
                    <div className="col-attempts">{topic.totalAttempts}</div>
                    <div className="col-level">
                      <span className={`level-badge level-${topic.masteryLevel}`}>
                        {topic.masteryLevel}
                      </span>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Strengths & Weaknesses */}
        <div className="strengths-weaknesses">
          <div className="strength-box">
            <h3>🟢 Strengths</h3>
            {strengths.length > 0 ? (
              <ul>
                {strengths.map((topic, idx) => (
                  <li key={idx}>{topic}</li>
                ))}
              </ul>
            ) : (
              <p className="empty">Keep practicing to build strengths</p>
            )}
          </div>

          <div className="weakness-box">
            <h3>🔴 Areas to Improve</h3>
            {weaknesses.length > 0 ? (
              <ul>
                {weaknesses.map((topic, idx) => (
                  <li key={idx}>{topic}</li>
                ))}
              </ul>
            ) : (
              <p className="empty">Great! No major weak areas</p>
            )}
          </div>
        </div>

        {/* Recommendations */}
        {prediction?.recommendations && (
          <div className="recommendations-box">
            <h3>💡 Recommendations</h3>
            <ul>
              {prediction.recommendations.map((rec, idx) => (
                <li key={idx}>{rec}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};

export default AnalyticsDashboard;
