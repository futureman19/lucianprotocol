import { z } from 'zod';

export const GRID_LIMIT = 49;

export const PositionSchema = z.object({
  x: z.number().int().min(0).max(GRID_LIMIT),
  y: z.number().int().min(0).max(GRID_LIMIT),
  z: z.number().int().min(0).max(GRID_LIMIT).default(0),
});

export type Position = z.input<typeof PositionSchema>;

export const EntityTypeSchema = z.enum(['agent', 'wall', 'goal', 'file', 'directory', 'pheromone']);
export type EntityType = z.infer<typeof EntityTypeSchema>;

export const DirectionSchema = z.enum(['north', 'east', 'south', 'west']);
export type Direction = z.infer<typeof DirectionSchema>;

export const AgentRoleSchema = z.enum(['visionary', 'architect', 'critic']);
export type AgentRole = z.infer<typeof AgentRoleSchema>;

export const NodeStateSchema = z.enum(['task', 'in-progress', 'asymmetry', 'stable', 'verified']);
export type NodeState = z.infer<typeof NodeStateSchema>;

export const ControlStatusSchema = z.enum(['idle', 'importing', 'active', 'error']);
export type ControlStatus = z.infer<typeof ControlStatusSchema>;

export const OperatorActionSchema = z.enum(['navigate', 'read', 'explain', 'maintain']);
export type OperatorAction = z.infer<typeof OperatorActionSchema>;

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

export const AgentFileReadSchema = z.object({
  content_hash: z.string().min(1),
  tick_read: z.number().int().nonnegative(),
  summary: z.string(),
});

export type AgentFileRead = z.infer<typeof AgentFileReadSchema>;

export const AgentBroadcastRecordSchema = z.object({
  message: z.string().min(1),
  tick: z.number().int().nonnegative(),
});

export type AgentBroadcastRecord = z.infer<typeof AgentBroadcastRecordSchema>;

export const AgentMemorySchema = z.object({
  files_read: z.record(z.string(), AgentFileReadSchema),
  lessons: z.array(z.string()),
  last_broadcast: AgentBroadcastRecordSchema.nullable(),
});

export type AgentMemory = z.infer<typeof AgentMemorySchema>;

export const EntitySchema = z.object({
  id: z.string().min(1),
  type: EntityTypeSchema,
  x: z.number().int().min(0).max(GRID_LIMIT),
  y: z.number().int().min(0).max(GRID_LIMIT),
  z: z.number().int().min(0).max(GRID_LIMIT).default(0),
  mass: z.number().int().positive(),
  tick_updated: z.number().int().nonnegative(),
  agent_role: AgentRoleSchema.nullable().optional(),
  node_state: NodeStateSchema.nullable().optional(),
  lock_owner: z.string().min(1).nullable().optional(),
  lock_tick: z.number().int().nonnegative().nullable().optional(),
  state_tick: z.number().int().nonnegative().nullable().optional(),
  objective_path: z.string().min(1).nullable().optional(),
  memory: AgentMemorySchema.nullable().optional(),
  author_id: z.string().min(1).nullable().optional(),
  message: z.string().min(1).nullable().optional(),
  ttl_ticks: z.number().int().nonnegative().nullable().optional(),
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
  last_commit_sha: z.string().min(1).nullable().optional(),
  last_commit_message: z.string().nullable().optional(),
  last_commit_author: z.string().nullable().optional(),
  last_commit_date: z.string().nullable().optional(),
  git_diff: z.string().nullable().optional(),
  tether_to: z.array(z.string()).nullable().optional(),
  tether_from: z.array(z.string()).nullable().optional(),
  tether_broken: z.boolean().nullable().optional(),
});

export type Entity = z.input<typeof EntitySchema>;

export const WorldStatusSchema = z.enum(['booting', 'running', 'goal-reached', 'stalled']);
export type WorldStatus = z.infer<typeof WorldStatusSchema>;

