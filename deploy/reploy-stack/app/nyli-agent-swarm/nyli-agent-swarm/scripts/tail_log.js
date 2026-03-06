import fs from 'fs';
import readline from 'readline';

const inPath = new URL('../logs/agent_activity.log', import.meta.url).pathname;
const outPath = new URL('../logs/agent_activity_tail.txt', import.meta.url).pathname;

async function tail(lines=200) {
  if (!fs.existsSync(inPath)) return;
  const rl = readline.createInterface({ input: fs.createReadStream(inPath, {encoding:'utf8'}) });
  const buf = [];
  for await (const line of rl) {
    buf.push(line);
    if (buf.length > lines) buf.shift();
  }
  fs.writeFileSync(outPath, buf.join('\n'));
  console.log('wrote', outPath);
}

tail(300).catch(e=>console.error('error',e));
