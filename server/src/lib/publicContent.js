// Keep operational settings out of unauthenticated content responses.
export const PUBLIC_CONTENT_KEYS = Object.freeze(["hero", "contact", "hotline", "hotlines"]);
export const publicContentOnly = (content = {}) => Object.fromEntries(
  PUBLIC_CONTENT_KEYS.filter((key) => Object.hasOwn(content, key)).map((key) => [key, content[key]])
);
