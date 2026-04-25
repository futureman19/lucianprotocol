import { z } from 'zod';

import { HIVEMIND_LAWS } from './hivemind';
import {
  AgentDecisionSchema,
  type AgentDecision,
  type NeighborhoodScan,
} from './types';

const GEMINI_API_ROOT = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash-lite';
const DEFAULT_MAX_CALLS_PER_MINUTE = 60;
const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 60_000;

function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseRetryAfterMs(retryAfterHeader: string | null): number | null {
  if (!retryAfterHeader) {
    return null;
  }

  const seconds = Number.parseInt(retryAfterHeader, 10);
  if (Number.isFinite(seconds) && seconds > 0) {
    return seconds * 1000;
  }

  const timestamp = Date.parse(retryAfterHeader);
  if (Number.isNaN(timestamp)) {
    return null;
  }

  return Math.max(0, timestamp - Date.now());
}

const ARCHITECT_SYSTEM_PROMPT = [
  'You are an Architect agent in the Lux Protocol Hivemind.',
  'You are a worker ant. Your job is to execute tasks assigned to you by the Visionary.',
  'Operate only on integer coordinates in a deterministic 50x50 grid.',
  ...HIVEMIND_LAWS.map((law, index) => `Law ${index + 1}: ${law}`),
  'Use the immediate scan plus the objective coordinates to choose one action for this tick.',
  'north decrements y, south increments y, east increments x, west decrements x.',
  'Prefer moves that reduce Manhattan distance to the objective.',
  'agent_role identifies your hivemind role. objective_path names the current target node when available.',
  'operator_action identifies whether the orchestrator wants navigation, reading, explanation, or general maintenance.',
  'operator_target_query is the raw file or directory query extracted from the orchestrator prompt when available.',
  'operator_prompt contains the current instruction from the human orchestrator. Favor actions that advance that instruction without violating determinism.',
  'task_context contains your current assigned task description when one is active.',
  'full_content contains the COMPLETE file text ONLY when you are standing on a file node AND have locked it (lock_owner === your id). This is your editor view. Use it to perform precise surgical edits.',
  'Memory & Signals: agent_memory contains files you already read plus lessons learned from critic feedback.',
  'Memory & Signals: pheromones contains nearby broadcast messages from agents within the local 5-tile neighborhood.',
  'Use broadcast to warn other agents about claimed files, risky edits, or found bugs when local coordination would help.',
  'Each scan direction is an object. occupant can be empty, boundary, wall, goal, file, or directory.',
  'When a file or directory is present, name, path, mass, node_state, lock_owner, descriptor, git_status, and content_preview describe that structure node.',
  'Treat structure nodes as navigational landmarks, but do not attempt to walk through boundaries or walls.',
  'If you are standing on the objective node and it is in task or asymmetry state, prefer read or wait instead of walking away immediately.',
  'If a direction is blocked by a wall or boundary, choose another legal move or wait.',
  'Valid actions: move (requires direction), wait (no extras), read (requires target matching name or path of a visible file or directory), edit (requires target and content — replaces entire file, avoid for large files), submit (use when you have completed the assigned task and want to send it for review), broadcast (requires message).',
  'SURGICAL EDITING — prefer these over "edit" when full_content is available:',
  '  patch (target, old_text, new_text) — find old_text and replace with new_text. Use for renames, typo fixes, changing function signatures, updating constants.',
  '  insert (target, after_line, text) — insert text after the given 1-indexed line. after_line: 0 prepends to start. Use for adding imports, new functions, or test cases.',
  '  delete (target, start_line, end_line) — delete lines start_line through end_line inclusive (1-indexed). Use for removing dead code, unused imports, or old implementations.',
  'Return JSON only.',
].join(' ');

const VISIONARY_SYSTEM_PROMPT = [
  'You are a Visionary agent in the Lux Protocol Hivemind.',
  'Your job is to interpret high-level user requests and break them into concrete, actionable tasks for Architect worker ants.',
  'You do NOT write code. You plan and delegate.',
  'Given a user prompt and a codebase summary, output a JSON array of tasks.',
  'Each task must have: id (short string like "t1"), description (clear instruction), target_path (the file or directory to modify).',
  'Tasks should be specific and granular. Prefer 2-5 tasks per request.',
  'Return JSON only.',
].join(' ');

