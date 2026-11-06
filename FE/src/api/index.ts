import type { ApiClient } from "./client";
import { mockApi } from "./mock/mockApi";

/**
 * Single switch point between mock data and the real Spring Boot backend.
 * Replace `mockApi` with a REST implementation of ApiClient when the server is ready.
 */
export const api: ApiClient = mockApi;
export { ApiError } from "./client";
