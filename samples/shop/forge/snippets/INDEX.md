# Snippet INDEX (auto-generated)
# Refresh: node <plugin-root>/scripts/forge-cli.mjs snippet-index

# 3 snippet(s) — grouped by flow:; ungrouped land in misc

flow: browse
  - search-for-product(query)  → Navigate to the product catalog and search by keyword to filter the listing [phase: search] [enters: product listing filtered by query] [requires: authenticated or guest session]

misc
  - add-product-to-cart()       → Click the Add to Cart button on a product detail page and wait for the success toast to confirm the cart API call has… [enters: product added to shopping cart (toast confirms)] [requires: product detail page]
  - open-first-search-result()  → Click the first product card in the search results to open its detail page [enters: product detail page] [requires: product listing with at least one result visible]

