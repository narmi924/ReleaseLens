function normalizedBasePath(value: string | undefined): string {
  const basePath = value?.trim() ?? "";
  if (!basePath || basePath === "/") return "";
  return basePath.replace(/\/+$/, "");
}

/** Builds a static public URL path that works for both root and project Pages. */
export function sitePath(
  path: string,
  basePath = process.env.NEXT_PUBLIC_BASE_PATH,
): string {
  if (!path.startsWith("/")) {
    throw new Error(`Site path must begin with '/': ${path}`);
  }
  return `${normalizedBasePath(basePath)}${path}`;
}
