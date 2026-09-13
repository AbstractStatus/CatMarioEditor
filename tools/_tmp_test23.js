(function(){
clearInterval(window.__P);clearInterval(window.__S);
window.__T={log:[],done:false,err:null};
function E(t,k){var e=new KeyboardEvent(t,{bubbles:true,cancelable:true});try{Object.defineProperty(e,'keyCode',{value:k});}catch(x){}window.dispatchEvent(e);return e.defaultPrevented;}
function inj(){Input.clear();var s=STAGES.find(function(x){return x.id==='2-3';});Levels.get=function(){return s;};GameEngine.startGame();}
var pump=null;
function rep(rows,mode,fire){
var i,li=-1;for(i=0;i<rows.length;i++){if(rows[i][6]===1){li=i;break;}}
var a=li>=0?rows.slice(li):[];
var ma=a.map(function(r){return r[2];}),mc=a.map(function(r){return r[4];});
var br=a.filter(function(r){return r[6]!==1;}).map(function(r){return r[0];}).slice(0,8);
var eb=a.map(function(r){return r[9]<0?null:r[3]+3600-r[9];}).filter(function(x){return x!==null;});
var dt=null;for(i=0;i<rows.length;i++){if(rows[i][7]<0||rows[i][8]===200){dt=rows[i][0];break;}}
var tj=rows.filter(function(r){return r[0]%300<100;}).map(function(r){return r.join(',');});
var dx=null,mdmn=null,mbmn=null;
if(fire){
var after=rows.filter(function(r){return r[0]>=fire.t;});
var f5=after.filter(function(r){return r[0]<=fire.t+600;});
if(f5.length){mdmn=Math.min.apply(null,f5.map(function(r){return r[5];}));mbmn=Math.min.apply(null,f5.map(function(r){return r[3];}));}
var r5=after.filter(function(r){return r[0]>=fire.t+450&&r[0]<=fire.t+650;});
if(r5.length&&li>=0)dx=r5[0][2]-rows[li][2];
}
return {mode:mode,fire:fire,land:li>=0?rows[li][0]:null,ma0:li>=0?rows[li][2]:null,xmax:ma.length?Math.max.apply(null,ma):null,xmin:ma.length?Math.min.apply(null,ma):null,mcmax:mc.length?Math.max.apply(null,mc):null,eb0:eb.length?eb[0]:null,ebN:eb.length?eb[eb.length-1]:null,dx500:dx,mdmn:mdmn,mbmn:mbmn,brk:br,death:dt,tj:tj};
}
function run(mode,dur,cb){
inj();
var t0=performance.now(),rows=[],fire=null;
pump=setInterval(function(){try{GameEngine._stepFrame();}catch(e){window.__T.err=String(e);}},33);
window.__P=pump;
window.__S=setInterval(function(){
var st=GameEngine._state,p=st.player;if(!p)return;var l=(st.lifts||[])[0];
if(mode&&!fire&&(p.mzimen===1||performance.now()-t0>2200)){
fire={t:Math.round(performance.now()-t0),mz:p.mzimen};
if(mode==='R')fire.dp=E('keydown',39);
if(mode==='L')fire.dp=E('keydown',37);
if(mode==='RJ'){E('keydown',39);fire.dp=E('keydown',38);}
fire.k=Input.get();
}
rows.push([Math.round(performance.now()-t0),st.proc,Math.round(p.ma),Math.round(p.mb),Math.round(p.mc),Math.round(p.md),p.mzimen,p.mhp,p.mtype,l?Math.round(l.srb):-1,l?Math.round(l.sre):-1]);
},100);
setTimeout(function(){clearInterval(pump);clearInterval(window.__S);try{E('keyup',39);E('keyup',37);E('keyup',38);}catch(x){}window.__T.log.push(rep(rows,mode,fire));cb();},dur);
}
run(null,3000,function(){setTimeout(function(){run('R',3000,function(){setTimeout(function(){run('L',3000,function(){setTimeout(function(){run('RJ',3000,function(){window.__T.done=true;});},1500);});},1500);});},1500);});
return 'started';
})();
