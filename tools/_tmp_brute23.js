(function(){
clearInterval(window.__P);
window.__T={res:[],done:false,err:null};
function E(t,k){var e=new KeyboardEvent(t,{bubbles:true,cancelable:true});try{Object.defineProperty(e,'keyCode',{value:k});}catch(x){}window.dispatchEvent(e);}
function inj(){Input.clear();var s=STAGES.find(function(x){return x.id==='2-3';});Levels.get=function(){return s;};GameEngine.startGame();}
var JS=[];for(var j=0;j<=26;j++)JS.push(j);JS.push(99);
var idx=0,tick=0,phase='gap',gap=0,land=-1,jfired=false,row=null;
function begin(){
var J=JS[idx];
inj();tick=0;land=-1;jfired=false;
row={j:J,land:null,jump:null,death:null,alive:false,maEnd:null,mbEnd:null,mz:0,samp:''};
E('keydown',39);
phase='run';
}
function end(){
E('keyup',39);E('keyup',38);
var st=GameEngine._state,p=st.player;
row.alive=(p.mhp>=1&&tick>60);
row.maEnd=Math.round(p.ma);row.mbEnd=Math.round(p.mb);
window.__T.res.push(row);
idx++;phase='gap';gap=0;
if(idx>=JS.length){window.__T.done=true;clearInterval(window.__P);}
}
window.__P=setInterval(function(){
try{
GameEngine._stepFrame();
tick++;
var st=GameEngine._state,p=st.player,l=st.lifts[0];
if(phase==='run'){
if(land<0&&p.mzimen===1){land=tick;row.land=tick;}
if(land>=0&&!jfired&&row.j!==99&&tick>=land+row.j){E('keydown',38);jfired=true;row.jump=tick;setTimeout(function(){E('keyup',38);},70);}
if(p.mzimen===1&&p.mb<40000)row.mz++;
if(row.death===null&&p.mhp<0)row.death=tick;
if(tick%15===0&&land>=0)row.samp+=(tick-land)+':'+Math.round(p.ma/100)+','+Math.round(p.mb/100)+','+(p.mzimen===1?1:0)+','+Math.round(l.srb/100)+' ';
if(tick>=105)end();
}else if(phase==='gap'){
gap++;if(gap>=20)begin();
}
}catch(e){window.__T.err=String(e&&e.stack||e);clearInterval(window.__P);}
},33);
begin();
return 'started '+JS.length;
})();
