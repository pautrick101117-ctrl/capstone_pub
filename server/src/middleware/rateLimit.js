const buckets = new Map();
// Cleanup prevents unbounded growth after long-running deployments.
const sweep = () => { const t=Date.now(); for (const [k,v] of buckets) if (t-v.startedAt>86_400_000) buckets.delete(k); };
if (process.env.NODE_ENV !== 'test') { const task=setInterval(sweep,60_000); task.unref?.(); }

const now = () => Date.now();

export const rateLimit = ({ key = "global", windowMs = 60_000, max = 10 } = {}) => (req, res, next) => {
  const bucketKey = `${key}:${req.ip}`;
  const entry = buckets.get(bucketKey);
  const currentTime = now();

  if (!entry || currentTime - entry.startedAt > windowMs) {
    buckets.set(bucketKey, { startedAt: currentTime, count: 1 });
    return next();
  }

  if (entry.count >= max) {
    res.setHeader("Retry-After", String(Math.max(1, Math.ceil((windowMs-(currentTime-entry.startedAt))/1000))));
    return next(Object.assign(new Error("Too many requests. Please try again later."), { status: 429, code: "RATE_LIMITED" }));
  }

  entry.count += 1;
  next();
};


