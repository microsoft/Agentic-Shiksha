# src/types

**Currently empty.** Reserved for shared TypeScript type declarations.

Types currently sit next to the code that uses them — for example
[../features/create/builderTypes.ts](../features/create/builderTypes.ts) and
[../features/dashboard/lib/types.ts](../features/dashboard/lib/types.ts). That is the
better default: a type used by one feature belongs with it.

Use this folder only for declarations genuinely shared across features, or for ambient
`.d.ts` files. Ambient declarations must be covered by the `include` patterns in
[../../tsconfig.app.json](../../tsconfig.app.json) or the compiler will not see them.

Git does not track empty directories, so this folder does not survive a clone without this
file.