export const TaskStatusSchema = z.enum([
  'pending',
  'assigned',
  'in_progress',
  'awaiting_review',
  'revision_needed',
  'approved',
  'done',
]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const ValidationStatusSchema = z.enum(['idle', 'running', 'clean', 'warnings', 'errors']);
export type ValidationStatus = z.infer<typeof ValidationStatusSchema>;

export const TaskValidationResultSchema = z.object({
  status: ValidationStatusSchema,
  summary: z.string().nullable().optional(),
  output: z.string().nullable().optional(),
  command: z.string().nullable().optional(),
  checked_at_tick: z.number().int().nonnegative().nullable().optional(),
});
export type TaskValidationResult = z.infer<typeof TaskValidationResultSchema>;

export const TaskValidationSchema = z.object({
  lint: TaskValidationResultSchema.nullable().optional(),
  typecheck: TaskValidationResultSchema.nullable().optional(),
});
export type TaskValidation = z.infer<typeof TaskValidationSchema>;

export const TaskSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  target_path: z.string().min(1),
  status: TaskStatusSchema,
  assigned_agent_id: z.string().nullable().optional(),
  original_content: z.string().nullable().optional(),
  completed_content: z.string().nullable().optional(),
  review_feedback: z.string().nullable().optional(),
  validation: TaskValidationSchema.nullable().optional(),
  created_at_tick: z.number().int().nonnegative(),
  updated_at_tick: z.number().int().nonnegative(),
});
export type Task = z.infer<typeof TaskSchema>;

export const AgentActivitySchema = z.object({
  agent_id: z.string().min(1),
  agent_role: z.enum(['visionary', 'architect', 'critic']),
  status: z.enum(['thinking', 'walking', 'reading', 'editing', 'idle']),
  target_path: z.string().nullable().optional(),
  tick: z.number().int().nonnegative(),
});
export type AgentActivity = z.infer<typeof AgentActivitySchema>;

export const ExplainStatusSchema = z.enum(['idle', 'pending', 'streaming', 'complete', 'error']);
export type ExplainStatus = z.infer<typeof ExplainStatusSchema>;

export const WorldStateSchema = z.object({
  id: z.string().min(1),
  seed: z.string().min(1),
  tick: z.number().int().nonnegative(),
  phase: z.number().int().min(0).max(59),
  status: WorldStatusSchema,
  active_repo_path: z.string().min(1).nullable().optional(),
  active_repo_name: z.string().min(1).nullable().optional(),
  operator_prompt: z.string().nullable().optional(),
  control_status: ControlStatusSchema.nullable().optional(),
  control_error: z.string().nullable().optional(),
  operator_action: OperatorActionSchema.nullable().optional(),
  operator_target_query: z.string().nullable().optional(),
  operator_target_path: z.string().nullable().optional(),
  import_started_at: z.string().nullable().optional(),
  import_finished_at: z.string().nullable().optional(),
  last_import_duration_ms: z.number().int().nonnegative().nullable().optional(),
  last_tick_duration_ms: z.number().int().nonnegative().nullable().optional(),
  last_ai_latency_ms: z.number().int().nonnegative().nullable().optional(),
  max_ai_latency_ms: z.number().int().nonnegative().nullable().optional(),
  queue_depth: z.number().int().nonnegative().optional(),
  paused: z.boolean().nullable().optional(),
  saved_overlay_names: z.array(z.string()).nullable().optional(),
  automate: z.boolean().nullable().optional(),
  visionary_prompt: z.string().nullable().optional(),
  architect_prompt: z.string().nullable().optional(),
  critic_prompt: z.string().nullable().optional(),
  pending_edit_path: z.string().nullable().optional(),
  pending_edit_content: z.string().nullable().optional(),
  commit_message: z.string().nullable().optional(),
  should_push: z.boolean().nullable().optional(),
  explanation_status: ExplainStatusSchema.nullable().optional(),
  explanation_target_path: z.string().nullable().optional(),
  explanation_agent_id: z.string().nullable().optional(),
  explanation_content_hash: z.string().nullable().optional(),
  explanation_text: z.string().nullable().optional(),
  explanation_error: z.string().nullable().optional(),
  explanation_updated_at_tick: z.number().int().nonnegative().nullable().optional(),
  queen_cycle: z.number().int().nonnegative().nullable().optional(),
  queen_alarm: z.number().int().min(0).max(255).nullable().optional(),
  queen_urgency: z.number().int().min(0).max(255).nullable().optional(),
  active_tasks: z.array(TaskSchema).nullable().optional(),
  agent_activities: z.array(AgentActivitySchema).nullable().optional(),
});

