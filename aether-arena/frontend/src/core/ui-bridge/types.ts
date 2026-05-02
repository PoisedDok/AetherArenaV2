export interface AetherBridgeEnvelope {
  __aether: true;
  type: string;
  payload: unknown;
}

export type BridgeMessage =
  | { type: "resize";         payload: { height: number } }
  | { type: "ready";          payload: Record<string, never> }
  | { type: "action";         payload: { panelId: string; name: string; args: Record<string, unknown> } }
  | { type: "action_status";  payload: { panelId: string; name: string; status: "running" | "done" | "failed"; detail?: string } }
  | { type: "action_result";  payload: { panelId: string; name: string; result: unknown } };