const CRITIC_SYSTEM_PROMPT = [
  'You are a Critic agent in the Lux Protocol Hivemind.',
  'Your job is to review completed work from Architect agents and approve or reject it.',
  'You are given: a task description, the original file content, the new file content after the architect\'s edit, and grounded validation output from lint and typecheck.',
  'If grounded_validation reports errors that are caused by the edited file or the change, reject unless the task explicitly required leaving them unresolved.',
  'Output JSON with: approved (boolean), feedback (string explaining what was good or what needs fixing).',
  'Be constructive but strict. Reject if the change introduces bugs, breaks existing patterns, or does not fully satisfy the task description.',
  'Return JSON only.',
].join(' ');

const EXPLAIN_SYSTEM_PROMPT = [
  'You are a precise code explainer for the Lux Protocol operator.',
  'You are given an operator prompt, a target path, and file content.',
  'Produce a concise natural-language explanation grounded only in the provided file text.',
  'Prioritize actual control flow, responsibilities, data flow, side effects, and anything directly relevant to the operator prompt.',
  'If the content is partial or truncated, say so explicitly and avoid guessing about unseen code.',
  'Return plain text only.',
].join(' ');

const COMMIT_MESSAGE_SYSTEM_PROMPT = [
  'You are a concise git commit message writer.',
  'Given a list of completed task descriptions, write a single commit message.',
  'Output JSON with: message (string, max 72 chars for first line).',
  'The message should be descriptive but brief. Use conventional commits style if appropriate.',
  'Return JSON only.',
].join(' ');

const GeminiResponseSchema = z.object({
  candidates: z
    .array(
      z.object({
        content: z
          .object({
            parts: z.array(
              z.object({
                text: z.string().optional(),
              }),
            ),
          })
          .optional(),
      }),
    )
    .min(1),
});

const GeminiDecisionTextSchema = z.object({
  action: z.enum(['move', 'wait', 'read', 'edit', 'submit', 'broadcast', 'patch', 'insert', 'delete']),
  direction: z.enum(['north', 'east', 'south', 'west']).optional(),
  target: z.string().min(1).optional(),
  content: z.string().optional(),
  message: z.string().min(1).optional(),
  old_text: z.string().optional(),
  new_text: z.string().optional(),
  after_line: z.number().int().nonnegative().optional(),
  start_line: z.number().int().positive().optional(),
  end_line: z.number().int().positive().optional(),
  text: z.string().optional(),
});

const GeminiTaskListSchema = z.array(
  z.object({
    id: z.string().min(1),
    description: z.string().min(1),
    target_path: z.string().min(1),
  }),
);

const GeminiReviewSchema = z.object({
  approved: z.boolean(),
  feedback: z.string(),
});

const GeminiCommitMessageSchema = z.object({
  message: z.string().min(1),
});

export class GeminiNavigator {
  private readonly warnedConfiguration = { value: false };
  private readonly warnedRequestFailure = { value: false };
  private readonly warnedLocalRateLimit = { value: false };
  private readonly warnedProviderRateLimit = { value: false };
  private readonly callTimestamps: number[] = [];
  private rateLimitCooldownUntilMs = 0;

  public constructor(
    private readonly apiKey = process.env.GEMINI_API_KEY,
    private readonly model = process.env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL,
    private readonly maxCallsPerMinute = parsePositiveIntEnv(
      'GEMINI_MAX_CALLS_PER_MINUTE',
      DEFAULT_MAX_CALLS_PER_MINUTE,
    ),
    private readonly rateLimitCooldownMs = parsePositiveIntEnv(
      'GEMINI_RATE_LIMIT_COOLDOWN_MS',
      DEFAULT_RATE_LIMIT_COOLDOWN_MS,
    ),
  ) {}

  public isConfigured(): boolean {
    return this.apiKey !== undefined && this.apiKey.trim().length > 0;
  }

