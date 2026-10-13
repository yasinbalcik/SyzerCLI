'use strict';

// /cost: oturum kullanım özeti (salt-okunur, ağ yok)
const commands = {
  cost: {
    desc: 'Show token usage, turns, keys, budget and verification retries for this session',
    run(arg, ctx) {
      try { return require('../cost').report(ctx && ctx.session); } catch { return 'No information available.'; }
    },
  },
};

module.exports = { commands };
