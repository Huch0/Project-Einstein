// Placeholder action functions for chat and code generation.
// TODO: Integrate with backend agent endpoints or Genkit flows.

export async function handleChatSubmit(formData: FormData): Promise<{ message?: string; error?: string }> {
  const userMessage = formData.get('message') || formData.get('input');
  if (!userMessage || typeof userMessage !== 'string') {
    return { error: 'No message provided.' };
  }
  // Simple echo + hint; replace with real AI call.
  return {
    message: `You said: "${userMessage}"\n\n(Agent parsing & scene extraction coming soon.)`,
  };
}

export async function handleGenerateCode(): Promise<{ code?: string; error?: string }> {
  // Stub generating Python code for current (implicit) pulley scene. In future accept a serialized scene object.
  const code = `# Auto-generated pulley simulation stub\n` +
`# TODO: integrate with rapier-wasm or a physics engine binding.\n` +
`import math\n\n` +
`m1 = 2.0  # kg\n` +
`m2 = 5.0  # kg\n` +
`g = 9.81  # m/s^2\n` +
`# Ideal pulley acceleration (m2 > m1)\n` +
`a = (m2 - m1) * g / (m1 + m2)\n` +
`t = 0.0\n` +
`dt = 0.016\n` +
`v = 0.0\n` +
`s = 0.0  # displacement of heavier mass downward\n` +
`for step in range(120):\n` +
`    v += a * dt\n` +
`    s += v * dt\n` +
`    t += dt\n` +
`    if step % 15 == 0:\n` +
`        print(f't={t:.3f}s s={s:.3f}m v={v:.3f}m/s')\n`;
  return { code };
}
