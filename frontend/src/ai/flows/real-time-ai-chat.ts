'use server';

/**
 * @fileOverview A real-time chat interface for AI assistance during simulations.
 *
 * - realTimeAIChat - A function that handles the chat interaction and returns AI guidance.
 * - RealTimeAIChatInput - The input type for the realTimeAIChat function.
 * - RealTimeAIChatOutput - The return type for the realTimeAIChat function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const RealTimeAIChatInputSchema = z.object({
  sceneId: z.string().describe('The ID of the current simulation scene.'),
  message: z.string().describe('The user message to be processed.'),
});
export type RealTimeAIChatInput = z.infer<typeof RealTimeAIChatInputSchema>;

const RealTimeAIChatOutputSchema = z.object({
  messages: z.array(z.string()).describe('An array of messages from the AI assistant.'),
  tool_calls: z.array(z.any()).describe('An array of tool calls made by the AI assistant.'),
  diffs: z.array(z.string()).describe('An array of diffs resulting from tool calls.'),
});
export type RealTimeAIChatOutput = z.infer<typeof RealTimeAIChatOutputSchema>;

export async function realTimeAIChat(input: RealTimeAIChatInput): Promise<RealTimeAIChatOutput> {
  return realTimeAIChatFlow(input);
}

const prompt = ai.definePrompt({
  name: 'realTimeAIChatPrompt',
  input: {schema: RealTimeAIChatInputSchema},
  output: {schema: RealTimeAIChatOutputSchema},
  prompt: `You are an AI assistant helping a learner with a physics simulation.
  The learner is interacting with a simulation scene with ID {{sceneId}}.
  The learner has sent the following message: {{{message}}}

  Respond with helpful guidance, and suggest appropriate simulation parameters and tools to use.
  Return messages, tool_calls, and diffs in the output schema format.
  Messages should be conversational and helpful.
  Tool calls should be valid and appropriate for the given simulation scene and user message.
  Diffs should describe the changes made to the simulation scene as a result of tool calls.
  If no tool calls are needed, return empty arrays for tool_calls and diffs.
`,
});

const realTimeAIChatFlow = ai.defineFlow(
  {
    name: 'realTimeAIChatFlow',
    inputSchema: RealTimeAIChatInputSchema,
    outputSchema: RealTimeAIChatOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);
