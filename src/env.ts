import { z } from "zod";
import dotenv from "dotenv";
dotenv.config();

const envSchema = z.object({
    PROVIDER_URL: z.string(),
    WS_URL: z.string(),
    NODE_ENV: z.string(),
    DB_NAME: z.string(),
    DB_HOST: z.string().optional(),
    DB_PORT: z.coerce.number().optional(),
    DB_USER: z.string().optional(),
    DB_PASSWORD: z.string().optional(),
    DB_SCHEMA: z.string(),
    BLOCK_START_NUMBER: z.string(),
    REDIS_CONNECTION_STRING: z.string(),
    REDIS_USE_TLS: z.preprocess((str) => str === "true", z.boolean()),
    TARGET_CONTRACT_ADDRESS: z.string(),
    TARGET_CONTRACT_EVENT_NAME: z.string(),
    REST_PORT: z.coerce.number(),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
    const formattedErrors = parsedEnv.error.errors.map((err) => ({
        path: err.path.join("."),
        message: err.message,
    }));

    console.error("Environment variable validation failed:", formattedErrors);
    throw new Error("Invalid environment variables.");
}

export type IndexerEnv = z.infer<typeof envSchema>;

export const env = parsedEnv.data as IndexerEnv;
