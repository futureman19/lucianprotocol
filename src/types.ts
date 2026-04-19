import { z } from 'zod';

export const GRID_LIMIT = 49;

export const PositionSchema = z.object({
  x: z.number().int().min(0).max(GRID_LIMIT),
  y: z.number().int().min(0).max(GRID_LIMIT),
});

export type Position = z.infer<typeof PositionSchema>;

export const EntityTypeSchema = z.enum(['agent', 'wall', 'goal', 'file', 'directory']);
export type EntityType = z.infer<typeof EntityTypeSchema>;

export const DirectionSchema = z.enum(['north', 'east', 'south', 'west']);
export type Direction = z.infer<typeof DirectionSchema>;

export const AgentRoleSchema = z.enum(['visionary', 'architect', 'critic']);
export type AgentRole = z.infer<typeof AgentRoleSchema>;

export const NodeStateSchema = z.enum(['task', 'in-progress', 'asymmetry', 'stable', 'verified']);
export type NodeState = z.infer<typeof NodeStateSchema>;

export const GitStatusSchema = z.enum([
  'clean',
  'modified',
  'added',
  'deleted',
  'renamed',
  'untracked',
  'copied',
  'ignored',
  'conflicted',
]);
export type GitStatus = z.infer<typeof GitStatusSchema>;

export const TileOccupantSchema = z.enum([
  'empty',
  'boundary',
  'agent',
  'wall',
  'goal',
  'file',
  'directory',
]);
export type TileOccupant = z.infer<typeof TileOccupantSchema>;

export const EntitySchema = z.object({
  id: z.string().min(1),
  type: EntityTypeSchema,
  x: z.number().int().min(0).max(GRID_LIMIT),
  y: z.number().int().min(0).max(GRID_LIMIT),
  mass: z.number().int().positive(),
  tick_updated: z.number().int().nonnegative(),
  agent_role: AgentRoleSchema.nullable().optional(),
  node_state: NodeStateSchema.nullable().optional(),
  lock_owner: z.string().min(1).nullable().optional(),
  lock_tick: z.number().int().nonnegative().nullable().optional(),
  state_tick: z.number().int().nonnegative().nullable().optional(),
  objective_path: z.string().min(1).nullable().optional(),
  name: z.string().min(1).nullable().optional(),
  path: z.string().min(0).nullable().optional(),
  extension: z.string().min(1).nullable().optional(),
  descriptor: z.string().min(1).nullable().optional(),
  content: z.string().nullable().optional(),
  content_preview: z.string().nullable().optional(),
  content_hash: z.string().min(1).nullable().optional(),
  git_status: GitStatusSchema.nullable().optional(),
  repo_root: z.string().min(1).nullable().optional(),
  is_binary: z.boolean().nullable().optional(),
});

export type Entity = z.infer<typeof EntitySchema>;

export const WorldStatusSchema = z.enum(['booting', 'running', 'goal-reached', 'stalled']);
export type WorldStatus = z.infer<typeof WorldStatusSchema>;

export const WorldStateSchema = z.object({
  id: z.string().min(1),
  seed: z.string().min(1),
  tick: z.number().int().nonnegative(),
  phase: z.number().int().min(0).max(59),
  status: WorldStatusSchema,
});

export type WorldState = z.infer<typeof WorldStateSchema>;

export const TileObservationSchema = z.object({
  occupant: TileOccupantSchema,
  name: z.string().nullable().optional(),
  path: z.string().nullable().optional(),
  mass: z.number().int().positive().nullable().optional(),
  node_state: NodeStateSchema.nullable().optional(),
  lock_owner: z.string().nullable().optional(),
  descriptor: z.string().nullable().optional(),
  content_preview: z.string().nullable().optional(),
  git_status: GitStatusSchema.nullable().optional(),
  extension: z.string().nullable().optional(),
});

export type TileObservation = z.infer<typeof TileObservationSchema>;

export const NeighborhoodScanSchema = z.object({
  current_tick: z.number().int().min(0).max(59),
  absolute_tick: z.number().int().nonnegative(),
  agent_role: AgentRoleSchema,
  agent: PositionSchema,
  goal: PositionSchema,
  objective: PositionSchema,
  objective_path: z.string().nullable().optional(),
  current: TileObservationSchema,
  north: TileObservationSchema,
  east: TileObservationSchema,
  south: TileObservationSchema,
  west: TileObservationSchema,
});

export type NeighborhoodScan = z.infer<typeof NeighborhoodScanSchema>;

export const AgentDecisionSchema = z
  .object({
    action: z.enum(['move', 'wait', 'read', 'edit']),
    direction: DirectionSchema.optional(),
    target: z.string().min(1).optional(),
    content: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.action === 'move' && value.direction === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'direction is required when action is move',
        path: ['direction'],
      });
    }
    if ((value.action === 'read' || value.action === 'edit') && !value.target) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'target is required when action is read or edit',
        path: ['target'],
      });
    }
    if (value.action === 'edit' && value.content === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'content is required when action is edit',
        path: ['content'],
      });
    }
  });

export type AgentDecision = z.infer<typeof AgentDecisionSchema>;

export interface QueuedDecision {
  agentId: string;
  decision: AgentDecision;
  requestedAtTick: number;
  runId: number;
}

export interface WorldSnapshot {
  entities: Entity[];
  worldState: WorldState;
}

export interface Database {
  public: {
    Tables: {
      entities: {
        Row: Entity;
        Insert: Entity;
        Update: Partial<Entity>;
        Relationships: [];
      };
      world_state: {
        Row: WorldState;
        Insert: WorldState;
        Update: Partial<WorldState>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
