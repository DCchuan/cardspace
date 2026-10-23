// Keep the latest local input visible until its Worker response is acknowledged.
export function acknowledge(pending, id) {
  return Object.fromEntries(
    Object.entries(pending).filter(([, entry]) => entry.id > id),
  );
}
export function controlValues(values, pending) {
  return {
    ...values,
    ...Object.fromEntries(
      Object.entries(pending).map(([key, entry]) => [key, entry.value]),
    ),
  };
}
