import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { randomBytes, randomInt } from 'node:crypto';
import { pairs } from './words.js';

const app = express();
const rooms = new Map();
app.use(express.static('public'));
app.get('/health', (_, res) => res.json({ ok: true, rooms: rooms.size }));
const http = createServer(app);
const io = new Server(http);
const uid = () => randomBytes(16).toString('hex');
const shuffle = a => { a = [...a]; for (let i=a.length-1;i>0;i--) { const j=randomInt(i+1); [a[i],a[j]]=[a[j],a[i]]; } return a; };
const codeGen = () => { let c; do { c = randomBytes(3).toString('hex').toUpperCase(); } while (rooms.has(c)); return c; };
const sanitize = s => String(s || '').trim().replace(/[<>]/g,'').slice(0,22);
const alive = r => r.players.filter(p => !p.out);
const playerBy = (r,id) => r.players.find(p => p.id === id);
function view(r,p) {
  const voted = r.votes.has(p.id);
  return {
    code:r.code, me:p.id, host:r.host, phase:r.phase, round:r.round, settings:r.settings,
    players:r.players.map(q => ({id:q.id,name:q.name,out:q.out,connected:q.connected,voted:r.votes.has(q.id)})),
    myWord:r.phase==='lobby'?null:p.word, myRole:r.phase==='lobby'?null:p.role,
    yourVote:r.votes.get(p.id)||null, votesCount:r.votes.size,
    turn:r.turn, result:r.result, history:r.history.slice(-8), winner:r.winner, whiteGuesser:r.whiteGuesser,
    canVote:r.phase==='vote'&&!p.out&&!voted,
    revealAll:r.phase==='finished'?r.players.map(q=>({name:q.name,role:q.role,word:q.word})):null
  };
}
function send(r) { for (const p of r.players) if (p.socket) io.to(p.socket).emit('state',view(r,p)); }
function error(s,msg) { s.emit('gameError',msg); }
function access(s,fn) {
  const r = [...rooms.values()].find(x => x.players.some(p=>p.socket===s.id));
  if (!r) return error(s,'Tu n’es pas dans un salon.');
  fn(r,r.players.find(p=>p.socket===s.id));
}
function checkWin(r) {
  const a=alive(r), nU=a.filter(p=>p.role==='undercover').length,
    nC=a.filter(p=>p.role==='civil').length, nW=a.filter(p=>p.role==='white').length;
  if (nU===0 && nW===0) {r.winner='Civils';r.phase='finished';return true;}
  if (nC===0 || (nU>=nC && nW===0)) {r.winner='Undercover';r.phase='finished';return true;}
  return false;
}
function nextTurn(r) { const a=alive(r); r.turn=a.length?a[(r.round-1)%a.length].id:null; }
function reset(r) {
  r.phase='lobby';r.round=0;r.votes=new Map();r.result=null;r.winner=null;r.history=[];r.turn=null;r.whiteGuesser=null;
  for (const p of r.players) {p.out=false;p.role=null;p.word=null;}
}
function start(r) {
  const pool=shuffle(r.players),w=r.settings.white?1:0,
    u=Math.max(1,Math.min(r.settings.undercover,r.players.length-w-2));
  let [civilWord,underWord]=pairs[randomInt(pairs.length)];
  if (randomInt(2)) [civilWord,underWord]=[underWord,civilWord];
  pool.forEach((p,i) => {
    p.out=false;p.role=i<w?'white':i<w+u?'undercover':'civil';
    p.word=p.role==='white'?null:(p.role==='undercover'?underWord:civilWord);
  });
  r.phase='reveal';r.round=1;r.votes=new Map();r.result=null;r.winner=null;r.history=[];r.whiteGuesser=null;nextTurn(r);
}
io.on('connection',s => {
  s.on('join',({code,name,token}={}) => {
    const nm=sanitize(name);
    if (!nm) return error(s,'Entre ton prénom.');
    const c=String(code||'').trim().toUpperCase();
    let r=c?rooms.get(c):null;
    if (c&&!r) return error(s,'Salon introuvable. Vérifie le code.');
    if (!r) {
      r={code:codeGen(),players:[],host:null,phase:'lobby',settings:{undercover:1,white:false},
        round:0,votes:new Map(),turn:null,result:null,winner:null,history:[],created:Date.now()};
      rooms.set(r.code,r);
    }
    let p=token?r.players.find(q=>q.token===token):null;
    if (p) {
      if (p.socket&&p.socket!==s.id) io.to(p.socket).emit('displaced');
      p.socket=s.id;p.connected=true;p.lastSeen=Date.now();
    } else {
      if (r.phase!=='lobby') return error(s,'La partie a commencé. Tu ne peux plus rejoindre ce salon.');
      if (r.players.length>=20) return error(s,'Salon complet (20 joueurs).');
      if (r.players.some(x=>x.name.toLowerCase()===nm.toLowerCase())) return error(s,'Ce prénom est déjà pris.');
      p={id:uid(),token:uid(),name:nm,role:null,word:null,out:false,socket:s.id,connected:true,lastSeen:Date.now()};
      r.players.push(p);
      if (!r.host) r.host=p.id;
    }
    s.emit('joined',{code:r.code,token:p.token,name:p.name});send(r);
  });
  s.on('settings',v=>access(s,(r,p)=>{
    if (p.id!==r.host||r.phase!=='lobby') return;
    const under=Math.max(1,Math.min(8,Number(v?.undercover)||1));
    r.settings={undercover:under,white:!!v?.white};send(r);
  }));
  s.on('start',()=>access(s,(r,p)=>{
    if (p.id!==r.host||r.phase!=='lobby') return;
    if (r.players.length<3) return error(s,'Il faut au moins 3 joueurs.');
    if (r.players.some(p=>!p.connected)) return error(s,'Attends que tout le monde soit connecté.');
    if (r.players.length-r.settings.undercover-(r.settings.white?1:0)<2)
      return error(s,'Il faut au moins 2 civils. Réduis le nombre de rôles spéciaux.');
    start(r);send(r);
  }));
  s.on('phase',phase=>access(s,(r,p)=>{
    if (p.id!==r.host) return;
    if (r.phase==='reveal'&&phase==='discussion') {r.phase='discussion';send(r);}
    else if (r.phase==='discussion'&&phase==='vote') {r.phase='vote';r.votes=new Map();send(r);}
    else if (r.phase==='result'&&phase==='continue') {r.round++;r.phase='discussion';r.result=null;r.votes=new Map();nextTurn(r);send(r);}
    else if (r.phase==='finished'&&phase==='lobby') {reset(r);send(r);}
  }));
  s.on('vote',target=>access(s,(r,p)=>{
    if (r.phase!=='vote'||p.out||r.votes.has(p.id)) return;
    const t=playerBy(r,target);
    if (!t||t.out||t.id===p.id) return error(s,'Vote invalide.');
    r.votes.set(p.id,target);
    if (r.votes.size===alive(r).length) {
      const totals=new Map();
      for (const v of r.votes.values()) totals.set(v,(totals.get(v)||0)+1);
      const m=Math.max(...totals.values());
      const top=[...totals].filter(([,n])=>n===m);
      let out=null;
      if (top.length===1) {out=playerBy(r,top[0][0]);out.out=true;}
      r.result={out:out?{id:out.id,name:out.name,role:out.role}:null,tie:top.length>1,
        tallies:[...totals].map(([id,votes])=>({id,name:playerBy(r,id)?.name,votes}))};
      r.history.push(r.result);
      r.phase='result';
      if (out?.role==='white') {r.phase='whiteGuess';r.whiteGuesser=out.id;}
      else checkWin(r);
    }
    send(r);
  }));
  s.on('whiteGuess',guess=>access(s,(r,p)=>{
    if (r.phase!=='whiteGuess'||p.id!==r.whiteGuesser) return;
    const civil=r.players.find(q=>q.role==='civil')?.word;
    const normalize=x=>String(x||'').trim().normalize('NFC').toLocaleLowerCase('fr');
    const good=normalize(guess)===normalize(civil);
    if (good) {r.winner='Mr White';r.phase='finished';}
    else {r.phase='result';checkWin(r);}
    r.result.whiteGuess={text:sanitize(guess),good};send(r);
  }));
  s.on('kick',id=>access(s,(r,p)=>{
    if (p.id!==r.host||r.phase!=='lobby'||id===p.id) return;
    const t=playerBy(r,id);if (!t) return;
    r.players=r.players.filter(x=>x!==t);
    if (t.socket) io.to(t.socket).emit('kicked');
    send(r);
  }));
  s.on('disconnect',()=>{
    for (const r of rooms.values()) {
      const p=r.players.find(x=>x.socket===s.id);
      if (!p) continue;
      p.connected=false;p.socket=null;p.lastSeen=Date.now();
      send(r);break;
    }
  });
});
setInterval(()=>{
  for (const [code,r] of rooms) {
    const now=Date.now();
    if (now-r.created>24*3600*1000 || (!r.players.some(p=>p.connected)&&now-r.created>2*3600*1000)) {
      rooms.delete(code);continue;
    }
    if (r.phase==='lobby') {
      r.players=r.players.filter(p=>p.connected||now-p.lastSeen<120000);
      if (!r.players.some(p=>p.id===r.host)) r.host=r.players[0]?.id||null;
      if (!r.players.length) rooms.delete(code);
      else send(r);
    }
  }
},30000).unref();
const PORT=process.env.PORT||3000;
http.listen(PORT,'0.0.0.0',()=>console.log(`Undercover : http://localhost:${PORT}`));
