// Runs the standalone Next.js server in several processes that share one port: one JS thread handles
// ~60 polling requests per second, a class of workstations needs more. APP_WORKERS sets the count
// (default: CPU cores, at most 4). The in-app scheduler (backups, retention, demo reset) runs in one worker only.
const cluster = require("node:cluster");
const os = require("node:os");

const cores = typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length;
const workers = Math.max(1, Number(process.env.APP_WORKERS || Math.min(4, cores)));

if (cluster.isPrimary && workers > 1) {
  const roles = new Map();
  const start = (scheduler) => {
    const worker = cluster.fork({ DISABLE_SCHEDULER: scheduler ? process.env.DISABLE_SCHEDULER || "" : "true" });
    roles.set(worker.id, scheduler);
  };
  for (let i = 0; i < workers; i++) start(i === 0);
  cluster.on("exit", (worker, code, signal) => {
    const scheduler = roles.get(worker.id) ?? false;
    roles.delete(worker.id);
    console.error(`worker ${worker.process.pid} stopped (${signal || code}), restarting`);
    start(scheduler);
  });
  console.log(`trainer: ${workers} workers`);
} else {
  require("./server.js");
}
