import {
  SectionStyle,
  type PageSection,
  type PagedSearchResult,
  type SearchRequest,
} from "@mana-app/types";

export type PageSectionSpec = {
  id: string;
  title: string;
  subtitle?: string;
  style?: SectionStyle;
  viewMore?: boolean;
};

export type SectionSpec = PageSectionSpec & {
  load(page: number): Promise<PagedSearchResult>;
};

export function pageOf(request: { page?: number }): number {
  const page = request.page ?? 1;
  return Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
}

export function toPageSections(specs: readonly PageSectionSpec[]): PageSection[] {
  return specs.map((spec) => ({
    id: spec.id,
    title: spec.title,
    ...(spec.subtitle === undefined ? {} : { subtitle: spec.subtitle }),
    ...(spec.style === undefined ? {} : { style: spec.style }),
    ...(spec.viewMore === false ? {} : { viewMoreLink: { request: { page: 1, listId: spec.id } } }),
  }));
}

export function sectionById<T extends PageSectionSpec>(
  specs: readonly T[],
  id: string | undefined,
): T | undefined {
  if (!id) return undefined;
  return specs.find((spec) => spec.id === id);
}

/** The styles that draw a tile's info rows, and so draw no pill over its cover. */
const DETAILED_STYLES = new Set<SectionStyle>([
  SectionStyle.DetailedSingleRowPaged,
  SectionStyle.DetailedDoubleRowPaged,
  SectionStyle.DetailedTripleRowPaged,
  SectionStyle.DetailedVerticalList,
  SectionStyle.DetailedVerticalListGrouped,
]);

/**
 * Whether a section's tiles carry rows rather than a pill.
 *
 * The two answer to different rules and never appear together: a pill is the best single
 * thing a site says, squeezed over the artwork, and the rows are the reader's whole read of
 * a title. A tile drawing both says the same number twice a thumb's width apart.
 */
export function isDetailedStyle(style: SectionStyle | undefined): boolean {
  return style !== undefined && DETAILED_STYLES.has(style);
}

export function listResults(
  specs: readonly SectionSpec[],
  request: SearchRequest,
): Promise<PagedSearchResult> | undefined {
  const spec = sectionById(specs, request.listId);
  return spec ? spec.load(pageOf(request)) : undefined;
}
