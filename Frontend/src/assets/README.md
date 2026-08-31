# src/assets

Images and icons imported from component code.

| File | Purpose |
| --- | --- |
| [react.svg](react.svg) | React logo from the Vite starter template. |

Files here go through the bundler: importing one returns a hashed URL, and small assets
may be inlined as data URIs. That fingerprinting is what makes them safe to cache
aggressively.

For assets that must keep a fixed, predictable URL — `favicon.ico`, `robots.txt` — use
[../../public/](../../public) instead.
