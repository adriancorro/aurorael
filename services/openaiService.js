import OpenAI from "openai";
import {
  MODEL_PRIMARY,
  MODEL_FALLBACK,
  OPENAI_KEY,
} from "../config/constants.js";

const client = new OpenAI({ apiKey: OPENAI_KEY });

export async function runModel(messages) {
  try {
    return await client.responses.create({
      model: MODEL_PRIMARY,
      input: messages,
      max_output_tokens: 350,
      temperature: 0.8,
    });
  } catch (err) {
    console.warn("PRIMARY MODEL FAILED → FALLBACK", err.message);
    return await client.responses.create({
      model: MODEL_FALLBACK,
      input: messages,
      max_output_tokens: 350,
      temperature: 0.8,
    });
  }
}
