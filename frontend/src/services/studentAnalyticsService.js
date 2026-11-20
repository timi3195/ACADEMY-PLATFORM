import { apiGet } from "../utils/api";

const inFlightRequests = new Map();
const ANALYTICS_ENDPOINT = "/api/analytics/student";

export function fetchStudentAnalytics(userId) {
  const key = String(userId || "");
  if (!key) return apiGet(ANALYTICS_ENDPOINT);

  const existingRequest = inFlightRequests.get(key);
  if (existingRequest) return existingRequest;

  const request = apiGet(ANALYTICS_ENDPOINT).finally(() => {
    if (inFlightRequests.get(key) === request) {
      inFlightRequests.delete(key);
    }
  });
  inFlightRequests.set(key, request);
  return request;
}
