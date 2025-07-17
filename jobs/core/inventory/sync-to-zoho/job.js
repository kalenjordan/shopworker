import GetInventoryLevelById from "../../../../graphql/GetInventoryLevelById.js";

/**
 * Process an inventory level update and sync to Zoho Inventory API
 * @param {Object} params - Parameters for the job
 * @param {Object} params.payload - The inventory level object from Shopify webhook
 * @param {Object} params.shopify - Shopify API client
 * @param {Object} params.env - Environment variables containing Zoho API credentials
 */
export async function process({ payload: inventoryLevel, shopify, env }) {
  console.log(`Processing inventory level update for ID: ${inventoryLevel.inventory_item_id}`);

  // Convert the inventory item ID to a GraphQL GID for querying
  const inventoryLevelGid = shopify.toGid(inventoryLevel.inventory_level_id, "InventoryLevel");

  try {
    // Fetch detailed inventory level information from Shopify
    const response = await shopify.graphql(GetInventoryLevelById, {
      id: inventoryLevelGid
    });

    const detailedInventoryLevel = response.inventoryLevel;

    if (!detailedInventoryLevel) {
      console.log(`Inventory level not found for ID: ${inventoryLevelGid}`);
      return;
    }

        // Prepare data for Zoho Inventory API
    const zohoInventoryData = prepareZohoInventoryData(detailedInventoryLevel, inventoryLevel, shopify);

    // Send to Zoho Inventory API
    await syncToZohoInventory(zohoInventoryData, env);

    console.log(`Successfully synced inventory level to Zoho for SKU: ${detailedInventoryLevel?.item?.sku || 'N/A'}`);

  } catch (error) {
    console.error(`Failed to sync inventory level to Zoho:`, error);
    throw error;
  }
}

/**
 * Prepare inventory data for Zoho Inventory API format
 * @param {Object} inventoryLevel - Detailed inventory level from Shopify GraphQL
 * @param {Object} webhookPayload - Original webhook payload
 * @param {Object} shopify - Shopify API client
 * @returns {Object} Formatted data for Zoho API
 */
function prepareZohoInventoryData(inventoryLevel, webhookPayload, shopify) {
  const item = inventoryLevel.item;
  const location = inventoryLevel.location;

  return {
    item_id: item?.sku || `shopify_${shopify.fromGid(item?.id)}`,
    sku: item?.sku,
    name: item?.variant?.displayName || item?.variant?.product?.title,
    product_name: item?.variant?.product?.title,
    location_id: shopify.fromGid(location?.id),
    location_name: location?.name,
    available_stock: inventoryLevel.available || 0,
    committed_stock: inventoryLevel.committed || 0,
    incoming_stock: inventoryLevel.incoming || 0,
    on_hand_stock: inventoryLevel.onHand || 0,
    reserved_stock: inventoryLevel.reserved || 0,
    damaged_stock: inventoryLevel.damaged || 0,
    safety_stock: inventoryLevel.safetyStock || 0,
    unit_cost: item?.unitCost?.amount || 0,
    unit_price: item?.variant?.price || 0,
    updated_at: inventoryLevel.updatedAt,
    webhook_timestamp: new Date().toISOString(),
    location_address: {
      address1: location?.address?.address1,
      city: location?.address?.city,
      province: location?.address?.province,
      country: location?.address?.country,
      zip: location?.address?.zip
    }
  };
}

/**
 * Send inventory data to Zoho Inventory API
 * @param {Object} inventoryData - Formatted inventory data
 * @param {Object} env - Environment variables
 */
async function syncToZohoInventory(inventoryData, env) {
  const zohoApiUrl = env.ZOHO_INVENTORY_API_URL;
  const zohoAuthToken = env.ZOHO_AUTH_TOKEN;
  const zohoOrgId = env.ZOHO_ORG_ID;

  if (!zohoApiUrl || !zohoAuthToken || !zohoOrgId) {
    throw new Error('Missing required Zoho Inventory API credentials. Please set ZOHO_INVENTORY_API_URL, ZOHO_AUTH_TOKEN, and ZOHO_ORG_ID environment variables.');
  }

  const requestBody = {
    inventory_adjustments: [{
      item_id: inventoryData.item_id,
      sku: inventoryData.sku,
      quantity_available: inventoryData.available_stock,
      quantity_committed: inventoryData.committed_stock,
      location_id: inventoryData.location_id,
      reason: "Shopify inventory sync",
      reference_number: `shopify-sync-${Date.now()}`,
      notes: `Auto-sync from Shopify at ${inventoryData.webhook_timestamp}`,
      custom_fields: {
        shopify_location_name: inventoryData.location_name,
        shopify_product_name: inventoryData.product_name,
        on_hand_stock: inventoryData.on_hand_stock,
        reserved_stock: inventoryData.reserved_stock,
        incoming_stock: inventoryData.incoming_stock,
        damaged_stock: inventoryData.damaged_stock,
        safety_stock: inventoryData.safety_stock
      }
    }]
  };

  const response = await fetch(`${zohoApiUrl}/inventory/v1/inventoryadjustments`, {
    method: 'POST',
    headers: {
      'Authorization': `Zoho-oauthtoken ${zohoAuthToken}`,
      'X-com-zoho-inventory-organizationid': zohoOrgId,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    let errorMessage = `Zoho API request failed with status ${response.status}`;
    try {
      const errorBody = await response.text();
      errorMessage += `: ${errorBody}`;
    } catch (parseError) {
      errorMessage += ` (unable to parse error response)`;
    }
    throw new Error(errorMessage);
  }

  const result = await response.json();

  if (result.code !== 0) {
    throw new Error(`Zoho API error: ${result.message || 'Unknown error'}`);
  }

  console.log(`Zoho Inventory API response:`, result);
  return result;
}
