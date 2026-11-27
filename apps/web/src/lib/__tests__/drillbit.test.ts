import { describe, expect, it } from "vitest";

import { analyzeDrillbit, humanizeForDrillbit } from "@/lib/drillbit";

describe("Drillbit AI & similarity detection", () => {
  it("flags unedited AI-style academic prose with elevated AI score and segment highlights", () => {
    const aiText = [
      "In today's fast-paced digital landscape, artificial intelligence plays a crucial role in transforming modern healthcare workflows, thereby ensuring improved patient outcomes across diverse clinical environments.",
      "Furthermore, deep learning algorithms can be utilized to analyze complex medical imaging data, resulting in faster diagnostic accuracy and more personalized treatment plans.",
      "Moreover, automated clinical pipelines streamline administrative tasks, allowing physicians to focus on high-priority patient care while reducing operational overhead.",
    ].join(" ");

    const report = analyzeDrillbit(aiText, { title: "AI Medical Sample" });
    expect(report.aiScore).toBeGreaterThanOrEqual(40);
    expect(report.aiStatus).not.toBe("100% Human");
    expect(report.segments.some((s) => s.isAi)).toBe(true);
  });

  it("humanizeForDrillbit strips AI boilerplate & participial tails and meaningfully lowers AI score", () => {
    const aiText = [
      "In today's fast-paced digital landscape, artificial intelligence plays a crucial role in transforming modern healthcare workflows, thereby ensuring improved patient outcomes across diverse clinical environments.",
      "Furthermore, automated monitoring systems leverage cloud computing, enabling real-time alerts for clinicians.",
    ].join(" ");

    const before = analyzeDrillbit(aiText);
    const { humanizedText, wordsChanged } = humanizeForDrillbit(aiText);
    const after = analyzeDrillbit(humanizedText);

    expect(wordsChanged).toBeGreaterThan(0);
    expect(humanizedText).not.toMatch(/\blandscape\b/i);
    expect(humanizedText).not.toMatch(/\bthereby ensuring\b/i);
    expect(after.aiScore).toBeLessThan(before.aiScore);
  });
});
