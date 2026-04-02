const PROVIDER_QUICK_ACCESS = {
  anthropic: {
    keyUrl: 'https://console.anthropic.com/settings/keys',
  },
  openai: {
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  gemini: {
    keyUrl: 'https://aistudio.google.com/app/apikey',
  },
  xai: {
    keyUrl: 'https://console.x.ai/',
  },
  groq: {
    keyUrl: 'https://console.groq.com/keys/',
  },
  mistral: {
    keyUrl: 'https://console.mistral.ai/api-keys/',
  },
  together: {
    keyUrl: 'https://api.together.ai/settings/api-keys',
  },
  deepseek: {
    keyUrl: 'https://platform.deepseek.com/api_keys',
  },
  openrouter: {
    keyUrl: 'https://openrouter.ai/docs/api-keys',
  },
  perplexity: {
    keyUrl: 'https://docs.perplexity.ai/docs/getting-started/quickstart',
  },
}

export function getProviderQuickAccess(provider) {
  if (!provider?.id) return null

  const matched = PROVIDER_QUICK_ACCESS[provider.id] || {}

  return {
    keyUrl: matched.keyUrl || null,
    docsUrl: provider.docsUrl || null,
  }
}
