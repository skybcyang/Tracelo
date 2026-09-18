/// <reference types="node" />

import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("single visual baseline", () => {
  it("keeps only the selected cold precision and transparent chrome direction", () => {
    expect(readdirSync("docs/design").sort()).toEqual([
      "precision-chrome-refined.png",
      "precision-chrome.html",
    ]);
    const html = readFileSync("docs/design/precision-chrome.html", "utf8");
    expect(html).toContain("冷调精密");
    expect(html).toContain("记录当前进展");
    expect(html).toContain("四象限");
    expect(html).not.toContain("空间棱镜");
    expect(html).not.toContain("动态铬层");
    expect(html).not.toContain("星际任务指挥台");
    expect(html).not.toContain(".prism");
    expect(html).not.toContain(".kinetic");
  });

  it("keeps the task and timeline surfaces usable at narrow aspect ratios", () => {
    const html = readFileSync("docs/design/precision-chrome.html", "utf8");
    const css = readFileSync("styles.css", "utf8");

    expect(html).not.toMatch(/\.timeline-pane\s*\{[^}]*display:\s*none/s);
    expect(html).toContain("@media (max-width: 819px)");
    expect(html).toMatch(
      /@media \(max-width: 819px\)[\s\S]*?\.precision \.workspace\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/,
    );
    expect(html).toContain("@media (max-width: 520px)");
    expect(css).toContain("@container work-timeline (max-width: 900px)");
    expect(css).toMatch(
      /@container work-timeline \(max-width: 900px\)[\s\S]*?\.wt-layout\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/,
    );
  });

  it("adds as many readable card columns as the task pane can hold", () => {
    const html = readFileSync("docs/design/precision-chrome.html", "utf8");
    const css = readFileSync("styles.css", "utf8");

    expect(css).toContain("--wt-card-min: 260px");
    expect(css).toContain("--wt-timeline-width: clamp(360px, 28%, 480px)");
    expect(css).toMatch(
      /\.wt-layout\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) var\(--wt-timeline-width\)/s,
    );
    expect(css).toMatch(
      /\.wt-card-grid\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fill, minmax\(min\(100%, var\(--wt-card-min\)\), 1fr\)\)/s,
    );
    expect(html).toContain("--card-min: 260px");
    expect(html).toContain("--timeline-width: clamp(360px, 28%, 480px)");
    expect(html).toContain("repeat(auto-fill, minmax(min(100%, var(--card-min)), 1fr))");
  });

  it("keeps an expanded task at the same width and density as its grid peers", () => {
    const html = readFileSync("docs/design/precision-chrome.html", "utf8");
    const css = readFileSync("styles.css", "utf8");

    expect(css).not.toMatch(/\.wt-card\.is-selected\s*\{[^}]*grid-column/s);
    expect(css).toMatch(/\.wt-card-grid\s*\{[^}]*align-items:\s*start/s);
    expect(html).not.toMatch(/\.task-card\.selected\s*\{[^}]*grid-column/s);
    expect(html).toMatch(/\.task-grid\s*\{[^}]*align-items:\s*start/s);
    expect(html).not.toMatch(/\.task-card\.selected\s*\{[^}]*padding:/s);
    expect(html).not.toMatch(/\.precision \.selected \.task-name\s*\{/s);
    expect(html).not.toMatch(/\.precision \.selected \.composer\s*\{/s);
  });

  it("packs later cards into the open space beside an expanded task", () => {
    const main = readFileSync("src/main.ts", "utf8");
    const css = readFileSync("styles.css", "utf8");

    expect(css).toMatch(/\.wt-card-grid\s*\{[^}]*grid-auto-flow:\s*row dense/s);
    expect(css).toMatch(/\.wt-card-grid\s*\{[^}]*grid-auto-rows:\s*var\(--wt-card-height\)/s);
    expect(main).not.toContain("gridColumnStart");
    expect(main).not.toContain("gridRowStart");
    expect(main).not.toContain("layoutCardGrid");
  });

  it("keeps an expanded card exactly two card rows tall", () => {
    const css = readFileSync("styles.css", "utf8");

    expect(css).toContain("--wt-card-height: 96px");
    expect(css).toContain("--wt-card-gap: 9px");
    expect(css).toMatch(/\.wt-card-open\s*\{[^}]*min-height:\s*var\(--wt-card-height\)/s);
    expect(css).toMatch(
      /\.wt-card\.is-expanded\s*\{[^}]*grid-row:\s*span 2/s,
    );
    expect(css).toMatch(/\.wt-card-grid\s*\{[^}]*gap:\s*var\(--wt-card-gap\)/s);
  });
});
