type QueryScalar = string | number | boolean | null | undefined;
/**
 * An array is written as the key repeated once per entry — `genre=a&genre=b` — which is
 * how the sites here take a multi-valued facet. An empty array writes nothing, so an
 * unset filter is the same as one that was never passed.
 */
type QueryValue = QueryScalar | readonly QueryScalar[];
export type QueryParams = Record<string, QueryValue>;

function encodePairs(params: QueryParams, keepEmpty: boolean): string {
  const pairs: string[] = [];

  for (const [key, value] of Object.entries(params)) {
    for (const entry of Array.isArray(value) ? (value as readonly QueryScalar[]) : [value]) {
      if (entry === undefined || entry === null) continue;
      if (!keepEmpty && entry === "") continue;
      pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(entry))}`);
    }
  }

  return pairs.join("&");
}

export function withQuery(url: string, params?: QueryParams): string {
  const query = encodePairs(params ?? {}, false);
  if (!query) return url;
  return `${url}${url.includes("?") ? "&" : "?"}${query}`;
}
