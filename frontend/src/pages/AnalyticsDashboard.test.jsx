import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { StudentAnalyticsView } from "./AnalyticsDashboard";

const renderView = (props) => renderToStaticMarkup(<StudentAnalyticsView {...props} />);

describe("StudentAnalyticsView", () => {
  it("shows a loading state", () => {
    expect(renderView({ loading: true })).toContain("Loading your examination analytics");
  });

  it("shows an empty state without fabricated academic data", () => {
    const markup = renderView({ loading: false, analytics: { overview: { totalCompletedAttempts: 0 } } });
    expect(markup).toContain("No completed examinations yet");
    expect(markup).not.toContain("0%");
  });

  it("renders actual overview, course, topic, and trend values", () => {
    const markup = renderView({
      loading: false,
      analytics: {
        overview: {
          totalCompletedAttempts: 2,
          overallAccuracy: 75,
          averageScorePercentage: 68,
          totalQuestionsAnswered: 8,
          totalCorrectAnswers: 6,
          totalIncorrectAnswers: 2,
          mostRecentCompletedAt: "2025-02-01T12:00:00.000Z"
        },
        courses: [{
          courseId: "course-1",
          title: "Networking",
          code: "NET101",
          completedAttempts: 2,
          averageScorePercentage: 68,
          accuracy: 75,
          questionsAnswered: 8,
          mostRecentCompletedAt: "2025-02-01T12:00:00.000Z",
          strongestTopics: [{ topic: "Routing" }],
          weakestTopics: []
        }],
        topics: [
          {
            courseId: "course-1",
            topic: "Routing",
            courseTitle: "Networking",
            classification: "Strong",
            accuracy: 90,
            correctAnswers: 9,
            questionsAnswered: 10
          },
          {
            courseId: "course-1",
            topic: "Subnetting",
            courseTitle: "Networking",
            classification: "Needs improvement",
            accuracy: 40,
            correctAnswers: 2,
            questionsAnswered: 5
          }
        ],
        performanceTrend: [{
          attemptId: "attempt-1",
          completedAt: "2025-02-01T12:00:00.000Z",
          accuracy: 75
        }],
        trend: { direction: "insufficient_data" },
        recommendations: [{
          courseId: "course-1",
          course: "Networking",
          topic: "Subnetting",
          reason: "Your results show 40% accuracy across 5 answered question(s).",
          evidence: { correctAnswers: 2, questionsAnswered: 5, accuracy: 40 },
          suggestedAction: "Review subnetting and practise related questions.",
          priority: "high"
        }]
      }
    });
    expect(markup).toContain("Completed examinations");
    expect(markup).toContain("75%");
    expect(markup).toContain("Average examination score");
    expect(markup).toContain("Most recent completed examination");
    expect(markup).toContain("Networking (NET101)");
    expect(markup).toContain("Strong topics");
    expect(markup).toContain("Routing");
    expect(markup).toContain("Subnetting");
    expect(markup).toContain("40% accuracy across 5 answered question(s)");
    expect(markup).toContain("Review subnetting and practise related questions.");
    expect(markup).toContain("Chronological examination accuracy trend");
  });

  it("shows API failures and offers retry", () => {
    const markup = renderView({
      loading: false,
      error: "Analytics API unavailable",
      onRetry: vi.fn()
    });
    expect(markup).toContain("Analytics API unavailable");
    expect(markup).toContain("Try again");
  });
});
