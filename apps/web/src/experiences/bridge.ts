export type BridgeEnvelope = {
  protocol: string;
  instance_id: string;
  nonce: string;
  type: string;
  payload: Record<string, unknown>;
};
export function validBridge(
  value: unknown,
  instance: string,
  nonce: string,
  refs: string[],
): value is BridgeEnvelope {
  if (!value || typeof value !== "object") return false;
  let size = 0;
  try {
    size = JSON.stringify(value).length;
  } catch {
    return false;
  }
  if (size > 66000) return false;
  const v = value as BridgeEnvelope;
  if (
    Object.keys(v).some(
      (k) =>
        !["protocol", "instance_id", "nonce", "type", "payload"].includes(k),
    ) ||
    v.protocol !== "experience-bridge.v1" ||
    v.instance_id !== instance ||
    v.nonce !== nonce ||
    !["READY", "RESIZE", "OPEN_SOURCE", "SAVE_STATE", "RUNTIME_ERROR"].includes(
      v.type,
    ) ||
    !v.payload ||
    typeof v.payload !== "object"
  )
    return false;
  if (v.type === "OPEN_SOURCE")
    return (
      Object.keys(v.payload).length === 1 &&
      typeof v.payload.ref_id === "string" &&
      refs.includes(v.payload.ref_id)
    );
  if (v.type === "READY") return Object.keys(v.payload).length === 0;
  if (v.type === "RUNTIME_ERROR")
    return (
      Object.keys(v.payload).length === 1 &&
      typeof v.payload.code === "string" &&
      v.payload.code.length < 300
    );
  if (v.type === "SAVE_STATE")
    return (
      Object.keys(v.payload).length === 1 &&
      !!v.payload.snapshot &&
      typeof v.payload.snapshot === "object"
    );
  // Unsupported messages cannot grow the frame or write arbitrary state.
  return false;
}
