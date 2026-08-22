import { Router } from 'express';
import { z } from 'zod';
import type { ConversationService } from '../conversation/ConversationService';

const chatRequestSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().min(1).max(4000),
      }),
    )
    .min(1)
    .max(60),
});

export function createChatRouter(conversationService: ConversationService): Router {
  const router = Router();

  router.post('/api/chat', (req, res) => {
    void (async () => {
      const parsed = chatRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: 'INVALID_REQUEST',
          message: 'The request body must contain 1-60 chat messages.',
        });
        return;
      }

      const requestId = Math.random().toString(36).slice(2, 10);
      console.info(
        JSON.stringify({
          event: 'chat_request',
          requestId,
          messageCount: parsed.data.messages.length,
        }),
      );

      try {
        const reply = await conversationService.handleChat(parsed.data.messages);
        res.json({ message: { role: 'assistant', content: reply } });
      } catch (error) {
        console.error(
          JSON.stringify({
            event: 'ai_provider_failure',
            requestId,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
        res.status(502).json({
          error: 'AI_PROVIDER_ERROR',
          message: 'The assistant is temporarily unavailable. Please try again.',
        });
      }
    })();
  });

  return router;
}
