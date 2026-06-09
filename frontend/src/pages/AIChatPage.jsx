import React, { useState, useEffect } from "react";
import axios from "axios";
import ChatInterface from "../components/AI/ChatInterface/ChatInterface";
import PremiumGate from "../components/PremiumGate";
import "./AIChatPage.css";

const AIChatPage = () => {
  const [courses, setCourses] = useState([]);
  const [selectedCourse, setSelectedCourse] = useState(null);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);

  const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

  useEffect(() => {
    const fetchData = async () => {
      try {
        const token = localStorage.getItem("token");
        
        // Get user data
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
        console.error("Error fetching data:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  if (!user?.subscriptionType || user.subscriptionType === "free") {
    return <PremiumGate feature="AI Study Assistant" />;
  }

  if (loading) {
    return (
      <div className="ai-chat-page loading">
        <div className="spinner">Loading...</div>
      </div>
    );
  }

  return (
    <div className="ai-chat-page">
      <div className="page-header">
        <h1>🤖 AI Study Assistant</h1>
        <p>Chat with AI about course topics and get personalized explanations</p>
      </div>

      <div className="page-content">
        {courses.length > 0 && (
          <div className="course-selector">
            <label htmlFor="course-select">Select Course:</label>
            <select
              id="course-select"
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

        {selectedCourse ? (
          <ChatInterface 
            courseId={selectedCourse._id} 
            courseName={selectedCourse.title}
          />
        ) : (
          <div className="empty-state">
            <p>No courses available. Please enroll in a course first.</p>
          </div>
        )}
      </div>

      <div className="page-footer">
        <div className="footer-info">
          <p>💡 <strong>Tip:</strong> The AI learns from your performance and adapts explanations based on your level.</p>
        </div>
      </div>
    </div>
  );
};

export default AIChatPage;
