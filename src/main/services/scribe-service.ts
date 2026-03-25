function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function getScribeToken(): Promise<string> {
  const apiKey = getRequiredEnv('ELEVENLABS_API_KEY');
  const { ElevenLabsClient } = await import('@elevenlabs/elevenlabs-js');
  const client = new ElevenLabsClient({ apiKey });
  const response = await client.tokens.singleUse.create('realtime_scribe');
  return response.token;
}

export { getRequiredEnv, getScribeToken };
