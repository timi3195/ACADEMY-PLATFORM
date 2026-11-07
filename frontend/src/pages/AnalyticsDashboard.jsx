import React, { useEffect, useState } from "react";
import { apiGet } from "../utils/api";
import "./AnalyticsDashboard.css";

const formatPercent = (value) => Number.isFinite(value) ? `${Math.round(value)}%` : "Not enough data";

const formatDate = (value) => {
  if (!value) return "No completed examination";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date unavailable" : date.toLocaleDateString();
};

const TrendChart = ({ attempts }) => {
  const usable = attempts.filter((attempt) => Number.isFinite(attempt.accuracy));
  if (!usable.length) {
    return <p className="student-analytics-muted">Complete examinations with answered questions to see a trend.</p>;
  }

  const width = 720;
  const height = 220;
  const inset = 24;
  const points = usable.map((attempt, index) => {
    const x = usable.length === 1
      ? width / 2
      : inset + (index / (usable.length - 1)) * (width - inset * 2);
    const y = height - inset - (attempt.accuracy / 100) * (height - inset * 2);
    return { x, y, attempt };
  });
  const path = points.map((point, index) =>
    `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`
  ).join(" ");

  return (
    <div className="student-analytics-chart-scroll">
      <svg
        className="student-analytics-chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Chronological examination accuracy trend"
      >
        {[0, 50, 100].map((value) => {
          const y = height - inset - (value / 100) * (height - inset * 2);
          return (
            <g key={value}>
              <line x1={inset} x2={width - inset} y1={y} y2={y} className="student-analytics-gridline" />
              <text x="0" y={y + 4} className="student-analytics-axis-label">{value}%</text>
            </g>
          );
        })}
        <path d={path} className="student-analytics-line" />
        {points.map(({ x, y, attempt }) => (
          <circle key={attempt.attemptId} cx={x} cy={y} r="5" className="student-analytics-point">
            <title>{`${formatDate(attempt.completedAt)}: ${formatPercent(attempt.accuracy)}`}</title>
          </circle>
        ))}
      </svg>
      <div className="student-analytics-chart-dates">
        <span>{formatDate(usable[0].completedAt)}</span>
        {usable.length > 1 && <span>{formatDate(usable[usable.length - 1].completedAt)}</span>}
      </div>
    </div>
  );
};

