// Bounded set of actions the agent may emit.
// The policy engine validates every action before it reaches the outside world.

export type ActionName =
  never; // no actions declared in this workflow

export interface Action {
  name: ActionName;
  args: Record<string, unknown>;
  requires_approval: boolean;
  boundary: "act_on" | "interpret_first";
}

export const ACTION_REGISTRY: Record<string, { purpose: string; requires_approval: boolean }> = {
};
