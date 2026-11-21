/* ---------- Aba Eficiência: aproveitamento do tempo do turno ----------
   Compara a produção com o relógio do turno:
   - t/h rodando     = toneladas ÷ horas que o alimentador rodou (AV10 no primário, CV07 no secundário)
   - t/h disponível  = toneladas ÷ horas do turno sem as pausas (almoço, janta)
   - t/h turno       = toneladas ÷ horas do turno inteiro (início → fim, pausas incluídas)
   Eficiência = t/h do turno ÷ t/h rodando. Toneladas que ficaram na mesa = horas paradas dentro do tempo disponível × t/h rodando. */
const EF={key:null,rows:null,busy:false,err:null,area:'P'};
try{const a=localStorage.getItem('hb_efarea');if(a==='P'||a==='S')EF.area=a}catch(e){}
const EFA={P:{nome:'Primário',m:'AV10',lt:'Rachão BM10',h:'av',hd:'avd',t:'tp',cor:'var(--m1)'},
           S:{nome:'Secundário / finos',m:'CV07',lt:'Finos (brita 1, pó, brita 2)',h:'cv',hd:'cvd',t:'tf',cor:'var(--mfin)'}};

async function efiLoad(force,silencioso){
  if(!D||!isDay(F.from)||!isDay(F.to))return;
  const key=`${F.from}|${F.to}`;
  if(EF.key===key&&EF.rows&&!force){renderEfi();return}
  const quieto=silencioso&&EF.key===key&&EF.rows;
  if(!quieto){EF.busy=true;EF.err=null;if(EF.key!==key)EF.rows=null;EF.key=key;renderEfi()}
  try{const r=await rpc('efi_dados',{p_desde:F.from,p_ate:F.to});if(EF.key!==key)return;
    if(quieto&&mesmoDado(r,EF.rows))return;EF.rows=r||[]}
  catch(e){if(EF.key===key&&!quieto)EF.err=e;if(quieto)return}
  EF.busy=false;if(EF.key===key)renderEfi(!silencioso)
}

/* Soma um conjunto de linhas (turnos) numa área */
function efiSoma(rs,a){
  const o={T:0,ht:0,hd:0,h:0,hdr:0,n:0,semH:[],semT:0,foraT:0};
  rs.forEach(r=>{const t=+r[a.t]||0,h=+r[a.h]||0;
    if(t>0&&h<=0){o.semH.push(r);return}         /* produção sem sinal do alimentador: fora da conta */
    if(t>0&&!(+r.ht>0)){o.foraT+=t;return}       /* produção lançada fora de turno (sem horário) */
    if(!(t>0))return;                            /* turno sem produção lançada (folga, feriado, parada geral): não entra */
    o.T+=t;o.ht+=+r.ht||0;o.hd+=+r.hd||0;o.h+=h;o.hdr+=+r[a.hd]||0;if(t>0)o.n++});
  o.thR=o.h?o.T/o.h:0;o.thD=o.hd?o.T/o.hd:0;o.thT=o.ht?o.T/o.ht:0;
  o.efT=o.thR?o.thT/o.thR:0;o.efD=o.thR?o.thD/o.thR:0;
  o.hPar=Math.max(0,o.hd-o.hdr);o.tPerd=o.hPar*o.thR;o.hPz=Math.max(0,o.ht-o.hd);
  return o;
}