export function StudentAnalyticsView({ analytics, loading, error, onRetry }) {
  if (loading) {
    return <div className="student-analytics-state" role="status">Loading your examination analytics…</div>;
  }
  if (error) {
    return (
      <div className="student-analytics-state student-analytics-error" role="alert">
        <p>{error}</p>
        <button type="button" onClick={onRetry}>Try again</button>
      </div>
    );
  }
  if (!analytics?.overview) {
    return (
      <div className="student-analytics-state student-analytics-error" role="alert">
        Performance analytics are unavailable because the response did not contain a valid overview.
      </div>
    );
  }

  const overview = analytics.overview;
  const courses = Array.isArray(analytics?.courses) ? analytics.courses : [];
  const topics = Array.isArray(analytics?.topics) ? analytics.topics : [];
  const recommendations = Array.isArray(analytics?.recommendations) ? analytics.recommendations : [];
  const attempts = Array.isArray(analytics?.performanceTrend) ? analytics.performanceTrend : [];
  const hasAttempts = overview.totalCompletedAttempts > 0;
  const strongest = topics.filter((topic) => topic.classification === "Strong");
  const needsWork = topics.filter((topic) => topic.classification === "Needs improvement");
  const insufficient = topics.filter((topic) => topic.classification === "Insufficient data");

  return (
    <div className="analytics-dashboard student-analytics">
      <header className="analytics-header">
        <h1>Your examination performance</h1>
        <p>These results come from your completed CBT attempts. Accuracy and examination score are reported separately.</p>
      </header>

      {!hasAttempts ? (
        <section className="student-analytics-state" aria-labelledby="analytics-empty-title">
          <h2 id="analytics-empty-title">No completed examinations yet</h2>
          <p>Once you complete a CBT examination, your verified results and study recommendations will appear here.</p>
        </section>
      ) : (
        <>
          <section className="student-analytics-summary" aria-label="Performance overview">
            <article className="student-analytics-card">
              <span>Completed examinations</span>
              <strong>{overview.totalCompletedAttempts}</strong>
            </article>
            <article className="student-analytics-card">
              <span>Overall accuracy</span>
              <strong>{formatPercent(overview.overallAccuracy)}</strong>
              <small>Correct answers / answered questions</small>
            </article>
            <article className="student-analytics-card">
              <span>Average examination score</span>
              <strong>{formatPercent(overview.averageScorePercentage)}</strong>
              <small>Average of persisted CBT scores</small>
            </article>
            <article className="student-analytics-card">
              <span>Questions answered</span>
              <strong>{overview.totalQuestionsAnswered ?? 0}</strong>
              <small>{overview.totalCorrectAnswers ?? 0} correct · {overview.totalIncorrectAnswers ?? 0} incorrect</small>
            </article>
          </section>
          <p className="student-analytics-muted">
            Most recent completed examination: {formatDate(overview.mostRecentCompletedAt)}
          </p>

          <section className="topics-section student-analytics-section">
            <h2>Performance over time</h2>
            <p className="student-analytics-muted">
              Trend: {analytics.trend?.direction === "insufficient_data"
                ? "Not enough completed attempts to determine a trend."
                : analytics.trend?.direction || "Not available"}
            </p>
            <TrendChart attempts={attempts} />
          </section>

          <section className="topics-section student-analytics-section">
            <h2>Course performance</h2>
            {courses.length ? (
              <div className="student-analytics-course-grid">
                {courses.map((course) => (
                  <article className="student-analytics-course" key={String(course.courseId)}>
                    <h3>{course.title}{course.code ? ` (${course.code})` : ""}</h3>
                    <dl>
                      <div><dt>Completed attempts</dt><dd>{course.completedAttempts}</dd></div>
                      <div><dt>Average score</dt><dd>{formatPercent(course.averageScorePercentage)}</dd></div>
                      <div><dt>Accuracy</dt><dd>{formatPercent(course.accuracy)}</dd></div>
                      <div><dt>Questions answered</dt><dd>{course.questionsAnswered}</dd></div>
                      <div><dt>Most recent examination</dt><dd>{formatDate(course.mostRecentCompletedAt)}</dd></div>
                    </dl>
                    {course.strongestTopics?.length > 0 && (
                      <p><strong>Strongest topics:</strong> {course.strongestTopics.map((topic) => topic.topic).join(", ")}</p>
                    )}
                    {course.weakestTopics?.length > 0 && (
                      <p><strong>Needs attention:</strong> {course.weakestTopics.map((topic) => topic.topic).join(", ")}</p>
                    )}
                  </article>
                ))}
              </div>
            ) : <p className="student-analytics-muted">Course information is not available for these attempts.</p>}
          </section>

          <section className="topics-section student-analytics-section">
            <h2>Topic strengths and areas to improve</h2>
            <p className="student-analytics-muted">Topic classifications require at least {analytics.topicThresholds?.minimumAnsweredQuestions ?? 3} answered questions.</p>
            <div className="student-analytics-topic-groups">
              <TopicGroup title="Strong topics" topics={strongest} />
              <TopicGroup title="Needs improvement" topics={needsWork} />
              <TopicGroup title="Not enough evidence yet" topics={insufficient} />
            </div>
            {analytics.overview?.unclassifiedAnsweredQuestions > 0 && (
              <p className="student-analytics-muted">
                {analytics.overview.unclassifiedAnsweredQuestions} answered question(s) have no reliable topic metadata and are excluded from topic recommendations.
              </p>
            )}
            {!topics.length && <p className="student-analytics-muted">No reliable topic information is available in your completed examinations.</p>}
          </section>

          <section className="topics-section student-analytics-section">
            <h2>Personalized study recommendations</h2>
            {recommendations.length ? (
              <div className="student-analytics-recommendations">
                {recommendations.map((recommendation, index) => (
                  <article className="student-analytics-recommendation" key={`${recommendation.courseId || "overall"}-${recommendation.topic || index}-${index}`}>
                    <div className="student-analytics-recommendation-heading">
                      <h3>{recommendation.topic || recommendation.course || "Overall performance"}</h3>
                      <span className={`student-analytics-priority priority-${recommendation.priority}`}>{recommendation.priority} priority</span>
                    </div>
                    <p className="student-analytics-muted">{recommendation.course || "Across your completed examinations"}</p>
                    <p>{recommendation.reason}</p>
                    <p><strong>Suggested next step:</strong> {recommendation.suggestedAction}</p>
                    {Number.isFinite(recommendation.evidence?.accuracy) && (
                      <small>
                        Evidence: {recommendation.evidence.correctAnswers}/{recommendation.evidence.questionsAnswered} correct
                        ({formatPercent(recommendation.evidence.accuracy)})
                      </small>
                    )}
                  </article>
                ))}
              </div>
            ) : <p className="student-analytics-muted">There is not enough topic-specific evidence to suggest a study activity yet.</p>}
            <p className="student-analytics-disclaimer">Recommendations reflect your recorded results and are suggestions, not guaranteed academic outcomes.</p>
          </section>
        </>
      )}
    </div>
  );
}

function TopicGroup({ title, topics }) {
  return (
    <section className="student-analytics-topic-group">
      <h3>{title}</h3>
      {topics.length ? (
        <ul>
          {topics.map((topic) => (
            <li key={`${topic.courseId}-${topic.topic}`}>
              <span>{topic.topic} <small>· {topic.courseTitle}</small></span>
              <strong>{formatPercent(topic.accuracy)}</strong>
              <small>{topic.correctAnswers}/{topic.questionsAnswered} correct</small>
            </li>
          ))}
        </ul>
      ) : <p className="student-analytics-muted">No topics in this group.</p>}
    </section>
  );
}

function AnalyticsDashboardContent() {
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    apiGet("/api/analytics/student")
      .then((response) => {
        if (active) {
          if (response?.analytics?.overview) setAnalytics(response.analytics);
          else setError("The analytics service returned incomplete performance data.");
        }
      })
      .catch((requestError) => {
        if (active) setError(requestError.message || "Unable to load examination analytics.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [retryCount]);

  return (
    <StudentAnalyticsView
      analytics={analytics}
      loading={loading}
      error={error}
      onRetry={() => setRetryCount((count) => count + 1)}
    />
  );
}

export default function AnalyticsDashboard() {
  return <AnalyticsDashboardContent />;
}
