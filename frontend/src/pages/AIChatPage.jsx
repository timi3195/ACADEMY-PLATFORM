import React, { useState, useEffect } from "react";
import ChatInterface from "../components/AI/ChatInterface/ChatInterface";
import { useAuth } from "../utils/auth";
import { apiGet } from "../utils/api";
import "./AIChatPage.css";

const AIChatPage = () => {
  const [courses, setCourses] = useState([]);
  const [selectedCourse, setSelectedCourse] = useState(null);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();

  useEffect(() => {
    const fetchData = async () => {
      try {
        const coursesRes = await apiGet('/api/courses');
        setCourses(coursesRes.courses || []);

        if (coursesRes.courses?.length > 0) {
          setSelectedCourse(coursesRes.courses[0]);
        }
      } catch (error) {
        console.error("Error fetching data:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

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
