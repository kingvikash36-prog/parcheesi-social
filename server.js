const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const game = require('./game-core.cjs');

const root = path.join(__dirname, 'public');
const rooms = new Map();
const peers = new Map();
const mime = { '.html':'text/html; charset=utf-8', '.css':'text/css', '.js':'text/javascript' };
const server = http.createServer((req,res) => {
  const url = new URL(req.url, 'http://localhost');
  const file = path.join(root, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname));
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err,data) => { if(err){res.writeHead(404).end('Not found');return;} res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'}).end(data); });
});
function frame(obj) {
  const b=Buffer.from(JSON.stringify(obj)); let h;
  if(b.length<126) h=Buffer.from([0x81,b.length]);
  else if(b.length<65536){h=Buffer.alloc(4);h[0]=0x81;h[1]=126;h.writeUInt16BE(b.length,2);}
  else {h=Buffer.alloc(10);h[0]=0x81;h[1]=127;h.writeBigUInt64BE(BigInt(b.length),2);}
  return Buffer.concat([h,b]);
}
function send(peer,obj){if(!peer.dead)peer.socket.write(frame(obj));}
function broadcast(room){const state=game.snapshot(room);for(const p of room.players){const peer=peers.get(p.id);if(peer)send(peer,state);}}
function receive(peer,msg){
  if(msg.type==='join'){
    let code=(msg.code||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6);
    if(msg.create){do{code=crypto.randomBytes(3).toString('hex').toUpperCase();}while(rooms.has(code));}
    let room=rooms.get(code);if(!room&&msg.create){room=game.newRoom(code);rooms.set(code,room);}
    if(!room){send(peer,{type:'error',message:'Room not found. Check the code and try again.'});return;}
    const joined=game.join(room,msg);if(joined.error){send(peer,{type:'error',message:joined.error});return;}
    peer.room=room;peer.playerId=joined.id;peers.set(joined.id,peer);send(peer,{type:'joined',id:joined.id,code});broadcast(room);return;
  }
  const room=peer.room;if(!room||!peer.playerId)return;
  const result=game.apply(room,peer.playerId,msg);if(result.error){send(peer,{type:'error',message:result.error});return;}broadcast(room);
}
server.on('upgrade',(req,socket)=>{
  const key=req.headers['sec-websocket-key'];if(!key){socket.destroy();return;}
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+crypto.createHash('sha1').update(key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64')+'\r\n\r\n');
  const peer={socket,dead:false,buffer:Buffer.alloc(0)};
  socket.on('data',chunk=>{peer.buffer=Buffer.concat([peer.buffer,chunk]);while(peer.buffer.length>=2){let len=peer.buffer[1]&127,off=2;if(len===126){if(peer.buffer.length<4)return;len=peer.buffer.readUInt16BE(2);off=4;}else if(len===127){if(peer.buffer.length<10)return;len=Number(peer.buffer.readBigUInt64BE(2));off=10;}const masked=peer.buffer[1]&128;if(masked)off+=4;if(peer.buffer.length<off+len)return;let data=peer.buffer.subarray(off,off+len);if(masked){const mask=peer.buffer.subarray(off-4,off);data=Buffer.from(data);for(let i=0;i<len;i++)data[i]^=mask[i%4];}peer.buffer=peer.buffer.subarray(off+len);try{receive(peer,JSON.parse(data.toString()));}catch{}}});
  socket.on('close',()=>{peer.dead=true;const r=peer.room;if(r){peers.delete(peer.playerId);const oldTurn=r.turn;r.players=r.players.filter(p=>p.id!==peer.playerId);if(!r.players.length)rooms.delete(r.code);else{if(oldTurn>=r.players.length)r.turn=0;broadcast(r);}}});socket.on('error',()=>{peer.dead=true;});
});
const port=Number(process.env.PORT)||3000;
server.listen(port,'0.0.0.0',()=>console.log(`Ludo party is ready at http://localhost:${port}`));
