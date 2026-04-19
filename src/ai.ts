import { z } from 'zod';

import { HIVEMIND_LAWS } from './hivemind';
import {
  AgentDecisionSchema,
  type AgentDecision,
  type NeighborhoodScan,
} from './types';

const GEMINI_API_ROOT = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash-lite';

const SYSTEM_PROMPT = [
  'You are an Architect agent in the Lux Protocol Hivemind.',
  'Operate only on integer coordinates in a deterministic 50x50 grid.',
  ...HIVEMIND_LAWS.map((law, index) => `Law ${index + 1}: ${law}`),
  'Use the immediate scan plus the objective coordinates to choose one action for this tick.',
  'north decrements y, south increments y, east increments x, west decrements x.',
  'Prefer moves that reduce Manhattan distance to the objective.',
  'agent_role identifies your hivemind role. objective_path names the current target node when available.',
  'Each scan direction is an object. occupant can be empty, boundary, wall, goal, file, or directory.',
  'When a file or directory is present, name, path, mass, node_state, lock_owner, descriptor, git_status, and content_preview describe that structure node.',
  'Treat structure nodes as navigational landmarks, but do not attempt to walk through boundaries or walls.',
  'If you are standing on the objective node and it is in task or asymmetry state, prefer read or wait instead of walking away immediately.',
  'If a direction is blocked by a wall or boundary, choose another legal move or wait.',
  'Valid actions: move (requires direction), wait (no extras), read (requires target matching name or path of a visible file or directory), edit (requires target and content; reserved for Week 3).',
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
  action: z.enum(['move', 'wait', 'read', 'edit']),
  direction: z.enum(['north', 'east', 'south', 'west']).optional(),
  target: z.string().min(1).optional(),
  content: z.string().optional(),
});

export class GeminiNavigator {
  private readonly warnedConfiguration = { value: false };
  private readonly warnedRequestFailure = { value: false };

  public constructor(
    private readonly apiKey = process.env.GEMINI_API_KEY,
    private readonly model = process.env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL,
  ) {}

  public isConfigured(): boolean {
    return this.apiKey !== undefined && this.apiKey.trim().length > 0;
  }

  public async requestDecision(scan: NeighborhoodScan): Promise<AgentDecision> {
    if (!this.isConfigured()) {
      if (!this.warnedConfiguration.value) {
        console.warn(
          '[ai] GEMINI_API_KEY is missing; agent decisions will default to wait until credentials are configured.',
        );
        this.warnedConfiguration.value = true;
      }

      return { action: 'wait' };
    }

    try {
      const response = await fetch(`${GEMINI_API_ROOT}/${this.model}:generateContent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.apiKey ?? '',
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: SYSTEM_PROMPT }],
          },
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: JSON.stringify(scan),
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0,
            topK: 1,
            topP: 1,
            responseMimeType: 'application/json',
            responseJsonSchema: {
              type: 'object',
              properties: {
                action: {
                  type: 'string',
                  enum: ['move', 'wait', 'read', 'edit'],
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
            },
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

      if (!text) {
        return { action: 'wait' };
      }

      const parsedDecisionText = GeminiDecisionTextSchema.parse(JSON.parse(text));
      const validatedDecision = AgentDecisionSchema.parse(parsedDecisionText);
      return validatedDecision;
    } catch (error) {
      if (!this.warnedRequestFailure.value) {
        const message = error instanceof Error ? error.message : 'Unknown Gemini error';
        console.warn(`[ai] ${message}; agent will wait on failed turns.`);
        this.warnedRequestFailure.value = true;
      }

      return { action: 'wait' };
    }
  }
}
