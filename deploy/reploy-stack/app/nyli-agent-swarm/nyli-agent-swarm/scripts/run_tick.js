const sup = require('../server/src/agent/supervisor.js');
if (sup && typeof sup.supervisorTick === 'function') {
  sup.supervisorTick().then(() => console.log('tick done')).catch((e) => console.error('tick error', e));
} else console.error('no supervisorTick');
