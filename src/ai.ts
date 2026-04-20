import { z } from 'zod';

import { HIVEMIND_LAWS } from './hivemind';
import {
  AgentDecisionSchema,
  type AgentDecision,
  type NeighborhoodScan,
} from './types';

const GEMINI_API_ROOT = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash-lite';

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
  'Each scan direction is an object. occupant can be empty, boundary, wall, goal, file, or directory.',
  'When a file or directory is present, name, path, mass, node_state, lock_owner, descriptor, git_status, and content_preview describe that structure node.',
  'Treat structure nodes as navigational landmarks, but do not attempt to walk through boundaries or walls.',
  'If you are standing on the objective node and it is in task or asymmetry state, prefer read or wait instead of walking away immediately.',
  'If a direction is blocked by a wall or boundary, choose another legal move or wait.',
  'Valid actions: move (requires direction), wait (no extras), read (requires target matching name or path of a visible file or directory), edit (requires target and content), submit (use when you have completed the assigned task and want to send it for review).',
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
  'You are given: a task description, the original file content, and the new file content after the architect\'s edit.',
  'Output JSON with: approved (boolean), feedback (string explaining what was good or what needs fixing).',
  'Be constructive but strict. Reject if the change introduces bugs, breaks existing patterns, or does not fully satisfy the task description.',
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
  action: z.enum(['move', 'wait', 'read', 'edit', 'submit']),
  direction: z.enum(['north', 'east', 'south', 'west']).optional(),
  target: z.string().min(1).optional(),
  content: z.string().optional(),
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

export class GeminiNavigator {
  private readonly warnedConfiguration = { value: false };
  private readonly warnedRequestFailure = { value: false };
  private readonly warnedRateLimit = { value: false };
  private readonly callTimestamps: number[] = [];

  public constructor(
    private readonly apiKey = process.env.GEMINI_API_KEY,
    private readonly model = process.env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL,
    private readonly maxCallsPerMinute = 60,
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

  private async callGemini(systemPrompt: string, userContent: unknown, responseSchema: object): Promise<string | null> {
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
      if (!this.warnedRateLimit.value) {
        console.warn(
          `[ai] Rate limit reached (${this.maxCallsPerMinute} calls/minute). Agent will wait until the window resets.`,
        );
        this.warnedRateLimit.value = true;
      }
      return null;
    }

    this.warnedRateLimit.value = false;
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
          generationConfig: {
            temperature: 0,
            topK: 1,
            topP: 1,
            responseMimeType: 'application/json',
            responseJsonSchema: responseSchema,
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`Gemini request failed with status ${response.status}`);
      }

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
          enum: ['move', 'wait', 'read', 'edit', 'submit'],
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
  ): Promise<{ approved: boolean; feedback: string }> {
    const text = await this.callGemini(CRITIC_SYSTEM_PROMPT, {
      task_description: taskDescription,
      original_content: originalContent,
      new_content: newContent,
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
}
