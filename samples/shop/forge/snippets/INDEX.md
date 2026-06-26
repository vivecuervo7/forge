# Snippet INDEX (auto-generated)
# Refresh: node <plugin-root>/scripts/forge-snippet-index.mjs

# 3 snippet(s) — grouped by flow:; ungrouped land in misc

flow: browse
  - search-for-product(query)  → Fill the search box and submit to filter the product listing [phase: search] [enters: product listing filtered by query]

misc
  - add-product-to-cart()       → Click the Add to Cart button on a product detail page [enters: product added to shopping cart (toast confirms)] [requires: product detail page]
  - open-first-search-result()  → Click the first product card in the search results to open its detail page [enters: product detail page] [requires: product listing with at least one result visible]

