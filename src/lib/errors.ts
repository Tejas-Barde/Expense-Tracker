/** Turns any thrown value into a short, human-readable sentence that is safe to show to the user. */
export function errorMessage(error: unknown, fallback = "Something went wrong. Please try again."): string {
  const e = error as { code?: number; type?: string; message?: string } | null | undefined;
  const raw = typeof e?.message === "string" ? e.message : "";
  if (/failed to fetch|networkerror|network request failed|load failed/i.test(raw)) {
    return "We couldn't reach the server. Check your internet connection and try again.";
  }
  switch (e?.code) {
    case 401: return "Your session has expired. Please sign in again.";
    case 403: return "You don't have permission to do that.";
    case 404: return "That record no longer exists. Refresh the page and try again.";
    case 409: return "That item already exists.";
    case 429: return "Too many requests. Please wait a moment and try again.";
  }
  if (typeof e?.code === "number" && e.code >= 500) return "The server ran into a problem. Please try again shortly.";
  if (e?.type === "user_invalid_credentials") return "The email or password is incorrect.";
  if (e?.type === "user_already_exists") return "An account with this email already exists. Try signing in instead.";
  if (e?.type === "general_rate_limit_exceeded") return "Too many attempts. Please wait a minute and try again.";
  return raw && raw.length < 160 ? raw : fallback;
}