  private isRateLimited(): boolean {
    const now = Date.now();
    const windowStart = now - 60_000;
    const recentCalls = this.callTimestamps.filter((t) => t >= windowStart);
    this.callTimestamps.length = 0;
    this.callTimestamps.push(...recentCalls);
    return recentCalls.length >= this.maxCallsPerMinute;
  }

  private recordCall(): void {
    this.callTimestamps.push(Date.now());
  }

  private isProviderCoolingDown(): boolean {
    return Date.now() < this.rateLimitCooldownUntilMs;
  }

  private applyProviderCooldown(retryAfterHeader: string | null): void {
    const cooldownMs = parseRetryAfterMs(retryAfterHeader) ?? this.rateLimitCooldownMs;
    this.rateLimitCooldownUntilMs = Date.now() + cooldownMs;
  }

  private async callGemini(
    systemPrompt: string,
    userContent: unknown,
    responseSchema?: object,
  ): Promise<string | null> {
    if (!this.isConfigured()) {
      if (!this.warnedConfiguration.value) {
        console.warn(
          '[ai] GEMINI_API_KEY is missing; agent decisions will default to wait until credentials are configured.',
        );
        this.warnedConfiguration.value = true;
      }
      return null;
    }

    if (this.isRateLimited()) {
      if (!this.warnedLocalRateLimit.value) {
        console.warn(
          `[ai] Rate limit reached (${this.maxCallsPerMinute} calls/minute). Agent will wait until the window resets.`,
        );
        this.warnedLocalRateLimit.value = true;
      }
      return null;
    }

    this.warnedLocalRateLimit.value = false;

    if (this.isProviderCoolingDown()) {
      if (!this.warnedProviderRateLimit.value) {
        const retryInSeconds = Math.max(
          1,
          Math.ceil((this.rateLimitCooldownUntilMs - Date.now()) / 1000),
        );
        console.warn(
          `[ai] Gemini provider rate limit active; agent will wait ${retryInSeconds}s before retrying.`,
        );
        this.warnedProviderRateLimit.value = true;
      }
      return null;
    }

    this.warnedProviderRateLimit.value = false;
    this.recordCall();

    try {
      const response = await fetch(`${GEMINI_API_ROOT}/${this.model}:generateContent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.apiKey ?? '',
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: systemPrompt }],
          },
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: JSON.stringify(userContent),
                },
              ],
            },
          ],
          generationConfig:
            responseSchema === undefined
              ? {
                temperature: 0.1,
                topK: 1,
                topP: 1,
              }
              : {
                temperature: 0,
                topK: 1,
                topP: 1,
                responseMimeType: 'application/json',
                responseJsonSchema: responseSchema,
              },
        }),
      });

      if (!response.ok) {
        if (response.status === 429) {
          this.applyProviderCooldown(response.headers.get('retry-after'));
          const retryInSeconds = Math.max(
            1,
            Math.ceil((this.rateLimitCooldownUntilMs - Date.now()) / 1000),
          );
          if (!this.warnedProviderRateLimit.value) {
            console.warn(
              `[ai] Gemini provider returned 429; agent will back off for ${retryInSeconds}s.`,
            );
            this.warnedProviderRateLimit.value = true;
          }
          return null;
        }

        throw new Error(`Gemini request failed with status ${response.status}`);
      }

      this.warnedRequestFailure.value = false;
      const rawResponse = await response.json();
      const parsedResponse = GeminiResponseSchema.parse(rawResponse);
      const text = parsedResponse.candidates
        .flatMap((candidate) => candidate.content?.parts ?? [])
        .map((part) => part.text)
        .find((value): value is string => value !== undefined);

      return text ?? null;
    } catch (error) {
      if (!this.warnedRequestFailure.value) {
        const message = error instanceof Error ? error.message : 'Unknown Gemini error';
        console.warn(`[ai] ${message}; agent will wait on failed turns.`);
        this.warnedRequestFailure.value = true;
      }
      return null;
    }
  }

  public async requestDecision(scan: NeighborhoodScan): Promise<AgentDecision> {
    const systemPrompt = scan.agent_prompt
      ? `${ARCHITECT_SYSTEM_PROMPT}\n\nAdditional directive from orchestrator for this agent: ${scan.agent_prompt}`
      : ARCHITECT_SYSTEM_PROMPT;

    const text = await this.callGemini(systemPrompt, scan, {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['move', 'wait', 'read', 'edit', 'submit', 'broadcast', 'patch', 'insert', 'delete'],
        },
        direction: {
          type: 'string',
          enum: ['north', 'east', 'south', 'west'],
        },
        target: {
          type: 'string',
        },
        content: {
          type: 'string',
        },
        message: {
          type: 'string',
        },
        old_text: {
          type: 'string',
        },
        new_text: {
          type: 'string',
        },
        after_line: {
          type: 'integer',
          minimum: 0,
        },
        start_line: {
          type: 'integer',
          minimum: 1,
        },
        end_line: {
          type: 'integer',
          minimum: 1,
        },
        text: {
          type: 'string',
        },
      },
      required: ['action'],
    });

    if (!text) {
      return { action: 'wait' };
    }

    try {
      const parsedDecisionText = GeminiDecisionTextSchema.parse(JSON.parse(text));
      const validatedDecision = AgentDecisionSchema.parse(parsedDecisionText);
      return validatedDecision;
    } catch {
      return { action: 'wait' };
    }
  }

  public async requestVisionaryPlan(
    operatorPrompt: string,
    codebaseSummary: string,
  ): Promise<Array<{ id: string; description: string; target_path: string }>> {
    const text = await this.callGemini(VISIONARY_SYSTEM_PROMPT, {
      operator_prompt: operatorPrompt,
      codebase_summary: codebaseSummary,
    }, {
      type: 'object',
      properties: {
        tasks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              description: { type: 'string' },
              target_path: { type: 'string' },
            },
            required: ['id', 'description', 'target_path'],
          },
        },
      },
      required: ['tasks'],
    });

    if (!text) {
      return [];
    }

    try {
      const parsed = JSON.parse(text);
      const taskList = GeminiTaskListSchema.parse(parsed.tasks);
      return taskList;
    } catch {
      return [];
    }
  }

  public async requestCriticReview(
    taskDescription: string,
    originalContent: string,
    newContent: string,
    groundedValidation: string,
  ): Promise<{ approved: boolean; feedback: string }> {
    const text = await this.callGemini(CRITIC_SYSTEM_PROMPT, {
      task_description: taskDescription,
      original_content: originalContent,
      new_content: newContent,
      grounded_validation: groundedValidation,
    }, {
      type: 'object',
      properties: {
        approved: { type: 'boolean' },
        feedback: { type: 'string' },
      },
      required: ['approved', 'feedback'],
    });

    if (!text) {
      return { approved: false, feedback: 'Critic review failed; agent will retry.' };
    }

    try {
      const parsed = GeminiReviewSchema.parse(JSON.parse(text));
      return parsed;
    } catch {
      return { approved: false, feedback: 'Critic review parse failed; agent will retry.' };
    }
  }

  public async requestExplanation(
    operatorPrompt: string,
    targetPath: string,
    fileContent: string,
    contentState: 'complete' | 'partial',
  ): Promise<string | null> {
    const text = await this.callGemini(EXPLAIN_SYSTEM_PROMPT, {
      operator_prompt: operatorPrompt,
      target_path: targetPath,
      content_state: contentState,
      file_content: fileContent,
    });

    const normalized = text?.trim();
    return normalized && normalized.length > 0 ? normalized : null;
  }

  public async requestCommitMessage(
    taskDescriptions: string[],
  ): Promise<string | null> {
    const text = await this.callGemini(COMMIT_MESSAGE_SYSTEM_PROMPT, {
      tasks: taskDescriptions,
    }, {
      type: 'object',
      properties: {
        message: { type: 'string' },
      },
      required: ['message'],
    });

    if (!text) {
      return null;
    }

    try {
      const parsed = JSON.parse(text);
      const result = GeminiCommitMessageSchema.parse(parsed);
      return result.message;
    } catch {
      return null;
    }
  }
}
