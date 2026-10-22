import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
if (!existsSync(".venv/bin/python"))
  throw Error("请先运行 bash scripts/setup.sh");
const children = [
  spawn(
    ".venv/bin/python",
    [
      "-m",
      "uvicorn",
      "apps.api.app.main:app",
      "--host",
      "127.0.0.1",
      "--port",
      "8765",
    ],
    { stdio: "inherit" },
  ),
  spawn("npm", ["--prefix", "apps/web", "run", "dev"], { stdio: "inherit" }),
];
const stop = () => children.forEach((c) => c.kill("SIGTERM"));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
children.forEach((c) => c.on("exit", stop));
