export function routeParams() {
  const value = window.location.hash.replace(/^#\/?/, "");
  return new URLSearchParams(value);
}

export function updateRoute(
  updates: Record<string, string | null | undefined>,
  mode: "push" | "replace" = "replace",
) {
  const params = routeParams();
  for (const [key, value] of Object.entries(updates)) {
    if (value === null || value === undefined || value === "") params.delete(key);
    else params.set(key, value);
  }
  const hash = `#${params.toString()}`;
  if (mode === "push") window.history.pushState(null, "", hash);
  else window.history.replaceState(null, "", hash);
}
