# Sync Inventory to Zoho Job

This job automatically syncs inventory level updates from Shopify to Zoho Inventory API whenever inventory levels change.

## How it works

1. **Trigger**: The job is triggered by the `inventory_levels/update` Shopify webhook
2. **Data Fetch**: Retrieves detailed inventory level information from Shopify GraphQL API
3. **Transform**: Converts Shopify inventory data to Zoho Inventory API format
4. **Sync**: Sends inventory adjustment data to Zoho Inventory API

## Setup

### Required Environment Variables

Add these environment variables to your `.shopworker.json` file:

```json
{
  "ZOHO_INVENTORY_API_URL": "https://inventory.zoho.com/api",
  "ZOHO_AUTH_TOKEN": "your_zoho_oauth_token",
  "ZOHO_ORG_ID": "your_zoho_organization_id"
}
```

### Getting Zoho Credentials

1. **API URL**: Usually `https://inventory.zoho.com/api` (or your region-specific URL)
2. **Auth Token**: Generate an OAuth token from Zoho Developer Console
3. **Organization ID**: Found in your Zoho Inventory settings

### Shopify Webhook Setup

The job uses the `inventory_levels/update` webhook topic. Make sure your Shopify app has:
- `read_inventory` permission
- Webhook subscription for `inventory_levels/update`

## Testing

Run the job locally using:

```bash
cd jobs/core/inventory/sync-to-zoho
shopworker test
```

Or from the project root:

```bash
shopworker test sync-to-zoho --dir jobs/core/inventory/sync-to-zoho
```

## Data Mapping

The job maps Shopify inventory data to Zoho format:

| Shopify Field | Zoho Field | Description |
|---------------|------------|-------------|
| `item.sku` | `item_id` | Product SKU identifier |
| `available` | `quantity_available` | Available stock quantity |
| `committed` | `quantity_committed` | Committed stock quantity |
| `location.id` | `location_id` | Inventory location |
| `item.variant.displayName` | `name` | Product name |
| `item.unitCost.amount` | `unit_cost` | Unit cost |

## Error Handling

The job will throw errors for:
- Missing Zoho API credentials
- Failed Shopify GraphQL queries
- Failed Zoho API requests
- Invalid inventory level data

## Logging

The job logs:
- Processing start with inventory item ID
- Success confirmation with SKU
- Error details for troubleshooting
- Zoho API response details

## Customization

To customize the data mapping or Zoho API endpoint, modify the `prepareZohoInventoryData()` and `syncToZohoInventory()` functions in `job.js`.
