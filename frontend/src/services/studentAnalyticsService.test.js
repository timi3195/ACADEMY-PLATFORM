import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../utils/api", () => ({ apiGet: vi.fn() }));

import { apiGet } from "../utils/api";
import { fetchStudentAnalytics } from "./studentAnalyticsService";

describe("fetchStudentAnalytics", () => {
  beforeEach(() => vi.clearAllMocks());

  it("coalesces overlapping requests for the same user, but not different users", async () => {
    const resolveRequests = [];
    apiGet.mockImplementation(() => new Promise((resolve) => {
      resolveRequests.push(resolve);
    }));

    const first = fetchStudentAnalytics("student-a");
    const duplicate = fetchStudentAnalytics("student-a");
    const otherUser = fetchStudentAnalytics("student-b");

    expect(apiGet).toHaveBeenCalledTimes(2);
    expect(apiGet).toHaveBeenCalledWith("/api/analytics/student");

    const firstResponse = { success: true, analytics: { overview: {} } };
    const otherResponse = { success: true, analytics: { overview: { totalCompletedAttempts: 1 } } };
    resolveRequests[0](firstResponse);
    resolveRequests[1](otherResponse);

    await expect(first).resolves.toBe(firstResponse);
    await expect(duplicate).resolves.toBe(firstResponse);
    await expect(otherUser).resolves.toBe(otherResponse);
  });

  it("allows a new request after the previous request settles", async () => {
    apiGet.mockResolvedValue({ success: true });

    await fetchStudentAnalytics("student-a");
    await fetchStudentAnalytics("student-a");

    expect(apiGet).toHaveBeenCalledTimes(2);
  });
});