function renderEfi(anim){
  const pane=$('#p-efi');if(!pane)return;
  const a=EFA[EF.area];
  $('#efArea').innerHTML=Object.entries(EFA).map(([k,x])=>`<button type="button" data-efa="${k}" class="${EF.area===k?'on':''}" aria-pressed="${EF.area===k}">${x.nome}</button>`).join('');
  if(EF.err){$('#kE').innerHTML='';$('#cE1').innerHTML=$('#cE2').innerHTML=$('#tEf').innerHTML='';
    $('#cE0').innerHTML=`<div class="pempty"><b>Não deu para carregar a eficiência</b>${esc(errApp(EF.err))}<br><button class="btn1" type="button" data-efretry style="margin-top:12px">Tentar de novo</button></div>`;return}
  if(!EF.rows){$('#kE').innerHTML='';$('#cE0').innerHTML='<div class="pempty">Carregando…</div>';$('#cE1').innerHTML=$('#cE2').innerHTML=$('#tEf').innerHTML='';return}
  const rs=EF.rows.filter(r=>tuOK(r.turno)),S=efiSoma(rs,a),fT=F.tu!=='all';
  const tuTxt=fT?`${F.tu}º turno`:'nos turnos';
  $('#efK').textContent=`${a.lt} ÷ horas do ${a.m} · ${tuTxt}`;
  if(!S.n){$('#kE').innerHTML='';$('#cE1').innerHTML=$('#cE2').innerHTML=$('#tEf').innerHTML='';
    $('#cE0').innerHTML=`<div class="pempty"><b>Sem produção lançada com horas do ${a.m} neste período</b>Escolha outro período no filtro ou confira os lançamentos de produção.</div>`;
    $('#nEf').innerHTML=efiNotas(S,a);return}
  $('#kE').innerHTML=
     kt(Math.round(S.efT*100),'Eficiência do turno',S.efT>=.75?'var(--ok)':S.efT>=.6?'var(--T)':'var(--cr)',`t/h do turno ÷ t/h rodando · sem as pausas: ${pcE(S.efD)}`,'%')
    +kt(S.thR,'t/h rodando',a.cor,`${f0(S.T)} t em ${fH(S.h)} h de ${a.m} ligado`,'t/h',1)
    +kt(S.thT,'t/h no turno inteiro','var(--navy2)',`início → fim · no tempo disponível: ${fH(S.thD)} t/h`,'t/h',1)
    +kt(S.tPerd,'Toneladas que ficaram na mesa','var(--cr)',`${fH(S.hPar)} h parado no tempo disponível × ${f0(S.thR)} t/h`,'t');
  $('#cE0').innerHTML=efiRegua(S,a);
  $('#cE1').innerHTML=efiBarras(rs,a);
  $('#cE2').innerHTML=efiTurnos(a);
  $('#tEf').innerHTML=efiTabela(rs,a);
  $('#nEf').innerHTML=efiNotas(S,a);
  if(anim)reveal();else revelarJa();
}
const pcE=v=>Math.round(v*100)+'%';

/* Régua do tempo: turno inteiro = pausas + parado no disponível + rodando */
function efiRegua(S,a){
  const tot=Math.max(S.ht,S.h,0.01),rodD=Math.min(S.hdr,S.hd),rodPz=Math.max(0,S.h-S.hdr);
  const seg=[[rodD,a.cor,'Rodando no tempo disponível'],[S.hPar,'var(--cr)','Parado no tempo disponível'],[Math.max(0,S.hPz-rodPz),'var(--off)','Pausas (almoço, janta) paradas'],[rodPz,'var(--T)','Rodou na pausa ou fora do turno']].filter(s=>s[0]>0.005);
  const w=v=>(v/tot*100).toFixed(2)+'%';
  return `<div class="efr" role="img" aria-label="${esc(`Turno inteiro ${fH(S.ht)} h, disponível ${fH(S.hd)} h, rodando ${fH(S.h)} h`)}">
    <div class="efrl"><span>Turno inteiro</span><b>${fH(S.ht)} h</b></div>
    <div class="efrb">${seg.map(s=>`<i style="width:${w(s[0])};background:${s[1]}" data-tip="${esc(`<b>${fH(s[0])} h</b><div class='tl'><span>${s[2]}</span><b>${pcE(s[0]/tot)}</b></div>`)}"></i>`).join('')}</div>
    <div class="efrs"><div><span>Disponível (sem pausas)</span><b>${fH(S.hd)} h</b><em>${pcE(S.hd/tot)} do turno</em></div>
      <div><span>Rodando no disponível</span><b>${fH(S.hdr)} h</b><em>${S.hd?pcE(S.hdr/S.hd):'—'} do disponível</em></div>
      <div><span>Parado no disponível</span><b>${fH(S.hPar)} h</b><em>${f0(S.tPerd)} t deixaram de sair</em></div>
      <div><span>Rodou na pausa</span><b>${fH(rodPz)} h</b><em>${rodPz>0.05?'conta a favor no t/h do turno':'pausas respeitadas'}</em></div></div>
    <div class="leg">${seg.map(s=>`<span><i style="background:${s[1]}"></i>${s[2]}</span>`).join('')}</div></div>`;
}

