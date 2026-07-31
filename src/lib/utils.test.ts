import { describe, it, expect } from "vitest";
import { cn } from "@/lib/utils";

// Example unit test — proves the runner, path aliases (@/*), and CI wiring work.
// `cn` merges clsx conditionals and de-duplicates conflicting Tailwind classes.
describe("cn", () => {
  it("joins class names", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("drops falsy conditional classes", () => {
    const flags: Record<string, boolean> = { active: false };
    expect(cn("a", flags.active && "b", null, undefined, "c")).toBe("a c");
  });

  it("lets a later Tailwind class win over an earlier conflicting one", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });
});
