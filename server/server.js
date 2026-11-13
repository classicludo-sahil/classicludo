const http=require('http');
const crypto=require('crypto');
const {WebSocketServer}=require('ws');
const server=http.createServer((q,r)=>r.end('ok'));
const wss=new WebSocketServer({server});
const SEATS={2:[3,1],3:[3,0,1],4:[3,0,1,2]};
const SAFE=new Set([0,8,13,21,26,34,39,47]);
const rooms=new Map();
const rnd=()=>crypto.randomInt(1,7);
const send=(ws,o)=>{if(ws.readyState===1)ws.send(JSON.stringify(o))};
const abs=(c,p)=>(c*13+p-1)%52;
function newCode(){
  const a='ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s;
  do{s='';for(let i=0;i<6;i++)s+=a[crypto.randomInt(a.length)]}while(rooms.has(s));
  return s;
}
function roomInfo(r){
  const pl=r.players.map(q=>({color:q.color,agreed:q.agreed}));
  r.players.forEach(p=>send(p.ws,{t:'room',code:r.code,mode:r.mode,started:r.started,you:p.color,players:pl}));
}
function legal(r,d){
  const tk=r.tokens[r.players[r.ti].color],out=[];
  tk.forEach((p,i)=>{if(p===0?d===6:p+d<=57)out.push(i)});
  return out;
}
function state(r,note){
  const o={t:'state',turn:r.players[r.ti].color,phase:r.phase,dice:r.dice,tokens:r.tokens,
    legal:r.phase==='move'?legal(r,r.dice):[],winner:r.winner,note:note||''};
  r.players.forEach(p=>send(p.ws,o));
}
function start(r){
  r.started=true;r.ti=0;r.phase='roll';r.dice=0;r.sixes=0;r.winner=null;
  r.tokens={};r.st={};
  r.players.forEach(p=>{r.tokens[p.color]=[0,0,0,0];r.st[p.color]={out:false,fails:0}});
  roomInfo(r);
  state(r);
}
function next(r){
  r.ti=(r.ti+1)%r.players.length;
  r.phase='roll';r.sixes=0;r.dice=0;
  state(r);
}
function later(r){
  setTimeout(()=>{if(rooms.get(r.code)===r&&r.winner===null)next(r)},1400);
}
function roll(r,p){
  if(!r.started||r.winner!==null||r.phase!=='roll'||r.players[r.ti]!==p)return;
  const st=r.st[p.color];
  let d=rnd();
  if(!st.out){
    if(st.fails>=4)d=6;
    if(d===6)st.fails=0;else st.fails++;
  }
  r.dice=d;
  r.sixes=d===6?r.sixes+1:0;
  if(r.sixes>=3){r.phase='wait';state(r,'three6');later(r);return}
  if(!legal(r,d).length){r.phase='wait';state(r,'nomove');later(r);return}
  r.phase='move';
  state(r);
}
function move(r,p,i){
  if(!r.started||r.winner!==null||r.phase!=='move'||r.players[r.ti]!==p)return;
  const d=r.dice,c=p.color;
  if(!legal(r,d).includes(i))return;
  const tk=r.tokens[c];
  let cap=false;
  if(tk[i]===0){tk[i]=1;r.st[c].out=true}else tk[i]+=d;
  const np=tk[i];
  if(np>=1&&np<=51&&!SAFE.has(abs(c,np))){
    r.players.forEach(q=>{
      if(q===p)return;
      r.tokens[q.color].forEach((p2,j)=>{
        if(p2>=1&&p2<=51&&abs(q.color,p2)===abs(c,np)){r.tokens[q.color][j]=0;cap=true}
      });
    });
  }
  if(tk.every(x=>x===57)){r.winner=c;r.phase='end';state(r,'win');return}
  if(d===6||cap||np===57){r.phase='roll';r.dice=0;state(r,cap?'capture':'bonus')}
  else next(r);
}
function find(ws,mode){
  if(!SEATS[mode]||ws.room)return;
  let r=[...rooms.values()].find(x=>!x.started&&x.mode===mode&&x.players.length<mode);
  if(!r){
    r={code:newCode(),mode,players:[],started:false,tokens:{},st:{},ti:0,phase:'roll',dice:0,sixes:0,winner:null};
    rooms.set(r.code,r);
  }
  const p={ws,color:SEATS[mode][r.players.length],agreed:false};
  r.players.push(p);
  ws.room=r;ws.pl=p;
  roomInfo(r);
}
function leave(ws){
  const r=ws.room;
  ws.room=null;ws.pl=null;
  if(!r)return;
  r.players=r.players.filter(q=>q.ws!==ws);
  if(r.started&&r.winner===null){
    r.players.forEach(q=>{send(q.ws,{t:'end',why:'left'});q.ws.room=null;q.ws.pl=null});
    rooms.delete(r.code);
  }else if(!r.started){
    r.players.forEach((q,i)=>{q.color=SEATS[r.mode][i];q.agreed=false});
    if(r.players.length)roomInfo(r);else rooms.delete(r.code);
  }else if(!r.players.length)rooms.delete(r.code);
}
wss.on('connection',ws=>{
  ws.alive=true;
  ws.on('pong',()=>{ws.alive=true});
  ws.on('message',d=>{
    let m;try{m=JSON.parse(d.toString())}catch{return}
    if(m.t==='find')return find(ws,+m.mode);
    if(m.t==='leave')return leave(ws);
    const r=ws.room,p=ws.pl;
    if(!r||!p)return;
    if(m.t==='agree'){
      if(!r.started&&r.players.length===r.mode){
        p.agreed=true;roomInfo(r);
        if(r.players.every(q=>q.agreed))start(r);
      }
    }else if(m.t==='roll')roll(r,p);
    else if(m.t==='move')move(r,p,+m.tok);
  });
  ws.on('close',()=>leave(ws));
  ws.on('error',()=>{});
});
setInterval(()=>{
  wss.clients.forEach(c=>{
    if(!c.alive)return c.terminate();
    c.alive=false;c.ping();
  });
},30000);
server.listen(process.env.PORT||3000);
  
