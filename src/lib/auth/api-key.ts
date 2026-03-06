import { appConfig } from "@/lib/config";

export function validateApiKey(headerValue: string | null): {
  ok: boolean;
  reason?: string;
} {
  const { acceptedApiKeys, allowWithoutKey } = appConfig.security;

  if (acceptedApiKeys.length === 0) {
    return allowWithoutKey ? { ok: true } : { ok: false, reason: "API key system is enabled but no keys configured" };
  }

  if (!headerValue) {
    return { ok: false, reason: "Missing x-api-key" };
  }

  if (!acceptedApiKeys.includes(headerValue)) {
    return { ok: false, reason: "Invalid API key" };
  }

  return { ok: true };
}
