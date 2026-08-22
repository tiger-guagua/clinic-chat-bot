import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import type { AIProvider } from '../ai/AIProvider';

// OpenAI's own transcription upload limit.
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_AUDIO_BYTES },
});

function isSupportedAudioType(mimeType: string): boolean {
  // Some browsers label MediaRecorder output video/webm even for audio-only tracks.
  return mimeType.startsWith('audio/') || mimeType === 'video/webm';
}

export function createTranscribeRouter(ai: AIProvider): Router {
  const router = Router();

  router.post('/api/transcribe', upload.single('audio'), (req, res) => {
    void (async () => {
      const file = req.file;
      if (!file || file.size === 0) {
        res.status(400).json({
          error: 'INVALID_REQUEST',
          message: 'A multipart field named "audio" containing an audio file is required.',
        });
        return;
      }
      if (!isSupportedAudioType(file.mimetype)) {
        res.status(400).json({
          error: 'INVALID_AUDIO_TYPE',
          message: `Unsupported content type "${file.mimetype}". Send an audio file.`,
        });
        return;
      }

      try {
        const text = await ai.transcribe({
          data: file.buffer,
          mimeType: file.mimetype,
          filename: file.originalname || 'audio.webm',
        });
        console.info(
          JSON.stringify({
            event: 'transcription',
            bytes: file.size,
            mimeType: file.mimetype,
            textLength: text.length,
          }),
        );
        res.json({ text });
      } catch (error) {
        console.error(
          JSON.stringify({
            event: 'ai_provider_failure',
            operation: 'transcribe',
            error: error instanceof Error ? error.message : String(error),
          }),
        );
        res.status(502).json({
          error: 'AI_PROVIDER_ERROR',
          message: 'Transcription is temporarily unavailable. Please type your message.',
        });
      }
    })();
  });

  router.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      res.status(400).json({
        error: 'AUDIO_TOO_LARGE',
        message: 'The audio recording exceeds the 25 MB limit.',
      });
      return;
    }
    next(error);
  });

  return router;
}