/* Barras por dia: clara = t/h rodando (o potencial), cheia = t/h do turno inteiro, traço = t/h no disponível */
function efiBarras(rs,a){
  const by={};rs.forEach(r=>(by[r.dia]=by[r.dia]||[]).push(r));
  const dias=DAYS.filter(d=>by[d]).map(d=>({d,s:efiSoma(by[d],a)})).filter(x=>x.s.n);
  if(!dias.length)return '<div class="pempty">Sem dias com produção e horas neste período.</div>';
  const W=largGraf(false),L=40,H=230,T=18,Bo=24,n=dias.length,cw=(W-L)/n,ih=H-T-Bo;
  const thM=efiSoma(rs,a).thR,maxV=Math.max(1,...dias.map(x=>x.s.thR)),lim=Math.min(maxV,thM*2||maxV),
        st=Math.pow(10,Math.floor(Math.log10(lim)))/2,top=Math.ceil(lim/st)*st,Y=v=>ih*Math.min(v,top)/top;
  let s=`<svg class="ch swipe" viewBox="0 0 ${W} ${H}" style="max-width:${W}px" role="img" aria-label="${esc(`${a.nome}: t/h rodando e t/h do turno por dia`)}">`;
  [0,.5,1].forEach(f=>{const y=T+ih-Y(top*f);s+=`<line class="gl" x1="${L}" x2="${W}" y1="${y}" y2="${y}"/><text class="ax" x="${L-6}" y="${y+3}" text-anchor="end">${f0(top*f)}</text>`});
  const stp=Math.max(1,Math.ceil(40/cw));
  dias.forEach((x,i)=>{const o=x.s,X=L+i*cw,bw=Math.max(4,Math.min(26,cw*.7)),bx=X+(cw-bw)/2;
    const yR=T+ih-Y(o.thR),yT=T+ih-Y(o.thT),yD=T+ih-Y(o.thD),cor=o.efT>=.75?'var(--ok)':o.efT>=.6?'var(--T)':'var(--cr)';
    const tip=`<div class='m'>${ddmm(x.d)} · ${WDN[wd(x.d)]} · ${a.nome}</div><b>Eficiência ${pcE(o.efT)}</b>`
      +`<div class='tl'><span>t/h rodando</span><b>${fH(o.thR)}</b></div><div class='tl'><span>t/h no disponível</span><b>${fH(o.thD)}</b></div><div class='tl'><span>t/h no turno inteiro</span><b>${fH(o.thT)}</b></div>`
      +`<div class='tl'><span>${a.lt}</span><b>${f0(o.T)} t</b></div><div class='tl'><span>Turno · disponível · rodando</span><b>${fH(o.ht)} · ${fH(o.hd)} · ${fH(o.h)} h</b></div><div class='tl'><span>Ficaram na mesa</span><b>${f0(o.tPerd)} t</b></div><div class='m' style='margin-top:4px'>Toque para ver o Gantt do dia</div>`;
    s+=`<g class="bd" data-gday="${x.d}" style="cursor:pointer" data-tip="${esc(tip)}"><rect class="bg" x="${X}" y="${T}" width="${cw}" height="${ih}" fill="transparent" rx="3"/>`
      +`<rect x="${bx}" y="${yR}" width="${bw}" height="${Math.max(1,T+ih-yR)}" fill="${a.cor}" fill-opacity=".22" rx="3"/>`
      +`<rect x="${bx}" y="${yT}" width="${bw}" height="${Math.max(1,T+ih-yT)}" fill="${cor}" rx="3"/>`
      +`<line x1="${bx-2}" x2="${bx+bw+2}" y1="${yD}" y2="${yD}" stroke="var(--ink)" stroke-width="2"/>`
      +(o.thR>top?`<text x="${X+cw/2}" y="${T-5}" text-anchor="middle" style="font:700 10px var(--mono)" fill="${a.cor}">▲${f0(o.thR)}</text>`:'')+'</g>';
    if(i%stp===0)s+=`<text class="ax" x="${X+cw/2}" y="${H-7}" text-anchor="middle">${ddmm(x.d).slice(0,2)}</text>`});
  return s+`</svg><div class="leg"><span><i style="background:${a.cor};opacity:.25"></i>t/h rodando (o ritmo da máquina)</span><span><i style="background:var(--ok)"></i>t/h do turno · 75% ou mais</span><span><i style="background:var(--T)"></i>60 a 75%</span><span><i style="background:var(--cr)"></i>abaixo de 60%</span><span><i style="background:var(--ink);height:2px;margin-top:4px"></i>t/h no disponível</span></div>`;
}

