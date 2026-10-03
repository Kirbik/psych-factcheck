import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { preprocessCSS, resolveConfig } from "vite";

// Compile the real CSS Modules: a plain `.preview` fixture hides scoping bugs.
async function compileReportStyles() {
  const config = await resolveConfig({ configFile: false }, "build");
  async function compile(relativePath: string) {
    const filename = path.resolve(relativePath);
    const result = await preprocessCSS(
      await readFile(filename, "utf8"),
      filename,
      config,
    );
    if (!result.modules) throw new Error("CSS Module class mapping missing");
    return { css: result.code, classes: result.modules };
  }
  const [shell, report] = await Promise.all([
    compile("src/components/preview/history-preview.module.css"),
    compile("src/components/preview/report-preview.module.css"),
  ]);
  return { shell, report };
}

const statuses = [
  {
    id: "contradicted",
    label: "Расходится с данными",
    color: "rgb(180, 85, 31)",
    indicator: "rgb(180, 85, 31)",
    background: "rgb(251, 229, 223)",
  },
  {
    id: "disputed",
    label: "Спорное утверждение",
    color: "rgb(150, 103, 15)",
    indicator: "rgb(150, 103, 15)",
    background: "rgb(250, 238, 222)",
  },
];

for (const width of [1280, 390]) {
  test(`report status colors survive CSS Module scoping at ${width}px`, async ({
    page,
  }, testInfo) => {
    const { shell, report } = await compileReportStyles();
    expect(shell.classes.preview).not.toBe("preview");
    await page.setViewportSize({ width, height: 720 });
    const chart = statuses
      .map(
        ({ id }) =>
          `<span data-segment="${id}" class="${report.classes.segment} ${report.classes[`segment-${id}`]}"></span>`,
      )
      .join("");
    const legend = statuses
      .map(
        ({ id, label }) =>
          `<span data-legend="${id}" class="${report.classes[`legend-${id}`]}"><i class="${report.classes.dot} ${report.classes[`segment-${id}`]}"></i>${label} <b>0</b></span>`,
      )
      .join("");
    const badges = statuses
      .map(
        ({ id, label }) =>
          `<span data-badge="${id}" class="${report.classes.status} ${report.classes[`status-${id}`]}">${label}</span>`,
      )
      .join("");
    await page.setContent(
      `<style>${shell.css}\n${report.css}</style>
      <main class="${shell.classes.preview}">
        <section class="${shell.classes.content} ${report.classes.content}">
          <div class="${report.classes.chart}">${chart}</div>
          <div class="${report.classes.legend}">${legend}</div>
          <article class="${report.classes.claimPanel}">${badges}</article>
        </section>
      </main>`,
    );
    await page.screenshot({
      path: testInfo.outputPath("report-status-colors.png"),
      fullPage: true,
    });
    for (const { id, color, indicator, background } of statuses) {
      const row = page.locator(`[data-legend="${id}"]`);
      await expect(row).toHaveCSS("color", color);
      await expect(row.locator("b")).toHaveCSS("color", color);
      await expect(row.locator("i")).toHaveCSS("background-color", indicator);
      await expect(page.locator(`[data-segment="${id}"]`)).toHaveCSS(
        "background-color",
        indicator,
      );
      const badge = page.locator(`[data-badge="${id}"]`);
      await expect(badge).toHaveCSS("color", color);
      await expect(badge).toHaveCSS("background-color", background);
    }
  });
}
