# **App Name**: Physics Lab Assistant

## Core Features:

- Simulation Setup: Allows users to define and configure physics simulations using parameters like gravity, friction, and object properties. The simulations use Planck.js and pybox2d helpers to work.
- Interactive Scene Editor: Enable users to create and edit interactive physics scenes using PixiJS for sim and Konva for ink layer. Save simulation files in S3.
- AI-Powered Guidance: An AI assistant suggests appropriate simulation parameters and tools to help students understand and solve physics problems using the LangGraph agent, chain, and tools.
- Real-time Chat Interface: Integrate a chat interface for students to ask questions and receive guidance from the AI assistant during their simulations.
- Code Generation for Simulations: Generate Python scripts to reproduce simulations and experiments using tool. Export to local machine, use case could be students needing assistance to construct more complicated simulation than they would be able to construct using the front end alone.
- Simulation Upload and Management: Allows the upload and management of simulations files within MinIO using S3

## Style Guidelines:

- Primary color: Deep sky blue (#42A5F5), evoking a sense of experimentation.
- Background color: Very light blue (#F0F7FF), providing a clean and unobtrusive backdrop.
- Accent color: Soft orange (#FFAB40) to draw attention to interactive elements and important information.
- Headline font: 'Space Grotesk' (sans-serif) for a techy and modern feel; body font: 'Inter' (sans-serif) to maintain readability in longer texts.
- Use clear and concise icons representing physical concepts and simulation controls. Adopt a flat design style with a thin stroke and a limited color palette.
- Employ a clean, modular layout with a clear separation between the simulation area, parameter controls, and AI assistant chat. Utilize whitespace to improve readability and focus.
- Incorporate subtle animations for simulation events and transitions. Highlight interactive elements with brief, clear animations to make them user friendly.