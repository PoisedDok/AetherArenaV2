export interface Model {
  name: string;
  model: string;
  display_name: string | null;
  description?: string | null;
  supports_thinking?: boolean;
  supports_reasoning_effort?: boolean;
  supports_vision?: boolean;
  provider_use: string;
  endpoint_url?: string | null;
}
