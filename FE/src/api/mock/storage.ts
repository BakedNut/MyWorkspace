/**
 * localStorage persistence for MOCK data only.
 * This exists so the design prototype survives a refresh. It is NOT a security
 * boundary and NOT how the real service stores data — the Spring Boot backend owns that.
 */
const PREFIX = "myworkspace.mock.v1.";

export function load<T>(key: string, seed: () => T): T {
  if (typeof window === "undefined") return seed();
  const raw = window.localStorage.getItem(PREFIX + key);
  if (raw) {
    try {
      return JSON.parse(raw) as T;
    } catch {
      /* fall through to seed */
    }
  }
  const value = seed();
  save(key, value);
  return value;
}

export function save<T>(key: string, value: T) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
}

export function remove(key: string) {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(PREFIX + key);
}

export const delay = (ms = 250) => new Promise((r) => setTimeout(r, ms));
