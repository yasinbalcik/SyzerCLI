'use strict';

function quotaGuide(error, locale, options = {}) {
  const status = Number(error && (error.status ?? error.statusCode));
  const exhausted = !!options.allKeysExhausted;
  if (!exhausted && ![402, 403, 429].includes(status)) return null;

  const tr = locale === 'tr';
  const other = options.provider === 'nvidia' ? 'openrouter' : 'nvidia';
  const actions = ['syzer key add', 'syzer usage', `syzer provider ${other}`];
  if (exhausted) return {
    code: 'KEYS_EXHAUSTED',
    message: tr
      ? 'Kullanılabilir anahtar kalmadı. Yeni anahtar ekleyin, kullanım durumunu kontrol edin veya başka bir sağlayıcıya geçin.'
      : 'No usable keys remain. Add a key, check usage, or switch provider.',
    actions,
  };

  const reason = {
    402: tr ? 'Kredi veya ödeme limiti tükendi.' : 'Available credit or payment limit is exhausted.',
    403: tr ? 'Anahtarın bu sağlayıcıya veya modele erişimi yok.' : 'This key does not have access to this provider or model.',
    429: tr ? 'İstek veya kota limiti aşıldı.' : 'A request or quota limit was reached.',
  }[status];
  return {
    code: `HTTP_${status}`,
    message: tr
      ? `${reason} Yeni anahtar ekleyin, kullanım durumunu kontrol edin veya başka bir sağlayıcıya geçin.`
      : `${reason} Add a key, check usage, or switch provider.`,
    actions,
  };
}

module.exports = { quotaGuide };
