## D-22 · 2026-10-23 · Currency
Amounts are stored in USD and displayed in a chosen currency. On first launch the currency is picked from the IP address (ipapi.co), falling back to the OS locale. Rates come from frankfurter.dev (ECB data) and are cached for 12 hours, with built-in fallback rates when offline. The IP lookup happens once, only on first launch, and only until a currency has been detected.
Why: the user is in the UK and asked for GBP by default. The one-off IP request is the only network call that sends the user's address to a third party.
