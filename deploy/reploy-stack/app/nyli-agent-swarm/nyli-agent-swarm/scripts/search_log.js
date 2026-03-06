const fs = require('fs');
const path = require('path');
const terms = ['orchestrator_chosen_agent_from_project','supervisor_project_check','supervisor_dispatch_failed'];
const logPath = path.resolve(__dirname,'..','logs','agent_activity.log');
let count =0;
fs.createReadStream(logPath,{encoding:'utf8'})
  .on('data',chunk=>{
    terms.forEach(t=>{
      if(chunk.includes(t)){
        console.log('FOUND',t);
      }
    });
  })
  .on('end',()=>console.log('done reading'))
  .on('error',e=>console.error('read error',e));
