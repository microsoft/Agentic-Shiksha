const values = new Map<string, { expires: number; value: unknown }>();
const pending = new Map<string, Promise<unknown>>();
let generation = 0;

export function clearDashboardRequests(): void {
  generation += 1;
  values.clear();
  pending.clear();
}

export async function cachedDashboardRequest<Result>(
  scope: string, path: string, load: () => Promise<Result>,
): Promise<Result> {
  if (!scope) return load();
  const key = `${scope}\n${path}`;
  const cached = values.get(key);
  if (cached && cached.expires > Date.now()) return structuredClone(cached.value) as Result;
  values.delete(key);
  let request = pending.get(key) as Promise<Result> | undefined;
  if (!request) {
    const requestGeneration = generation;
    request = load().then(value => {
      if (generation === requestGeneration) {
        values.set(key, { expires: Date.now() + 2000, value: structuredClone(value) });
        while (values.size > 64) values.delete(values.keys().next().value!);
      }
      return value;
    });
    pending.set(key, request);
  }
  try {
    return structuredClone(await request);
  } finally {
    if (pending.get(key) === request) pending.delete(key);
  }
}