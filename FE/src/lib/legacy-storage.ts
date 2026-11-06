/** Remove retired prototype data without touching unrelated browser settings. */
export function clearLegacyStorage() {
  try {
    const storage = window.localStorage;
    for (let i = storage.length - 1; i >= 0; i--) {
      const key = storage.key(i);
      if (key?.startsWith("myworkspace.mock.v1.") || key === "myworkspace.imported.v1") {
        storage.removeItem(key);
      }
    }
  } catch {
    // Browsers that block storage must still be able to open the site.
  }
}
