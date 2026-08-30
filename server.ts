import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type, Schema } from "@google/genai";

// Initialize Gemini
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;

  app.use(express.json());

  // API Route: Analyze Sentence
  app.post("/api/analyze", async (req, res) => {
    try {
      const { sentence } = req.body;
      if (!sentence) {
        return res.status(400).json({ error: "Sentence is required" });
      }

      const responseSchema: Schema = {
        type: Type.OBJECT,
        properties: {
          sentenceTranslation: {
            type: Type.STRING,
            description: "Vietnamese translation of the entire sentence based on context.",
          },
          words: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                originalWord: { type: Type.STRING },
                baseWord: {
                  type: Type.STRING,
                  description: "The base form (nguyên thể) of the word. E.g., 'catches' -> 'catch', 'cats' -> 'cat', 'went' -> 'go', 'better' -> 'good'. If already base, keep it.",
                },
                partOfSpeech: {
                  type: Type.STRING,
                  description: "Part of speech in this context (e.g., Noun, Verb, Adjective, Adverb, Idiom).",
                },
                contextualMeaning: {
                  type: Type.STRING,
                  description: "Meaning of the word IN THIS SPECIFIC CONTEXT (in Vietnamese). Must specify the form transformation if any, e.g., 'Trong ngữ cảnh này: (từ nguyên thể: catch) bắt lấy, nắm lấy'.",
                },
              },
              required: ["originalWord", "baseWord", "partOfSpeech", "contextualMeaning"],
            },
          },
          grammarUsage: {
            type: Type.STRING,
            description: "Explanation of grammar, structure, or idiom usage for this sentence (in Vietnamese).",
          },
          examples: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "2 extra example sentences using the main phrase or grammar structure.",
          },
          tags: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "3-5 relevant tags/categories for this sentence (e.g., Idiom, Business, Daily Life, Phrasal Verb).",
          },
        },
        required: ["sentenceTranslation", "words", "grammarUsage", "examples", "tags"],
      };

      const prompt = `Analyze this English sentence for a Vietnamese learner:\n\n"${sentence}"\n\nProvide the translation, word breakdown (converting conjugated/plural forms back to base forms), grammar usage, 2 examples, and relevant tags.`;

      let response;
      let retries = 5;
      let delay = 2000; // start with 2 second delay
      
      while (retries > 0) {
        try {
          response = await ai.models.generateContent({
            model: "gemini-3.1-flash-lite",
            contents: prompt,
            config: {
              responseMimeType: "application/json",
              responseSchema: responseSchema,
              temperature: 0.2,
            },
          });
          break; // success
        } catch (error: any) {
          retries--;
          if (retries === 0) throw error;
          
          // Check if it's a 503 or 429
          const status = error?.status || error?.response?.status;
          if (status === 503 || status === 429 || error?.message?.includes('503') || error?.message?.includes('429')) {
            console.log(`Gemini API overloaded. Retrying in ${delay}ms... (${retries} retries left)`);
            await new Promise(resolve => setTimeout(resolve, delay));
            delay *= 1.5; // exponential backoff
          } else {
            throw error; // other errors, don't retry
          }
        }
      }

      const analysisText = response.text;
      if (!analysisText) {
        throw new Error("No response from Gemini");
      }
      
      const analysis = JSON.parse(analysisText);
      res.json(analysis);
    } catch (error) {
      console.error("Analysis error:", error);
      res.status(500).json({ error: "Failed to analyze sentence" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
