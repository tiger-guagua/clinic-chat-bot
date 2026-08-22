import { Router } from 'express';
import { z } from 'zod';
import type { AIProvider } from '../ai/AIProvider';

const speechRequestSchema = z.object({
  text: z.string().min(1).max(500),
});

export function createSpeechRouter(ai: AIProvider): Router {
  const router = Router();

  router.post('/api/speech', (req, res) => {
    void (async () => {
      const parsed = speechRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: 'INVALID_REQUEST',
          message: 'The request body must contain "text" (1-500 characters).',
        });
        return;
      }

      try {
        const audio = await ai.speak(parsed.data.text);
        res.setHeader('Content-Type', 'audio/mpeg');
        res.send(audio);
      } catch (error) {
        console.error(
          JSON.stringify({
            event: 'ai_provider_failure',
            operation: 'speak',
            error: error instanceof Error ? error.message : String(error),
          }),
        );
        res.status(502).json({
          error: 'AI_PROVIDER_ERROR',
          message: 'Speech generation is temporarily unavailable.',
        });
      }
    })();
  });

  return router;
}
