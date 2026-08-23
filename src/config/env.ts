import { z } from 'zod';

const positiveInteger = z.coerce.number().int().positive();

const environmentSchema = z.object({
  DATABASE_URL: z.string().url().superRefine((value, context) => {
    let username = '';
    try {
      username = decodeURIComponent(new URL(value).username).split('.')[0] ?? '';
    } catch {
      return;
    }
    if (username.toLowerCase() === 'postgres' || username.toLowerCase() === 'supabase_admin') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'DATABASE_URL must use a dedicated least-privileged runtime login.'
      });
    }
  }),
  PORT: positiveInteger.max(65_535).default(3000),
  RESERVATION_TTL_MINUTES: positiveInteger.max(43_200).default(15)
});

export type Environment = z.infer<typeof environmentSchema>;

let cachedEnvironment: Environment | undefined;

export function getEnvironment(source: NodeJS.ProcessEnv = process.env): Environment {
  if (source === process.env && cachedEnvironment) return cachedEnvironment;
  const parsed = environmentSchema.safeParse(source);
  if (!parsed.success) {
    const messages = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Invalid environment configuration: ${messages.join('; ')}`);
  }
  if (source === process.env) cachedEnvironment = parsed.data;
  return parsed.data;
}

export function resetEnvironmentForTests(): void {
  cachedEnvironment = undefined;
}
