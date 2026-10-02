export function toLinkView(link, baseUrl) {
  return {
    code: link.code,
    shortUrl: `${baseUrl}/${link.code}`,
    originalUrl: link.originalUrl,
    isActive: link.isActive,
    expiresAt: link.expiresAt?.toISOString() ?? null,
    clickCount: link.clickCount,
    createdAt: link.createdAt.toISOString(),
    updatedAt: link.updatedAt.toISOString(),
  };
}

/** Deleted links map to inactive targets, so redirects answer 410 Gone rather than 404. */
export function toLinkTarget(link) {
  return {
    linkId: link.id,
    url: link.originalUrl,
    expiresAt: link.expiresAt?.toISOString() ?? null,
    isActive: link.isActive && link.deletedAt === null,
  };
}
