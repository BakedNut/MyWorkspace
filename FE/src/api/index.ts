import type { ApiClient } from "./client";
import { mockApi } from "./mock/mockApi";
import { restApi } from "./restApi";

/** The server is the default; preview mode and unit tests use the mock. */
export const isPreview =
  import.meta.env.VITE_API_MODE === "mock" || import.meta.env.MODE === "test";
export const api: ApiClient = isPreview ? mockApi : restApi;
export { ApiError } from "./client";
