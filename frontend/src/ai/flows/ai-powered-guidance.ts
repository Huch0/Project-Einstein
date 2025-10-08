'use server';
/**
 * @fileOverview Provides AI-powered guidance to learners by suggesting simulation parameters and tools.
 *
 * - getAiGuidance - A function that provides AI guidance based on the scene graph.
 * - AiGuidanceInput - The input type for the getAiGuidance function.
 * - AiGuidanceOutput - The return type for the getAiGuidance function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const AiGuidanceInputSchema = z.object({
  sceneGraph: z.string().describe('The JSON representation of the current scene graph.'),
  userQuestion: z.string().optional().describe('The user question about the scene graph, if any.'),
});
export type AiGuidanceInput = z.infer<typeof AiGuidanceInputSchema>;

const AiGuidanceOutputSchema = z.object({
  suggestions: z.array(z.string()).describe('Suggestions for simulation parameters and tools.'),
  reasoning: z.string().describe('The AI’s reasoning behind the suggestions.'),
});
export type AiGuidanceOutput = z.infer<typeof AiGuidanceOutputSchema>;

export async function getAiGuidance(input: AiGuidanceInput): Promise<AiGuidanceOutput> {
  return aiGuidanceFlow(input);
}

const aiGuidancePrompt = ai.definePrompt({
  name: 'aiGuidancePrompt',
  input: {schema: AiGuidanceInputSchema},
  output: {schema: AiGuidanceOutputSchema},
  prompt: `You are an AI assistant helping a student understand a physics simulation.

Based on the current scene graph:
{{{sceneGraph}}}

And the student's question (if any):
{{{userQuestion}}}

Suggest appropriate simulation parameters and tools the student can use to better understand and solve physics problems. Explain your reasoning.

Format your response as a JSON object with 'suggestions' (an array of strings) and 'reasoning' (a string).`,
});

const aiGuidanceFlow = ai.defineFlow(
  {
    name: 'aiGuidanceFlow',
    inputSchema: AiGuidanceInputSchema,
    outputSchema: AiGuidanceOutputSchema,
  },
  async input => {
    const {output} = await aiGuidancePrompt(input);
    return output!;
  }
);
