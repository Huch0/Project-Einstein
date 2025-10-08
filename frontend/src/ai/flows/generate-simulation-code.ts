'use server';

/**
 * @fileOverview This file defines a Genkit flow for generating Python code to reproduce physics simulations.
 *
 * It allows students to extend and customize simulations beyond the UI's capabilities.
 *
 * - generateSimulationCode - A function that takes a scene ID and returns Python code to reproduce the simulation.
 * - GenerateSimulationCodeInput - The input type for the generateSimulationCode function (scene ID).
 * - GenerateSimulationCodeOutput - The return type for the generateSimulationCode function (Python code string).
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const GenerateSimulationCodeInputSchema = z.object({
  sceneId: z.string().describe('The ID of the simulation scene to reproduce.'),
});

export type GenerateSimulationCodeInput = z.infer<
  typeof GenerateSimulationCodeInputSchema
>;

const GenerateSimulationCodeOutputSchema = z.object({
  pythonCode: z
    .string()
    .describe(
      'A Python script that recreates the simulation defined by the scene ID.'
    ),
});

export type GenerateSimulationCodeOutput = z.infer<
  typeof GenerateSimulationCodeOutputSchema
>;

export async function generateSimulationCode(
  input: GenerateSimulationCodeInput
): Promise<GenerateSimulationCodeOutput> {
  return generateSimulationCodeFlow(input);
}

const generateSimulationCodePrompt = ai.definePrompt({
  name: 'generateSimulationCodePrompt',
  input: {schema: GenerateSimulationCodeInputSchema},
  output: {schema: GenerateSimulationCodeOutputSchema},
  prompt: `You are an expert physics simulation programmer.

You will generate a Python script that reproduces a given physics simulation, using the pybox2d library.

The simulation scene is represented by the following ID: {{{sceneId}}}.

Based on the scene, create a python script which uses pybox2d to create the described simulation.
Include comments in the code.
Assume the simulation parameters such as gravity, friction, and object properties need to be definable.
Ensure that the generated code includes all necessary setup, object definitions, and simulation steps.

Your response should contain ONLY the runnable code, with no other explanation. Do not include markdown formatting.
`,
});

const generateSimulationCodeFlow = ai.defineFlow(
  {
    name: 'generateSimulationCodeFlow',
    inputSchema: GenerateSimulationCodeInputSchema,
    outputSchema: GenerateSimulationCodeOutputSchema,
  },
  async input => {
    const {output} = await generateSimulationCodePrompt(input);
    return {
      pythonCode: output!.pythonCode,
    };
  }
);
