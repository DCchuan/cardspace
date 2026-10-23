export type SourceRef = {
  ref_id: string;
  kind: "message" | "revision" | "chunk";
  object_id: string;
  start_char: number;
  end_char: number;
  quote: string;
  quote_sha256: string;
};
export type ContextPack = {
  version: "context.v1";
  normalization: "nfc-lf-v1";
  card_id: string;
  revision_id: string;
  refs: SourceRef[];
  content_fingerprint: string;
  scope: Record<string, unknown>;
  warnings: string[];
};
export type KnowledgePlan = {
  supported: boolean;
  goal: string;
  relations: string[];
  claims: {
    text: string;
    origin: "source" | "derived" | "illustration" | "hypothesis";
    source_refs: string[];
  }[];
  missing: string[];
};
export type BudgetPolicy = {
  max_calls: number;
  max_repairs: number;
  max_total_tokens: number;
  accounting_mode: "estimated";
};
export type Grant = {
  id: string;
  quote_id: string;
  human_actor: "human";
  budget_policy: BudgetPolicy;
  issued_at: string;
  idempotency_key: string;
};
export type CompilerDiagnostic = { code: string; line: number; column: number };
export type RuntimeMessage = {
  protocol: "experience-bridge.v1";
  instance_id: string;
  nonce: string;
  type: "READY" | "OPEN_SOURCE" | "SAVE_STATE" | "RUNTIME_ERROR";
  payload: Record<string, unknown>;
};
