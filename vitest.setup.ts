// Registers jest-dom's custom matchers (toBeInTheDocument, etc.) on Vitest's
// expect and auto-cleans the DOM between tests. Loaded via setupFiles.
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});
