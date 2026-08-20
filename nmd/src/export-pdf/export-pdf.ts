import { execFile } from "child_process";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { promisify } from "util";
import { notebookToHtml } from "./export-html.js";
import type { NmdNotebook } from "../types.js";

const execFileAsync = promisify(execFile);

export async function exportNotebookToPdf(notebook: NmdNotebook, pdfPath: string, title: string): Promise<void> {
  const html = notebookToHtml(notebook, title);
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nmd-export-"));
  const htmlPath = path.join(tempDir, "notebook.html");

  try {
    await fs.writeFile(htmlPath, html, "utf8");
    const browser = await findHeadlessBrowser();
    if (!browser) {
      const htmlFallback = pdfPath.replace(/\.pdf$/i, ".html");
      await fs.writeFile(htmlFallback, html, "utf8");
      throw new Error(
        `No Chrome or Edge found for PDF export. Saved ${htmlFallback} instead — open it in a browser and choose Print → Save as PDF.`,
      );
    }

    const htmlUrl = pathToFileUrl(htmlPath);
    await execFileAsync(
      browser,
      [
        "--headless=new",
        "--disable-gpu",
        "--no-first-run",
        "--run-all-compositor-stages-before-draw",
        "--virtual-time-budget=15000",
        `--print-to-pdf=${pdfPath}`,
        htmlUrl,
      ],
      { timeout: 120_000 },
    );

    try {
      await fs.access(pdfPath);
    } catch {
      throw new Error("The browser did not produce a PDF file. Try exporting again or use the HTML fallback.");
    }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

function pathToFileUrl(filePath: string): string {
  const resolved = path.resolve(filePath);
  const normalized = resolved.replace(/\\/g, "/");
  return `file:///${encodeURI(normalized).replace(/^\/+/, "")}`;
}

async function findHeadlessBrowser(): Promise<string | undefined> {
  const candidates = browserCandidates();
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // try next
    }
  }

  if (process.platform === "win32") {
    for (const name of ["chrome.exe", "msedge.exe"]) {
      try {
        const { stdout } = await execFileAsync("where", [name], { timeout: 5000 });
        const match = stdout.split(/\r?\n/).find((line) => line.trim().length > 0);
        if (match) {
          return match.trim();
        }
      } catch {
        // try next
      }
    }
  }

  return undefined;
}

function browserCandidates(): string[] {
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA ?? "";
    const programFiles = process.env.ProgramFiles ?? "C:\\Program Files";
    const programFilesX86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
    return [
      path.join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(local, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
      path.join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
      path.join(local, "Microsoft", "Edge", "Application", "msedge.exe"),
    ];
  }

  if (process.platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    ];
  }

  return [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/microsoft-edge",
  ];
}