export type WorldState = z.infer<typeof WorldStateSchema>;

export const OperatorControlSchema = z.object({
  id: z.string().min(1),
  repo_path: z.string(),
  operator_prompt: z.string(),
  paused: z.boolean().nullable().optional(),
  automate: z.boolean().nullable().optional(),
  visionary_prompt: z.string().nullable().optional(),
  architect_prompt: z.string().nullable().optional(),
  critic_prompt: z.string().nullable().optional(),
  pending_edit_path: z.string().nullable().optional(),
  pending_edit_content: z.string().nullable().optional(),
  commit_message: z.string().nullable().optional(),
  should_push: z.boolean().nullable().optional(),
  updated_at: z.string().nullable().optional(),
});

export type OperatorControl = z.infer<typeof OperatorControlSchema>;

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

export const PheromoneSignalSchema = z.object({
  author_id: z.string().min(1),
  message: z.string().min(1),
  ttl_remaining: z.number().int().nonnegative(),
});

export type PheromoneSignal = z.infer<typeof PheromoneSignalSchema>;

export const NeighborhoodScanSchema = z.object({
  current_tick: z.number().int().min(0).max(59),
  absolute_tick: z.number().int().nonnegative(),
  agent_role: AgentRoleSchema,
  agent: PositionSchema,
  goal: PositionSchema,
  objective: PositionSchema,
  operator_action: OperatorActionSchema.nullable().optional(),
  operator_target_query: z.string().nullable().optional(),
  objective_path: z.string().nullable().optional(),
  operator_prompt: z.string().nullable().optional(),
  agent_prompt: z.string().nullable().optional(),
  current: TileObservationSchema,
  north: TileObservationSchema,
  east: TileObservationSchema,
  south: TileObservationSchema,
  west: TileObservationSchema,
  pheromones: z.array(PheromoneSignalSchema),
  agent_memory: AgentMemorySchema,
  task_context: z.string().nullable().optional(),
  full_content: z.string().nullable().optional(),
});

export type NeighborhoodScan = z.input<typeof NeighborhoodScanSchema>;

export const AgentDecisionSchema = z
  .object({
    action: z.enum(['move', 'wait', 'read', 'edit', 'submit', 'broadcast', 'patch', 'insert', 'delete']),
    direction: DirectionSchema.optional(),
    target: z.string().min(1).optional(),
    content: z.string().optional(),
    message: z.string().min(1).optional(),
    old_text: z.string().optional(),
    new_text: z.string().optional(),
    after_line: z.number().int().nonnegative().optional(),
    start_line: z.number().int().positive().optional(),
    end_line: z.number().int().positive().optional(),
    text: z.string().optional(),
    explanation_cache_key: z.string().min(1).optional(),
    explanation_text: z.string().optional(),
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
    if (value.action === 'broadcast' && value.message === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'message is required when action is broadcast',
        path: ['message'],
      });
    }
    if (value.action === 'patch' && (!value.target || value.old_text === undefined || value.new_text === undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'target, old_text, and new_text are required when action is patch',
        path: ['target'],
      });
    }
    if (value.action === 'insert' && (!value.target || value.after_line === undefined || value.text === undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'target, after_line, and text are required when action is insert',
        path: ['target'],
      });
    }
    if (value.action === 'delete' && (!value.target || value.start_line === undefined || value.end_line === undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'target, start_line, and end_line are required when action is delete',
        path: ['target'],
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
      operator_controls: {
        Row: OperatorControl;
        Insert: OperatorControl;
        Update: Partial<OperatorControl>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
