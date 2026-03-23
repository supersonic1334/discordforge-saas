'use strict';

const AI_PROVIDER_CATALOG = [
  {
    id: 'anthropic',
    label: 'Anthropic Claude',
    description: 'Claude models via the Anthropic Messages API.',
    defaultModel: 'claude-sonnet-4-6',
    apiStyle: 'anthropic',
    keyPlaceholder: 'sk-ant-...',
    docsUrl: 'https://docs.anthropic.com/en/docs/about-claude/models/all-models',
    models: [
      {
        id: 'claude-sonnet-4-6',
        label: 'Claude Sonnet 4.6',
        description: 'Recommended balance of quality and speed.',
      },
      {
        id: 'claude-haiku-4-5',
        label: 'Claude Haiku 4.5',
        description: 'Fastest Claude model.',
      },
      {
        id: 'claude-opus-4-6',
        label: 'Claude Opus 4.6',
        description: 'Most capable Claude model.',
      },
    ],
  },
  {
    id: 'openai',
    label: 'OpenAI GPT',
    description: 'Latest GPT models for Chat Completions / Responses.',
    defaultModel: 'gpt-5.4',
    apiStyle: 'openai',
    baseUrl: 'https://api.openai.com/v1/chat/completions',
    keyPlaceholder: 'sk-...',
    docsUrl: 'https://developers.openai.com/api/docs/models',
    models: [
      {
        id: 'gpt-5.4',
        label: 'GPT-5.4',
        description: 'Best overall reasoning and coding model.',
      },
      {
        id: 'gpt-5.4-mini',
        label: 'GPT-5.4 mini',
        description: 'Lower latency and lower cost.',
      },
      {
        id: 'gpt-5.4-nano',
        label: 'GPT-5.4 nano',
        description: 'Cheapest GPT-5.4 class model.',
      },
    ],
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    description: 'Gemini text/chat models available in Google AI Studio.',
    defaultModel: 'gemini-2.5-flash',
    apiStyle: 'gemini',
    keyPlaceholder: 'AIza...',
    docsUrl: 'https://ai.google.dev/gemini-api/docs/pricing',
    models: [
      {
        id: 'gemini-2.5-pro',
        label: 'Gemini 2.5 Pro',
        description: 'Top quality for reasoning and coding.',
        tokenLimits: { input: 1048576, output: 65536 },
        rateLimits: { free: { rpm: 5, tpm: 250000, rpd: 100 } },
        freeTier: true,
      },
      {
        id: 'gemini-2.5-flash',
        label: 'Gemini 2.5 Flash',
        description: 'Best default for fast chat and actions.',
        tokenLimits: { input: 1048576, output: 65536 },
        rateLimits: { free: { rpm: 10, tpm: 250000, rpd: 250 } },
        freeTier: true,
      },
      {
        id: 'gemini-2.5-flash-lite',
        label: 'Gemini 2.5 Flash-Lite',
        description: 'Lowest cost stable Gemini chat model.',
        tokenLimits: { input: 1048576, output: 65536 },
        rateLimits: { free: { rpm: 15, tpm: 250000, rpd: 1000 } },
        freeTier: true,
      },
      {
        id: 'gemini-2.5-flash-lite-preview-09-2025',
        label: 'Gemini 2.5 Flash-Lite Preview',
        description: 'Preview variant with free tier support.',
        tokenLimits: { input: 1048576, output: 65536 },
        rateLimits: { free: { rpm: 15, tpm: 250000, rpd: 1000 } },
        freeTier: true,
        preview: true,
      },
    ],
  },
  {
    id: 'xai',
    label: 'xAI Grok',
    description: 'Grok models via the xAI chat completions API.',
    defaultModel: 'grok-3-fast',
    apiStyle: 'openai',
    baseUrl: 'https://api.x.ai/v1/chat/completions',
    keyPlaceholder: 'API key',
    docsUrl: 'https://docs.x.ai/developers/model-capabilities/legacy/chat-completions',
    models: [
      {
        id: 'grok-3-fast',
        label: 'Grok 3 Fast',
        description: 'Fast general-purpose Grok model.',
      },
      {
        id: 'grok-4.20-reasoning',
        label: 'Grok 4.20 Reasoning',
        description: 'Reasoning-oriented Grok model.',
      },
    ],
  },
  {
    id: 'groq',
    label: 'Groq',
    description: 'OpenAI-compatible chat API for ultra-fast open models.',
    defaultModel: 'llama-3.3-70b-versatile',
    apiStyle: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1/chat/completions',
    keyPlaceholder: 'API key',
    docsUrl: 'https://console.groq.com/docs/api-reference',
    models: [
      {
        id: 'llama-3.3-70b-versatile',
        label: 'Llama 3.3 70B Versatile',
        description: 'Balanced default Groq chat model.',
      },
      {
        id: 'meta-llama/llama-4-scout-17b-16e-instruct',
        label: 'Llama 4 Scout',
        description: 'Large-context multimodal Llama 4 variant.',
      },
      {
        id: 'meta-llama/llama-4-maverick-17b-128e-instruct',
        label: 'Llama 4 Maverick',
        description: 'Higher-end Llama 4 model on Groq.',
      },
    ],
  },
  {
    id: 'mistral',
    label: 'Mistral AI',
    description: 'Mistral chat completions API.',
    defaultModel: 'mistral-large-2512',
    apiStyle: 'openai',
    baseUrl: 'https://api.mistral.ai/v1/chat/completions',
    keyPlaceholder: 'API key',
    docsUrl: 'https://docs.mistral.ai/models/mistral-large-3-25-12',
    models: [
      {
        id: 'mistral-large-2512',
        label: 'Mistral Large 3',
        description: 'Frontier Mistral large model.',
      },
      {
        id: 'mistral-medium-2508',
        label: 'Mistral Medium 3.1',
        description: 'Balanced Mistral model.',
      },
      {
        id: 'ministral-14b-2512',
        label: 'Ministral 3 14B',
        description: 'Smaller, lower-cost Mistral option.',
      },
    ],
  },
  {
    id: 'together',
    label: 'Together AI',
    description: 'OpenAI-compatible gateway for many open-source models.',
    defaultModel: 'openai/gpt-oss-20b',
    apiStyle: 'openai',
    baseUrl: 'https://api.together.xyz/v1/chat/completions',
    keyPlaceholder: 'API key',
    docsUrl: 'https://docs.together.ai/docs/openai-api-compatibility',
    models: [
      {
        id: 'openai/gpt-oss-20b',
        label: 'GPT-OSS 20B',
        description: 'Open-weight OpenAI model via Together.',
      },
      {
        id: 'deepseek-ai/DeepSeek-V3.1',
        label: 'DeepSeek V3.1',
        description: 'Strong general-purpose open model.',
      },
      {
        id: 'meta-llama/Llama-4-Scout-17B-16E-Instruct',
        label: 'Llama 4 Scout',
        description: 'Large-context Llama via Together.',
      },
    ],
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    description: 'DeepSeek API compatible with the OpenAI format.',
    defaultModel: 'deepseek-chat',
    apiStyle: 'openai',
    baseUrl: 'https://api.deepseek.com/chat/completions',
    keyPlaceholder: 'API key',
    docsUrl: 'https://api-docs.deepseek.com/',
    models: [
      {
        id: 'deepseek-chat',
        label: 'DeepSeek Chat',
        description: 'Default non-thinking DeepSeek model.',
      },
      {
        id: 'deepseek-reasoner',
        label: 'DeepSeek Reasoner',
        description: 'Thinking / reasoning DeepSeek model.',
      },
    ],
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    description: 'One OpenAI-compatible API for many providers and models.',
    defaultModel: 'openai/gpt-5.1-chat',
    apiStyle: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1/chat/completions',
    keyPlaceholder: 'API key',
    docsUrl: 'https://openrouter.ai/docs/api-reference/chat-completion',
    models: [
      {
        id: 'openai/gpt-5.1-chat',
        label: 'OpenAI GPT-5.1 Chat',
        description: 'Sample OpenRouter model id.',
      },
      {
        id: 'google/gemini-2.5-pro',
        label: 'Google Gemini 2.5 Pro',
        description: 'Sample cross-provider Gemini route.',
      },
      {
        id: 'deepseek/deepseek-chat',
        label: 'DeepSeek Chat',
        description: 'Sample OpenRouter DeepSeek route.',
      },
    ],
  },
  {
    id: 'perplexity',
    label: 'Perplexity Sonar',
    description: 'OpenAI-compatible Sonar API for web-grounded answers.',
    defaultModel: 'sonar-pro',
    apiStyle: 'openai',
    baseUrl: 'https://api.perplexity.ai/chat/completions',
    keyPlaceholder: 'API key',
    docsUrl: 'https://docs.perplexity.ai/docs/sonar/openai-compatibility',
    models: [
      {
        id: 'sonar',
        label: 'Sonar',
        description: 'Fast default Perplexity model.',
      },
      {
        id: 'sonar-pro',
        label: 'Sonar Pro',
        description: 'Higher-quality grounded model.',
      },
      {
        id: 'sonar-reasoning-pro',
        label: 'Sonar Reasoning Pro',
        description: 'Reasoning-focused grounded model.',
      },
    ],
  },
];

function getAICatalog() {
  return AI_PROVIDER_CATALOG.map((provider) => ({
    ...provider,
    models: provider.models.map((model) => ({ ...model })),
  }));
}

function getProviderCatalog(providerId) {
  return AI_PROVIDER_CATALOG.find((provider) => provider.id === providerId) ?? null;
}

function getDefaultModel(providerId) {
  return getProviderCatalog(providerId)?.defaultModel ?? '';
}

function isLegacyGeminiModel(modelId) {
  return /^gemini-2\.0-/i.test(String(modelId || ''));
}

function resolveConfiguredModel(providerId, modelId) {
  if (!modelId) return getDefaultModel(providerId);
  if (providerId === 'gemini' && isLegacyGeminiModel(modelId)) {
    return getDefaultModel(providerId);
  }
  return modelId;
}

module.exports = {
  AI_PROVIDER_CATALOG,
  getAICatalog,
  getProviderCatalog,
  getDefaultModel,
  isLegacyGeminiModel,
  resolveConfiguredModel,
};
