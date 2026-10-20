import { AdditionalInfoSection, ContentRating, SourceContext, tags } from "@mana-app/types";

// The native SDK has no UNKNOWN rating. This is a compatibility policy, not a
// claim that the source explicitly rated unclassified metadata as Suggestive.
export function nativeRating(value: ContentRating | undefined): ContentRating {
  return value !== undefined &&
    [
      ContentRating.SAFE,
      ContentRating.SUGGESTIVE,
      ContentRating.MATURE,
      ContentRating.EXPLICIT,
    ].includes(value)
    ? value
    : ContentRating.SUGGESTIVE;
}

function validRatingPolicy(context?: SourceContext): boolean {
  if (context !== undefined && (!context || typeof context !== "object" || Array.isArray(context)))
    return false;
  const allowed = context?.allowedContentRatings;
  return (
    allowed === undefined ||
    (Array.isArray(allowed) &&
      Array.from(allowed).every((rating) =>
        [
          ContentRating.SAFE,
          ContentRating.SUGGESTIVE,
          ContentRating.MATURE,
          ContentRating.EXPLICIT,
        ].includes(rating),
      ))
  );
}

export function assertRatingPolicy(context?: SourceContext): void {
  if (!validRatingPolicy(context)) throw new Error("Invalid Mana content-rating policy");
}

export function ratingAllowed(value: ContentRating | undefined, context?: SourceContext): boolean {
  return (
    validRatingPolicy(context) &&
    (context?.allowedContentRatings === undefined ||
      context.allowedContentRatings.includes(nativeRating(value)))
  );
}

export function incompleteRatingInfo(): AdditionalInfoSection {
  return tags.section({
    id: "content-rating-metadata",
    title: "Content rating metadata",
    items: [
      tags.item({
        id: "incomplete-content-rating",
        title: "No verified source age rating — Suggestive compatibility fallback",
        isNonInteractive: true,
      }),
    ],
  });
}
