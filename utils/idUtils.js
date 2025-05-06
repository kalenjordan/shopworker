/**
 * Converts an ID to a Shopify GraphQL global ID (gid) format if it's not already
 * @param {string} id - The ID to convert
 * @param {string} type - The resource type (e.g., 'Product', 'Variant', 'Order', 'Customer')
 * @returns {string} - The ID in gid format
 */
export const toGid = (id, type) => {
  if (!id) return null;

  // If already a gid, return as is
  if (typeof id === 'string' && id.startsWith('gid://')) {
    return id;
  }

  // Convert to gid format
  return `gid://shopify/${type}/${id}`;
};

/**
 * Extracts the numeric ID from a Shopify GraphQL global ID (gid)
 * @param {string} gid - The global ID
 * @returns {string|null} - The extracted ID or null if invalid
 */
export const fromGid = (gid) => {
  if (!gid || typeof gid !== 'string' || !gid.startsWith('gid://')) {
    return gid; // Return as is if not a gid
  }

  const parts = gid.split('/');
  return parts.length >= 4 ? parts[3] : null;
};

/**
 * Gets the resource type from a Shopify GraphQL global ID (gid)
 * @param {string} gid - The global ID
 * @returns {string|null} - The resource type or null if invalid
 */
export const getTypeFromGid = (gid) => {
  if (!gid || typeof gid !== 'string' || !gid.startsWith('gid://')) {
    return null;
  }

  const parts = gid.split('/');
  return parts.length >= 3 ? parts[2] : null;
};
