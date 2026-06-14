## Search behavior

Submitting the search form does not change the page URL — the Angular router renders
results in-place at the catalog root (`https://practicesoftwaretesting.com/`).
Both `search-for-product` and `open-first-search-result` carry
`url: /practicesoftwaretesting\.com\/?$/` as their precondition.

After submitting, wait for `a[data-test^="product-"]` to appear in the DOM rather
than using a time-based wait or a URL change.
