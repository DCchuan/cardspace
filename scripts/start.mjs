import { spawn } from "node:child_process";
const p = spawn(
  ".venv/bin/python",
  [
    "-m",
    "uvicorn",
    "apps.api.app.main:app",
    "--host",
    "127.0.0.1",
    "--port",
    process.env.CARDSPACE_PORT || "8765",
  ],
  { stdio: "inherit" },
);
process.on("SIGINT", () => p.kill("SIGINT"));
process.on("SIGTERM", () => p.kill("SIGTERM"));
p.on("exit", (c) => process.exit(c || 0));
