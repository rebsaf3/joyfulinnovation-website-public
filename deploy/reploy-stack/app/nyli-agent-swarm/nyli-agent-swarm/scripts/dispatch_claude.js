const http = require('http');
const body = JSON.stringify({agent:'ClaudeAgent',task:'Please update the root .env file: set ANTHROPIC_API_KEY to a valid key (or OPENAI_API_KEY), then restart the mesh so agents can authenticate.'});
const req = http.request({hostname:'127.0.0.1',port:3099,path:'/dispatch',method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}},res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>console.log('response',res.statusCode,d));});
req.on('error',e=>console.error('error',e));
req.write(body);
req.end();
