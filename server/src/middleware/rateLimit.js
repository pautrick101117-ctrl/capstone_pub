const buckets = new Map();

const now = () => Date.now();

export const rateLimit = ({ key = "global", windowMs = 60_000, max = 10 } = {}) => (req, _res, next) => {
  const bucketKey = `${key}:${req.ip}`;
  const entry = buckets.get(bucketKey);
  const currentTime = now();

  if (!entry || currentTime - entry.startedAt > windowMs) {
    buckets.set(bucketKey, { startedAt: currentTime, count: 1 });
    return next();
  }

  if (entry.count >= max) {
    return next(Object.assign(new Error("Too many requests. Please try again later."), { status: 429 }));
  }

  entry.count += 1;
  next();
};
