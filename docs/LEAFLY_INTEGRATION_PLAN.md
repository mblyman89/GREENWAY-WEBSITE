# Leafly Integration Plan for Greenway Marijuana

## Current Milestone
The site currently uses mock menu data only. This allows the Greenway design, category structure, and product-card presentation to be tested before real Leafly credentials are added.

## Source Requirements Captured
- Leafly Menu API v2.0 uses OAuth2 Client Credentials.
- Sandbox base URL: `https://api-sandbox.leafly.io/v2/menu_integration`.
- Production base URL: `https://api.leafly.com/v2/menu_integration`.
- Each storefront uses a Leafly-provided `menu_integration_key`.
- Sandbox supports `GET /{menu_integration_key}/menu`; production does not.
- Menu updates use `POST /{menu_integration_key}/menu/items`, `PUT /{menu_integration_key}/menu/items`, and `DELETE /{menu_integration_key}/menu/items`.
- Variants require IDs, at least one variant must be present on POST/PUT items, and prices should be integer minor currency units.
- Missing strain/cannabinoid values should be `null`, not `NA` or `0`.
- Product descriptions should be plain text.
- Production requires separate credentials and Leafly partner/certification coordination.

## Next Small Leafly Step
After the homepage foundation is approved, add a dedicated `/menu` page that still uses mock data but matches the final filters/categories/sort behavior we want. Once that UI is right, wire in sandbox credentials and build a read-only sandbox menu fetch for validation.
