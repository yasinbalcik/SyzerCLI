'use strict';

// Sağlayıcı tanımları. Hepsi OpenAI uyumlu /chat/completions konuşur; farklar burada toplanır.
const PROVIDERS = {
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    base: 'https://openrouter.ai/api/v1',
    keySource: '(?<![A-Za-z0-9_-])sk-or-v1-[a-f0-9]{64}(?![A-Za-z0-9_-])',
    keyExact: /^sk-or-v1-[a-f0-9]{64}$/,
    keyPrefix: /^sk-/i,
    keyHint: 'sk-or-v1- + 64 hex',
    defaultModel: 'nvidia/nemotron-3-ultra-550b-a55b:free',
    defaultFallback: 'auto',
    hasUsageApi: true, // GET /key günlük free istek ve kredi bilgisini verir
    headers: () => ({ 'X-Title': 'SyzerCLI' }),
    // effort → istek gövdesine eklenecek alanlar
    reasoning: (effort) => (effort === 'off' ? { reasoning: { effort: 'none' } } : { reasoning: { effort } }),
  },
  nvidia: {
    id: 'nvidia',
    name: 'NVIDIA',
    base: 'https://integrate.api.nvidia.com/v1',
    keySource: '(?<![A-Za-z0-9_-])nvapi-[A-Za-z0-9_-]{64}(?![A-Za-z0-9_-])',
    keyExact: /^nvapi-[A-Za-z0-9_-]{64}$/,
    keyPrefix: /^nvapi-/i,
    keyHint: 'nvapi- + 64 karakter',
    defaultModel: 'nvidia/nemotron-3-ultra-550b-a55b',
    defaultFallback: ['nvidia/nemotron-3-super-120b-a12b'],
    hasUsageApi: false, // kalan kota sorgulanamaz; yaklaşık 40 istek/dk sınırı vardır
    rpm: 40,
    validateModel: 'nvidia/nemotron-3-super-120b-a12b',
    headers: () => ({}),
    reasoning: (effort) => (effort === 'off' ? { chat_template_kwargs: { enable_thinking: false } } : { reasoning_effort: effort }),
  },
};

let currentId = 'openrouter';

const current = () => PROVIDERS[currentId];
const setCurrent = (id) => { if (PROVIDERS[id]) currentId = id; };
const list = () => Object.values(PROVIDERS);

// Bir token hangi sağlayıcıya ait? (null = hiçbiri)
function detect(token) {
  return list().find((p) => p.keyExact.test(token) || p.keyPrefix.test(token)) || null;
}

const keyRegex = (p) => new RegExp(p.keySource, 'g');

module.exports = { PROVIDERS, current, setCurrent, list, detect, keyRegex };
