import('./server/src/agent/supervisor.js').then(sup=>{
  if(sup && typeof sup.supervisorTick === 'function'){
    sup.supervisorTick()
      .then(()=>console.log('tick complete'))
      .catch(e=>console.error('tick failed',e));
  } else {
    console.error('supervisorTick not available');
  }
}).catch(e=>console.error('load failed',e));
