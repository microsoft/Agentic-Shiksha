# public

Static assets served verbatim by Vite at the site root.

| File | Purpose |
| --- | --- |
| [vite.svg](vite.svg) | Default favicon, referenced from [../index.html](../index.html). |

Files here are **not** processed, hashed or bundled — they keep their names and are copied
as-is, so `public/vite.svg` is served at `/vite.svg`. That makes this the right place for
`favicon.ico`, `robots.txt` and anything referenced by a fixed URL, and the wrong place
for anything that should be fingerprinted for cache-busting.

Assets imported from component code belong in [../src/assets/](../src/assets) instead.