/* 1º × 2º turno lado a lado */
function efiTurnos(a){
  const ts=['1','2'].map(t=>[t,efiSoma(EF.rows.filter(r=>String(r.turno)===t),a)]).filter(([,o])=>o.n);
  if(!ts.length)return '';
  return `<div class="eft">${ts.map(([t,o])=>`<div class="${F.tu!=='all'&&F.tu!==t?'off':''}"><div class="pmh"><i style="background:${t==='1'?'var(--P)':'var(--T)'}"></i>${t}º turno</div>
    <b>${pcE(o.efT)}</b><span>eficiência no turno inteiro</span>
    <div class="tl"><span>t/h rodando</span><b>${fH(o.thR)}</b></div><div class="tl"><span>t/h no disponível</span><b>${fH(o.thD)}</b></div><div class="tl"><span>t/h no turno</span><b>${fH(o.thT)}</b></div>
    <div class="tl"><span>Parado no disponível</span><b>${fH(o.hPar)} h</b></div><div class="tl"><span>Ficaram na mesa</span><b>${f0(o.tPerd)} t</b></div></div>`).join('')}</div>`;
}

function efiTabela(rs,a){
  const ls=rs.filter(r=>(+r[a.t]>0)||(+r.ht>0)).slice().reverse();
  let h=`<thead><tr><th>Dia</th><th>Turno</th><th class="n">Turno h</th><th class="n">Disp. h</th><th class="n">Rodando h</th><th class="n">Toneladas</th><th class="n">t/h rodando</th><th class="n">t/h disp.</th><th class="n">t/h turno</th><th class="n">Eficiência</th><th class="n">Na mesa t</th></tr></thead><tbody>`;
  ls.forEach(r=>{const o=efiSoma([r],a),t=+r[a.t]||0,h0=+r[a.h]||0,sem=t>0&&h0<=0;
    const ef=o.n?o.efT:null,cl=ef==null?'':ef>=.75?'ok':ef>=.6?'at':'cr';
    h+=`<tr><td><a class="lnk" data-gday="${r.dia}">${ddmm(r.dia)} <small>${WDN[wd(r.dia)]}</small></a></td><td>${r.turno}º${r.ini?` <small>${hhmm(Date.parse(r.ini)/1000)}–${hhmm(Date.parse(r.fim)/1000)}</small>`:''}</td>`
      +`<td class="n">${fH(+r.ht||0)}</td><td class="n">${fH(+r.hd||0)}</td><td class="n">${sem?'<span class="efw">sem sinal</span>':fH(h0)}</td><td class="n">${f0(t)}</td>`
      +`<td class="n">${o.n?fH(o.thR):'—'}</td><td class="n">${o.n?fH(o.thD):'—'}</td><td class="n">${o.n?fH(o.thT):'—'}</td><td class="n"><span class="efp ${cl}">${ef==null?'—':pcE(ef)}</span></td><td class="n">${o.n?f0(o.tPerd):'—'}</td></tr>`});
  return h+'</tbody>';
}

function efiNotas(S,a){
  let n=`Eficiência = t/h do turno inteiro ÷ t/h rodando. Mostra quanto do ritmo da máquina virou produção no relógio do turno. As horas vêm do sensor de liga/desliga do ${a.m}; a produção, dos lançamentos por turno. "Na mesa" = horas paradas dentro do tempo disponível × t/h rodando do período. Turnos sem produção lançada na área não entram na conta.`;
  if(S.semH.length)n+=`<br><span class="efw">${S.semH.length} ${S.semH.length===1?'turno':'turnos'} com produção mas sem sinal do ${a.m} (${S.semH.map(r=>`${ddmm(r.dia)} ${r.turno}º`).join(', ')}): ficaram fora da conta.</span>`;
  if(S.foraT>0)n+=`<br><span class="efw">${f0(S.foraT)} t lançadas em turno sem horário cadastrado (domingo ou feriado): ficaram fora da conta.</span>`;
  return n;
}

document.addEventListener('click',e=>{
  const b=e.target.closest('#efArea button');if(b){EF.area=b.dataset.efa;try{localStorage.setItem('hb_efarea',EF.area)}catch(x){}renderEfi(true);return}
  if(e.target.closest('[data-efretry]'))efiLoad(true);
});
