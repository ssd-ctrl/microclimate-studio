import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const root = process.cwd();
const port = 4173;
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json"
};

function startServer() {
  const server = http.createServer((req, res) => {
    const reqPath = decodeURIComponent((req.url || "/").split("?")[0]);
    const filePath = path.join(root, reqPath === "/" ? "index.html" : reqPath.replace(/^\//, ""));

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.statusCode = 404;
        res.end("Not Found");
        return;
      }
      res.setHeader("Content-Type", mime[path.extname(filePath)] || "application/octet-stream");
      res.end(data);
    });
  });

  return new Promise((resolve) => {
    server.listen(port, () => resolve(server));
  });
}

async function run() {
  const server = await startServer();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto(`http://localhost:${port}`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForSelector("#site-form", { timeout: 15000 });
    await page.click("button[type='submit']");
    await page.waitForSelector("text=Program Areas", { timeout: 30000 });

    await page.click("#capture-boundary");
    await page.mouse.click(900, 280);
    await page.mouse.click(980, 320);
    await page.mouse.click(940, 420);
    const geojson = await page.inputValue("#boundary-geojson");
    if (!geojson || !geojson.includes("Polygon")) {
      throw new Error("Boundary capture did not populate GeoJSON");
    }

    await page.click("#export-json");

    console.log("VERIFY_OK: form submit, generation, boundary capture, and export trigger passed");
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

run().catch((error) => {
  console.error("VERIFY_FAIL:", error.message);
  process.exit(1);
});
