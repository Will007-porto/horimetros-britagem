/* ---------- Exportar relatório no modelo da planilha (PDF "PRODUÇÃO dd.mm") ----------
   5 páginas A4 deitadas, iguais ao Dashboard da planilha: visão geral do mês, ritmo + curvas S,
   memória diária, rachão por equipamento e evolução por equipamento.
   Tudo calculado até o dia escolhido na caixa "Produção do dia". Sai pela impressão do navegador:
   escolha "Salvar como PDF" (o nome sugerido já vem "PRODUÇÃO dd.mm"). */
const RM={navy:'#0B2559',cinza:'#B8BEC9',borda:'#D6DCE6',fundo:'#F3F5F9',txt:'#1B2B4B',sub:'#6B7487',red:'#D9342B',green:'#1E8E5A',orange:'#C77700',
  mat:{RACHAO:'#0B2A5B',BRITA01:'#2E75B6',PO:'#F2A93B',BRITA02:'#17A589'},eq:{BM10:'#2E75B6',BMM05:'#17A589'}};
const RMN={RACHAO:'RACHÃO',BRITA01:'BRITA 01',PO:'PÓ',BRITA02:'BRITA 02'};
const rmPc=v=>v==null||!isFinite(v)?'—':pc1(v);
const rmSaldoCor=v=>v<0?RM.red:RM.green;
const rmAdCor=a=>a==null?RM.txt:a>=1?RM.green:a>=.9?RM.orange:RM.red;

function rmHead(t,s,c,dia){return `<div class="rmh"><div><b>${t}</b><span>${s}</span></div><div class="r"><b>${esc(mesTxt(PR.mes).toUpperCase())}</b><span>ATUALIZADO ATÉ ${dmy(dia)}</span></div></div>`}
const rmSec=t=>`<div class="rms">${t}</div>`;
function rmCard(l,v,s,o={}){return `<div class="rmc${o.top?' top':''}" ${o.top?`style="--tc:${o.top}"`:''}>${o.top?`<div class="rmct">${l}</div>`:`<div class="rml">${l}</div>`}<div class="rmv" style="color:${o.cor||RM.txt};${o.big?'font-size:19pt':''}">${v}</div>${s?`<div class="rmsb">${s}</div>`:''}</div>`}

/* Gráfico de linhas (uma escala só) */
function rmLinhas({W=520,H=230,series,dias,titulo,leg}){
  const L=52,R=14,T=34,B=40,iw=W-L-R,ih=H-T-B,n=dias.length;
  const max=Math.max(1,...series.flatMap(s=>s.v.filter(v=>v!=null))),st=Math.pow(10,Math.floor(Math.log10(max)))/2,top=Math.ceil(max/st)*st;
  const X=i=>L+iw*(i+.5)/n,Y=v=>T+ih-ih*v/top;
  let s=`<svg viewBox="0 0 ${W} ${H}" class="rmg"><text x="${W/2}" y="14" text-anchor="middle" class="tt">${titulo}</text>`;
  s+=`<g transform="translate(${W/2},27)">${leg.map((l,i)=>`<g transform="translate(${(i-(leg.length-1)/2)*130},0)"><line x1="-58" x2="-44" y1="-3" y2="-3" stroke="${l.c}" stroke-width="2.5" ${l.d?`stroke-dasharray="${l.d}"`:''}/><text x="-40" y="0" class="lg">${l.t}</text></g>`).join('')}</g>`;
  for(let k=0;k<=4;k++){const v=top*k/4,y=Y(v);s+=`<line x1="${L}" x2="${W-R}" y1="${y}" y2="${y}" stroke="#E6EAF0"/><text x="${L-6}" y="${y+3}" text-anchor="end" class="ax">${f0(v)}</text>`}
  dias.forEach((d,i)=>{s+=`<text transform="translate(${X(i)+3},${T+ih+8}) rotate(-60)" text-anchor="end" class="ax">${ddmm(d)}</text>`});
  series.forEach(se=>{const p=se.v.map((v,i)=>v==null?null:[X(i),Y(v)]).filter(Boolean);if(!p.length)return;
    s+=`<path d="${p.map((q,i)=>(i?'L':'M')+q[0].toFixed(1)+' '+q[1].toFixed(1)).join('')}" fill="none" stroke="${se.c}" stroke-width="${se.w||2}" ${se.d?`stroke-dasharray="${se.d}"`:''} stroke-linejoin="round" stroke-linecap="round"/>`;
    if(se.m)p.forEach(q=>{s+=`<circle cx="${q[0]}" cy="${q[1]}" r="2.6" fill="${se.c}"/>`})});
  return s+'</svg>';
}
/* Colunas agrupadas */
function rmColunas({W=520,H=230,grupos,series,titulo,rot,valores}){
  const L=52,R=10,T=34,B=rot?40:24,iw=W-L-R,ih=H-T-B,n=grupos.length,gw=iw/n,bw=Math.min(rot?7:30,gw*.8/series.length);
  const max=Math.max(1,...series.flatMap(s=>s.v)),st=Math.pow(10,Math.floor(Math.log10(max)))/2,top=Math.ceil(max/st)*st;const Y=v=>ih*v/top;
  let s=`<svg viewBox="0 0 ${W} ${H}" class="rmg"><text x="${W/2}" y="14" text-anchor="middle" class="tt">${titulo}</text>`;
  s+=`<g transform="translate(${W/2},27)">${series.map((l,i)=>`<g transform="translate(${(i-(series.length-1)/2)*110},0)"><rect x="-50" y="-8" width="9" height="9" fill="${l.c}"/><text x="-37" y="0" class="lg">${l.t}</text></g>`).join('')}</g>`;
  for(let k=0;k<=4;k++){const v=top*k/4,y=T+ih-Y(v);s+=`<line x1="${L}" x2="${W-R}" y1="${y}" y2="${y}" stroke="#E6EAF0"/><text x="${L-6}" y="${y+3}" text-anchor="end" class="ax">${f0(v)}</text>`}
  grupos.forEach((g,i)=>{const x0=L+gw*i+gw/2-bw*series.length/2;
    series.forEach((se,j)=>{const v=se.v[i]||0,h=Y(v),x=x0+j*bw;s+=`<rect x="${x+.6}" y="${T+ih-h}" width="${bw-1.2}" height="${h}" fill="${se.c}"/>`;
      if(valores&&v)s+=`<text x="${x+bw/2}" y="${T+ih-h-3}" text-anchor="middle" class="vl">${f0(v)}</text>`});
    s+=rot?`<text transform="translate(${L+gw*i+gw/2+3},${T+ih+8}) rotate(-60)" text-anchor="end" class="ax">${g}</text>`:`<text x="${L+gw*i+gw/2}" y="${T+ih+15}" text-anchor="middle" class="ax" style="font-size:8.5px">${g}</text>`});
  return s+'</svg>';
}

function rmMontar(dia){
  const c=PR.c,o=c.byD[dia],a=prdAte(c,dia),dias=c.days.map(x=>x.d),ate=x=>x.d<=dia;
  const saldo=a.realT-c.metaT,ad=a.prevT?a.realT/a.prevT:null;
  const H1=rmHead('ACOMPANHAMENTO DIÁRIO DA PRODUÇÃO',visLiq()?'Pedreira Tripoloni - Britagem · visão estoque (atendimento do rachão: Lokotrack + sobra do primário depois do secundário)':'Pedreira Tripoloni - Britagem · visão produtividade (soma de todas as etapas)',c,dia);
  const tn=PR.tend?prdTendAte(c,'T',dia):null;

  /* página 1: visão geral */
  let p1=H1+rmSec('Visão geral do mês')+`<div class="${visLiq()?'rmg4':'rmg5'}">`
    +rmCard(visLiq()?'Meta de atendimento':'Programado do mês',f0(c.metaT),visLiq()?'meta de rachão cadastrada (t)':'meta total de produção (t)')
    +rmCard(visLiq()?'Rachão p/ aplicação':'Realizado acumulado',f0(a.realT),visLiq()?'Lokotrack + sobra do primário (t)':'produzido até o momento (t)')
    +rmCard('% atingimento do mês',rmPc(c.metaT?a.realT/c.metaT:null),`Previsto até ${ddmm(dia)}: ${rmPc(c.metaT?a.prevT/c.metaT:null)}`)
    +rmCard('Saldo vs meta',f0(saldo),'positivo = acima · negativo = abaixo (t)',{cor:rmSaldoCor(saldo)})
    +(visLiq()?'':rmCard('Aderência à meta',rmPc(ad),`vs programado até ${ddmm(dia)} · faltam ${f0(Math.max(0,a.prevT-a.realT))} t`,{cor:rmAdCor(ad)}))+`</div>`;
  p1+=rmSec('Produção realizada por material')+`<div class="rmg4">${MATS.map(([k])=>rmCard(RMN[k],f0(a.real[k]),`de ${f0(c.meta[k])} t programado · ${rmPc(c.meta[k]?a.real[k]/c.meta[k]:null)} do mês`,{top:RM.mat[k]})).join('')}</div>`;
  p1+=rmSec(`Produção do dia · ${dmy(dia)}`)+`<div class="rmg5">`+rmCard(visLiq()?'PARA APLICAÇÃO NO DIA':'TOTAL DO DIA',f0(o.tot),`meta do dia ${f0(o.metaT)} t · ${rmPc(o.metaT?o.tot/o.metaT:null)} da meta`,{top:RM.navy})
    +MATS.map(([k])=>rmCard(RMN[k],f0(o.real[k]),`meta ${f0(o.meta[k])} t · ${rmPc(o.meta[k]?o.real[k]/o.meta[k]:null)}`,{top:RM.mat[k]})).join('')+`</div>`;
  let pa=0,ra=0;const pAc=[],rAc=[];c.days.forEach(x=>{pa+=x.metaT;ra+=x.tot;pAc.push(pa);rAc.push(ate(x)?ra:null)});
  const sAc=[{v:pAc,c:RM.cinza,w:2},{v:rAc,c:RM.navy,w:2.4,m:true}],lAc=[{t:visLiq()?'Meta de atendimento acum.':'Meta Acumulada',c:RM.cinza},{t:visLiq()?'Rachão p/ aplicação acum.':'Realizado Acumulado',c:RM.navy}];
  if(tn){sAc.push({v:tn.proj,c:RM.navy,w:2,d:'2 4'});lAc.push({t:`Tendência: ${f0(tn.fim)} t`,c:RM.navy,d:'2 4'})}
  p1+=rmSec('Análises')+`<div class="rmg2 rmpan">`
    +rmColunas({W:520,H:262,grupos:MATS.map(([k])=>RMN[k]),series:[{t:'Meta até hoje',c:RM.cinza,v:MATS.map(([k])=>a.prev[k])},{t:'Realizado',c:RM.navy,v:MATS.map(([k])=>a.real[k])}],titulo:'Meta até hoje × Realizado - por material (t)',valores:true})
    +rmLinhas({W:520,H:262,series:sAc,dias,titulo:'Produção acumulada × meta acumulada (t)',leg:lAc})+`</div>`;

  /* página 2: ritmo + curvas S */
  const diasRest=c.days.filter(x=>x.w>0&&x.d>dia).length,media=a.diasFeitos?a.realT/a.diasFeitos:0,nec=diasRest?Math.max(0,c.metaT-a.realT)/diasRest:0,gap=media-nec;
  const crit=MATS.filter(([k])=>a.prev[k]>0).map(([k])=>({k,a:a.real[k]/a.prev[k]})).sort((x,y)=>x.a-y.a)[0];
  let p2=H1+rmSec('Ritmo de produção e alertas')+`<div class="rmg${tn?5:4}">`
    +rmCard('Média/dia realizada',f0(media),`em ${a.diasFeitos} dia(s) de produção (t/dia)`)
    +rmCard('Média/dia necessária',diasRest?f0(nec):'—',diasRest?`para bater a meta em ${diasRest} dias (t/dia)`:'não há dias programados restantes')
    +rmCard('Gap de ritmo',diasRest?f0(gap):'—',diasRest?(gap>=0?'ritmo suficiente (t/dia)':'acelerar produção (t/dia)'):'',{cor:diasRest?rmSaldoCor(gap):RM.txt})
    +rmCard('Material crítico',crit?RMN[crit.k]:'—',crit?`menor aderência: ${rmPc(crit.a)} da meta`:'')
    +(tn?rmCard('Tendência do mês',f0(tn.fim),`mantendo ${f0(tn.taxa)} t/dia programado · ${rmPc(c.metaT?tn.fim/c.metaT:null)} da meta`,{cor:rmAdCor(c.metaT?tn.fim/c.metaT:null)}):'')+`</div>`;
  p2+=rmSec('Curva S por material - previsto × realizado acumulado (t)')+`<div class="rmg2 rmpan rmcs">${MATS.map(([k])=>{let p=0,r=0;const pv=[],rv=[];c.days.forEach(x=>{p+=x.meta[k];r+=x.real[k];pv.push(p);rv.push(ate(x)?r:null)});
    const se=[{v:pv,c:RM.cinza,w:1.8},{v:rv,c:RM.mat[k],w:2.2,m:true}],lg=[{t:'Previsto Acum.',c:RM.cinza},{t:'Realizado Acum.',c:RM.mat[k]}];
    const t=PR.tend?prdTendAte(c,k,dia):null;if(t){se.push({v:t.proj,c:RM.mat[k],w:1.8,d:'2 4'});lg.push({t:`Tendência ${f0(t.fim)}`,c:RM.mat[k],d:'2 4'})}
    return rmLinhas({W:520,H:178,series:se,dias,titulo:`Curva S - ${RMN[k]}`,leg:lg})}).join('')}</div>`;

  /* página 3: memória diária */
  const meio=Math.ceil(c.days.length/2);
  const tab=lista=>`<table class="rmt"><thead><tr><th>Data</th>${MATS.map(([k])=>`<th>${RMN[k]}</th>`).join('')}<th>${visLiq()?'Aplicação dia':'Total dia'}</th><th>Meta dia</th><th>Desvio</th></tr></thead><tbody>${lista.map(x=>{const f=ate(x)&&x.tem,dv=x.tot-x.metaT,bar=f&&x.metaT?Math.max(0,Math.min(100,x.tot/Math.max(x.metaT,1)*100)):f?100:0;
    return `<tr><td>${ddmm(x.d)}</td>${MATS.map(([k])=>`<td>${f?(x.real[k]?f0(x.real[k]):'–'):''}</td>`).join('')}<td class="tb2"><i style="width:${bar}%"></i><span>${f?f0(x.tot):''}</span></td><td>${x.metaT?f0(x.metaT):'–'}</td><td style="color:${f?rmSaldoCor(dv):RM.sub}">${f?f0(dv):''}</td></tr>`}).join('')}</tbody></table>`;
  const H3=H1;
  let p3=H3+rmSec('Memória diária - quantidades realizadas por dia (t)')+`<div class="rmg2 rmpan rmmem">${tab(c.days.slice(0,meio))}${tab(c.days.slice(meio))}</div>`;

  /* página 4: rachão por equipamento */
  const H4=rmHead('ACOMPANHAMENTO DA PRODUÇÃO POR EQUIPAMENTO','BM10 (Britador Primário) · BMM05 (Lokotrack)',c,dia);
  const rr=a.eqReal.BM10+a.eqReal.BMM05,mr=c.meta.RACHAO,dT=c.days.filter(x=>ate(x)&&(x.eq.BM10+x.eq.BMM05)>0).length;
  let p4=H4+rmSec('Visão geral do mês - Rachão (BM10 + BMM05)')+`<div class="rmg5">`
    +rmCard('Programado do mês',f0(mr),'meta total dos 2 equipamentos (t)')+rmCard('Realizado acumulado',f0(rr),'produzido até o momento (t)')
    +rmCard('% atingimento do mês',rmPc(mr?rr/mr:null),'realizado ÷ programado mensal')+rmCard('Saldo vs meta',f0(rr-mr),'positivo = acima · negativo = abaixo (t)',{cor:rmSaldoCor(rr-mr)})
    +rmCard('Dias trabalhados',String(dT),'dias com produção no mês')+`</div>`;
  p4+=rmSec('Detalhe por equipamento')+`<div class="rmg2">${EQS.map(([e,n,s])=>{const r=a.eqReal[e],m=c.eqMeta[e],d=a.eqDias[e];
    return `<div class="rmeq" style="--tc:${RM.eq[e]}"><div class="rmct">${n} - ${s.toUpperCase()}</div><div class="rml" style="text-align:center;margin-top:8px">Realizado acumulado</div><div class="rmv" style="color:${RM.eq[e]};font-size:22pt;text-align:center">${f0(r)}</div><div class="rmsb" style="text-align:center">de ${f0(m)} t programado · ${rmPc(m?r/m:null)} do mês</div>
      <div class="rmg3">${rmCard('Saldo vs meta (t)',f0(r-m),'',{cor:rmSaldoCor(r-m)})}${rmCard('Média/dia (t)',d?f0(r/d):'—','')}${rmCard('Dias trab.',String(d),'')}</div></div>`}).join('')}</div>`;
  const mdR=o.meta.RACHAO;
  p4+=rmSec(`Produção do dia - ${dmy(dia)}`)+`<div class="rmg5">`+rmCard('TOTAL DO DIA',f0(o.eq.BM10+o.eq.BMM05),`meta do dia ${f0(mdR)} t · ${rmPc(mdR?(o.eq.BM10+o.eq.BMM05)/mdR:null)} da meta`,{top:RM.navy})
    +EQS.map(([e,n])=>{const m=mdR*c.fracEq(e);return rmCard(n,f0(o.eq[e]),`meta ${f0(m)} t · ${rmPc(m?o.eq[e]/m:null)}`,{top:RM.eq[e]})}).join('')+`</div>`;

  /* página 5: evolução por equipamento */
  let b1=0,b2=0,mm=0;const a1=[],a2=[],am=[];c.days.forEach(x=>{b1+=x.eq.BM10;b2+=x.eq.BMM05;mm+=x.meta.RACHAO*c.fracEq('BM10');a1.push(ate(x)?b1:null);a2.push(ate(x)?b2:null);am.push(mm)});
  const igual=Math.abs(c.fracEq('BM10')-.5)<1e-9;
  let p5=H4+rmSec('Evolução da produção')+`<div class="rmg2 rmpan">`
    +rmLinhas({W:520,H:340,series:[{v:a1,c:RM.eq.BM10,w:2.4},{v:a2,c:RM.eq.BMM05,w:2.4},{v:am,c:RM.cinza,w:1.6,d:'5 4'}],dias,titulo:'Produção acumulada - BM10 vs BMM05 (t)',leg:[{t:'BM10 acumulado',c:RM.eq.BM10},{t:'BMM05 acumulado',c:RM.eq.BMM05},{t:igual?'Meta acum. por equipamento':'Meta acum. BM10',c:RM.cinza,d:'5 4'}]})
    +rmColunas({W:520,H:340,grupos:dias.map(ddmm),series:[{t:'BM10 dia',c:RM.eq.BM10,v:c.days.map(x=>ate(x)?x.eq.BM10:0)},{t:'BMM05 dia',c:RM.eq.BMM05,v:c.days.map(x=>ate(x)?x.eq.BMM05:0)}],titulo:'Produção diária - BM10 vs BMM05 (t)',rot:true})+`</div>`;

  /* Balanço de material: de onde vem cada tonelada (finos saem do rachão do BM10; a sobra e o BMM05 vão para o estoque) */
  const sm=prdSaldo(c,dia),sd=prdSaldo(c,dia,true);
  const sk=(x,h)=>sankeySaldo(x,{W:1040,min:1040,H:h,lm:180,rm:220,cores:{bm10:'#0B2559',bmm05:RS.rMM,ant:RS.ant,rach:RS.rBM,sec:RS.finos,b1:RS.b1,po:RS.po,b2:RS.b2,txt:'#1B2B4B',sub:'#6B7487',faixa:.45}});
  const H6=rmHead('BALANÇO DE MATERIAL','Primário (BM10): parte é aplicada no secundário, a sobra vai para o estoque · Lokotrack (BMM05): todo para o estoque',c,dia);
  let p6=H6+rmSec(`Mês até ${dmy(dia)}`)+rmCardsSaldo(sm)+`<div class="rmpan rsbox rssk">${sk(sm,215)}</div>`
    +rmSec(`Dia ${dmy(dia)}`)+(sd.total||sd.finos?`<div class="rmpan rsbox rssk">${sk(sd,175)}</div>`:'<div class="rsnota">Sem produção lançada neste dia.</div>');

  /* Visão Estoque: última página com as premissas adotadas */
  const pgs=[p1,p2,p3,p4,p5,p6];
  if(visLiq())pgs.push(rmHead('PREMISSAS ADOTADAS','Visão estoque · atendimento do rachão (rachão para aplicação × meta de rachão)',c,dia)+rmPremissas(c,dia,sm,true));
  const pe=(n)=>`<div class="rmf"><span>Construtora Tripoloni Ltda. · Britagem Irati</span><span>Painel Horímetros Britagem · gerado em ${dtFmt.format(Date.now())}</span><span>página ${n} de ${pgs.length}</span></div>`;
  return pgs.map((p,i)=>`<section class="rmp">${p}${pe(i+1)}</section>`).join('');
}
/* Tendência calculada só com o que existia até o dia do relatório */
function prdTendAte(c,mat,dia){
  const val=o=>mat==='T'?o.tot:o.real[mat];let feito=0,w=0;c.days.forEach(o=>{if(o.d<=dia){feito+=val(o);w+=o.w}});
  if(!w||dia>=c.days[c.days.length-1].d)return null;const taxa=feito/w;let ac=feito;
  return {taxa,feito,proj:c.days.map(o=>{if(o.d<dia)return null;if(o.d>dia)ac+=taxa*o.w;return ac}),get fim(){return ac}};
}
/* ---------- Relatório de SALDO (balanço de material) ----------
   O rachão do BM10 é tudo o que o BM10 britou; os finos (Brita 01, Pó, Brita 02) saem de dentro dele e a
   sobra vai para o estoque. BMM05 só faz rachão (estoque). Britado = rachão BM10 + BMM05. */
const RS={rBM:'#0B2A5B',rMM:'#5B7FC4',finos:'#8A6BB8',b1:RM.mat.BRITA01,po:RM.mat.PO,b2:RM.mat.BRITA02,ant:'#98A2B3'};
function rmCardsSaldo(s){
  return `<div class="rmg5">`+rmCard('Britado total',f0(s.total),'rachão do primário + Lokotrack (t)')
    +rmCard('Rachão do primário',f0(s.rBM),`${fmtPc(pcS(s.rBM,s.total))} do britado`)
    +rmCard('Aplicado no secundário',f0(s.finos),s.consumo?'passou do rachão do primário':`${fmtPc(pcS(s.finos,s.rBM))} do rachão do primário`)
    +rmCard('Sobrou do primário (estoque)',fSin(s.saldoBM),s.consumo?'consumiu estoque anterior':`${fmtPc(pcS(s.sobra,s.rBM))} do rachão do primário`,{cor:s.saldoBM<0?RM.red:RM.txt})
    +rmCard('Estoque de rachão',fSin(s.saldoEst),`estoque primário + Lokotrack (${f0(s.rMM)} t)`,{cor:s.saldoEst<0?RM.red:RM.txt})+`</div>`;
}
/* colunas empilhadas por dia */
function rmEmpilhado({W=1060,H=230,dias,series,titulo}){
  const L=52,R=10,T=34,B=40,iw=W-L-R,ih=H-T-B,n=dias.length,gw=iw/n,bw=Math.min(18,gw*.7);
  const tot=dias.map((_,i)=>series.reduce((a,s)=>a+(s.v[i]||0),0)),max=Math.max(1,...tot),st=Math.pow(10,Math.floor(Math.log10(max)))/2,top=Math.ceil(max/st)*st,Y=v=>ih*v/top;
  let s=`<svg viewBox="0 0 ${W} ${H}" class="rmg"><text x="${W/2}" y="14" text-anchor="middle" class="tt">${titulo}</text>`;
  s+=`<g transform="translate(${W/2},27)">${series.map((l,i)=>`<g transform="translate(${(i-(series.length-1)/2)*170},0)"><rect x="-70" y="-8" width="9" height="9" fill="${l.c}"/><text x="-57" y="0" class="lg">${l.t}</text></g>`).join('')}</g>`;
  for(let k=0;k<=4;k++){const v=top*k/4,y=T+ih-Y(v);s+=`<line x1="${L}" x2="${W-R}" y1="${y}" y2="${y}" stroke="#E6EAF0"/><text x="${L-6}" y="${y+3}" text-anchor="end" class="ax">${f0(v)}</text>`}
  dias.forEach((d,i)=>{const x=L+gw*i+(gw-bw)/2;let y=T+ih;series.forEach(se=>{const h=Y(se.v[i]||0);if(h>0){y-=h;s+=`<rect x="${x}" y="${y+.5}" width="${bw}" height="${Math.max(.5,h-1)}" fill="${se.c}"/>`}});
    s+=`<text transform="translate(${L+gw*i+gw/2+3},${T+ih+8}) rotate(-60)" text-anchor="end" class="ax">${ddmm(d)}</text>`});
  return s+'</svg>';
}
function rmSaldoMontar(dia){
  const c=PR.c,o=c.byD[dia],sm=prdSaldo(c,dia);
  const H=rmHead('BALANÇO DE MATERIAL · SALDO','Primário (BM10): parte é aplicada no secundário, a sobra vai para o estoque · Lokotrack (BMM05): todo para o estoque',c,dia);
  const sk=s=>sankeySaldo(s,{W:1040,min:1040,H:250,lm:180,rm:220,cores:{bm10:'#0B2559',bmm05:RS.rMM,ant:RS.ant,rach:RS.rBM,sec:RS.finos,b1:RS.b1,po:RS.po,b2:RS.b2,txt:'#1B2B4B',sub:'#6B7487',faixa:.45}});
  /* dia por turno */
  const tu=t=>{const r=(o.eqTu[t]||{}).BM10||0,m=(o.eqTu[t]||{}).BMM05||0,b1=(o.tu[t]||{}).BRITA01||0,po=(o.tu[t]||{}).PO||0,b2=(o.tu[t]||{}).BRITA02||0,fi=b1+po+b2;return {rBM:r,rMM:m,b1,po,b2,finos:fi,saldoBM:r-fi,saldoEst:r-fi+m,total:r+m}};
  const sm2=(a,b)=>({rBM:a.rBM+b.rBM,rMM:a.rMM+b.rMM,b1:a.b1+b.b1,po:a.po+b.po,b2:a.b2+b.b2,finos:a.finos+b.finos,saldoBM:a.saldoBM+b.saldoBM,saldoEst:a.saldoEst+b.saldoEst,total:a.total+b.total});
  const neg=v=>v<0?` style="color:${RM.red}"`:'';
  const lt=(n,x,cl='')=>`<tr class="${cl}"><td>${n}</td><td>${f0(x.rBM)}</td><td>${f0(x.b1)}</td><td>${f0(x.po)}</td><td>${f0(x.b2)}</td><td>${f0(x.finos)}</td><td>${x.rBM?fmtPc(pcS(x.finos,x.rBM)):'—'}</td><td${neg(x.saldoBM)}>${fSin(x.saldoBM)}</td><td>${f0(x.rMM)}</td><td${neg(x.saldoEst)}><b>${fSin(x.saldoEst)}</b></td><td><b>${f0(x.total)}</b></td></tr>`;
  const t1=tu(1),t2=tu(2);
  const cab=`<thead><tr><th></th><th>Rachão primário</th><th>Brita 01</th><th>Pó</th><th>Brita 02</th><th>Aplicado no secundário</th><th>% aplicado</th><th>Sobra primário</th><th>Lokotrack</th><th>Estoque rachão</th><th>Britado</th></tr></thead>`;
  let p1=H+rmSec(`Mês até ${dmy(dia)}`)+rmCardsSaldo(sm)+`<div class="rmpan rsbox rssk">${sk(sm)}</div>`
    +rmSec(`Dia ${dmy(dia)} · por turno`)+`<table class="rmt rst2">${cab}<tbody>${lt('1º turno',t1)}${lt('2º turno',t2)}${lt('Total do dia',sm2(t1,t2),'tt')}</tbody></table>`;
  const dias=c.days.filter(x=>x.d<=dia),ser=dias.map(x=>prdSaldo(c,x.d,true));
  const graf=rmEmpilhado({W:1060,H:220,dias:dias.map(x=>x.d),titulo:'Saldo por dia (t)',series:[{t:'Aplicado no secundário',c:RS.finos,v:ser.map(s=>s.daBM10)},{t:'Sobrou do primário (estoque)',c:RS.rBM,v:ser.map(s=>s.sobra)},{t:'Lokotrack (estoque)',c:RS.rMM,v:ser.map(s=>s.rMM)}]});
  const linhas=dias.filter(x=>x.tem).map(x=>lt(`${ddmm(x.d)} ${WDN[wd(x.d)]}`,prdSaldo(c,x.d,true))).join('');
  let p2=H+rmSec('Saldo dia a dia')+`<div class="rmpan" style="flex:0 0 auto">${graf}</div><table class="rmt rst2">${cab}<tbody>${linhas}${lt('Total do mês',sm,'tt')}</tbody></table><div class="rsnota">Sobra negativa (em vermelho) = o secundário recebeu mais rachão do que o primário britou naquele dia: consumiu rachão do estoque do primário.</div>`;
  const p3=H+rmPremissas(c,dia,sm);
  const pe=n=>`<div class="rmf"><span>Construtora Tripoloni Ltda. · Britagem Irati</span><span>Painel Horímetros Britagem · gerado em ${dtFmt.format(Date.now())}</span><span>página ${n} de 3</span></div>`;
  return [p1,p2,p3].map((p,i)=>`<section class="rmp">${p}${pe(i+1)}</section>`).join('');
}
/* Página de premissas do relatório de saldo: explica de onde vem cada número e a conta do mês */
function rmPremissas(c,dia,s,prod){
  const m=c.m||{},mix=c.mix,pm=k=>mix&&+mix[k]>0?fmtPc(Math.round(+mix[k]*1000)/10):'—';
  let bm=0,mm=0,fi=0;c.days.forEach(o=>{if(o.d<=dia){bm+=o.eq.BM10;mm+=o.eq.BMM05;fi+=(o.real.BRITA01||0)+(o.real.PO||0)+(o.real.BRITA02||0)}});
  const ap=mm+Math.max(0,bm-fi);
  const metaR=c.meta.RACHAO,pl=+m.meta_rachao_palmeira||0,ir=+m.meta_rachao_irati||0;
  const eq=(a,op,b,r)=>`<div class="rpq"><span>${a}</span><i>${op}</i><span>${b}</span><i>=</i><span class="r">${r}</span></div>`;
  const bl=(n,t,x)=>`<div class="rpb"><b><em>${n}</em>${t}</b><p>${x}</p></div>`;
  return rmSec('Premissas adotadas')+`<div class="rprem">
  <div class="rpc"><div class="rms" style="margin:0 0 1.5mm">A conta do mês até ${dmy(dia)} (t)</div>
    ${eq(`Rachão do primário<b>${f0(s.rBM)}</b>`,'−',`Aplicado no secundário<b>${f0(s.finos)}</b>`,`Sobrou do primário<b>${fSin(s.saldoBM)}</b>`)}
    ${eq(`Sobrou do primário<b>${fSin(s.saldoBM)}</b>`,'+',`Lokotrack<b>${f0(s.rMM)}</b>`,`Estoque de rachão<b>${fSin(s.saldoEst)}</b>`)}
    ${eq(`Lokotrack<b>${f0(mm)}</b>`,'+',`Sobra do primário no mês (nunca negativa)<b>${f0(Math.max(0,bm-fi))}</b>`,`Rachão para aplicação<b>${f0(ap)}</b>`)}
    <div class="rpq rpm"><span>Rachão para aplicação<b>${f0(ap)}</b></span><i>÷</i><span>Meta de atendimento do mês<b>${f0(metaR)}</b></span><i>=</i><span class="r">Atendimento<b>${metaR?fmtPc(pcS(ap,metaR)):'—'}</b></span></div>
  </div>
  <div class="rpg">
    ${bl(1,'Origem dos números','Toneladas lançadas por turno a partir das balanças: rachão por equipamento (primário BM10 e Lokotrack BMM05) e os finos do secundário (Brita 01, Pó e Brita 02). Dia de produção das 07:30 às 07:30 do dia seguinte; o relatório vai do dia 1º do mês até a data do cabeçalho.')}
    ${bl(2,'Rachão do primário (BM10)','É tudo o que o primário britou. Esse rachão vai para o estoque que alimenta o secundário e também é carregado para aplicação.')}
    ${bl(3,'Lokotrack (BMM05)','Todo o rachão da Lokotrack vai para o estoque de aplicação. Ela nunca alimenta o secundário.')}
    ${bl(4,'Aplicado no secundário',`O secundário só recebe rachão do primário. O rachão aplicado no secundário é a soma dos finos produzidos (Brita 01 + Pó + Brita 02). O mix das balanças (Brita 01 ${pm('BRITA01')}, Pó ${pm('PO')}, Brita 02 ${pm('BRITA02')}) soma 100%: 1 t de rachão vira 1 t de finos. Não há desconto de perdas.`)}
    ${bl(5,'Sobrou do primário (estoque)','Rachão do primário − aplicado no secundário. Num dia pode ficar negativa (em vermelho): o secundário recebeu mais do que o primário britou e consumiu rachão já estocado do primário.')}
    ${bl(6,'Estoque de rachão','Estoque primário + Lokotrack. É o balanço físico do período e pode ficar negativo se o secundário consumir estoque formado antes do período.')}
    ${bl(7,'Rachão para aplicação (atendimento)','Lokotrack + sobra do primário acumulada no mês. A sobra do primário nunca entra negativa: se o secundário passou do que o primário britou, consumiu estoque antigo do primário, não o rachão da Lokotrack. Por isso pode diferir do estoque de rachão.'+(prod?' Neste relatório, o "Rachão p/ aplicação" por material, a curva S e a memória diária usam essa conta; as páginas por equipamento mostram o rachão bruto do primário e da Lokotrack.':''))}
    ${bl(8,'Meta de atendimento',`Meta de rachão cadastrada no mês: ${f0(metaR)} t${pl?` (Irati ${f0(ir)} t + Palmeira ${f0(pl)} t)`:''}. Não soma o rachão necessário para os finos (decisão da gerência em 20/11/2026). A meta do dia é distribuída nos dias programados: dia X peso 1, sábado XX peso ${String(Math.round((c.peso||0)*10000)/10000).replace('.',',')}. Meta por equipamento: primário ${fmtPc(Math.round(c.pctBM*1000)/10)} e Lokotrack ${fmtPc(Math.round((1-c.pctBM)*1000)/10)} da meta de rachão.`)}
    ${bl(9,'O que não está na conta','Estoque inicial do mês (não há medição de pilha), saídas e carregamentos do estoque (o relatório mostra o que ficou disponível, não o que foi expedido), perdas e umidade no secundário. Correções nos lançamentos mudam o relatório na próxima emissão.')}
  </div></div>`;
}
/* abre a impressão do relatório (Salvar como PDF) com o nome sugerido */
function rmImprimir(html,titulo){
  $('#prdRel').innerHTML=`<div class="rmw">${html}</div>`;
  const tit=document.title;document.title=titulo;document.body.classList.add('prelm');
  const fim=()=>{document.body.classList.remove('prelm');document.title=tit;window.removeEventListener('afterprint',fim)};window.addEventListener('afterprint',fim);
  setTimeout(()=>{window.print();setTimeout(fim,800)},80);
}
function diaDoRelatorio(){const c=PR.c;if(!c)return null;let dia=PR.dia;if(!c.byD[dia]||!c.byD[dia].tem)dia=c.ref;
  if(!dia)toast('Ainda não há lançamento neste mês para gerar o relatório.');return dia}
function prdExportar(){const dia=diaDoRelatorio();if(!dia)return;const [,mm,dd]=dia.split('-');rmImprimir(rmMontar(dia),`PRODUÇÃO ${dd}.${mm}`)}
function prdExportarSaldo(){const dia=diaDoRelatorio();if(!dia)return;const [,mm,dd]=dia.split('-');rmImprimir(rmSaldoMontar(dia),`SALDO ${dd}.${mm}`)}
$('#prdExport').onclick=()=>prdExportar();
$('#prdExportSaldo').onclick=()=>prdExportarSaldo();

/* ---------- Relatório de turnos em Excel (.xlsx) ----------
   Do dia 1 do mês até o dia escolhido em Produção do dia. Uma aba por área:
   Primário (rodando = AV10, produzido = rachão do BM10) e Secundário (rodando = CV07, produzido = finos).
   Turno h = início → fim do turno; Disp. h = turno sem as pausas. Mesmos números da aba Eficiência (rpc efi_dados).
   A biblioteca do Excel (SheetJS) só é baixada quando alguém exporta. */
let XLSX_P=null;
function xlsxLib(){
  if(window.XLSX)return Promise.resolve(window.XLSX);
  if(!XLSX_P)XLSX_P=new Promise((ok,ko)=>{const s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    s.onload=()=>window.XLSX?ok(window.XLSX):ko(new Error('xlsx'));s.onerror=()=>{XLSX_P=null;ko(new Error('Sem resposta do servidor (fetch)'))};document.head.appendChild(s)});
  return XLSX_P;
}
async function prdExportarTurnos(){
  const dia=diaDoRelatorio();if(!dia)return;
  const b=$('#prdExportTurnos'),txt=b.textContent;b.disabled=true;b.textContent='Gerando…';
  try{
    const ini=dia.slice(0,8)+'01';
    const [X,rows]=await Promise.all([xlsxLib(),rpc('efi_dados',{p_desde:ini,p_ate:dia})]);
    const wb=X.utils.book_new(),[y,mm,dd]=dia.split('-'),per=`${dmy(ini)} a ${dmy(dia)}`;
    const AREAS=[['Primário','AV10','av','tp','Rachão BM10 (t)'],['Secundário','CV07','cv','tf','Finos: brita 1, pó, brita 2 (t)']];
    AREAS.forEach(([nome,mot,kh,kt,lt])=>{
      const ls=(rows||[]).filter(r=>(+r[kt]>0)||(+r.ht>0));
      const aoa=[[`Produção da britagem · turnos · ${nome}`],[`Período: ${per} · rodando = ${mot} ligado · Construtora Tripoloni Ltda.`],[],
        ['Dia','Semana','Turno','Turno (h)','Disp. (h)',`Rodando ${mot} (h)`,lt]];
      ls.forEach(r=>{const [a,m,d]=r.dia.split('-').map(Number);
        aoa.push([new Date(Date.UTC(a,m-1,d,12)),DSEM[wd(r.dia)],`${r.turno}º`,+r.ht||0,+r.hd||0,+r[kh]||0,+r[kt]||0])});
      const L0=5,L1=4+ls.length; /* linhas de dados no Excel (1-based) */
      aoa.push(['Total','',`${ls.length} turnos`,...['D','E','F','G'].map(c=>ls.length?{f:`SUM(${c}${L0}:${c}${L1})`}:0)]);
      const ws=X.utils.aoa_to_sheet(aoa,{cellDates:true});
      for(let i=L0;i<=L1+1;i++){
        const c=ws['A'+i];if(c&&i<=L1){c.t='d';c.z='dd/mm/yyyy'}
        ['D','E','F'].forEach(k=>{if(ws[k+i])ws[k+i].z='0.00'});if(ws['G'+i])ws['G'+i].z='#,##0.0'}
      /* total já calculado, para quem abre no celular sem recalcular fórmula */
      if(ls.length)['D','E','F','G'].forEach((k,j)=>{const key=['ht','hd',kh,kt][j];const c=ws[k+(L1+1)];c.t='n';c.v=Math.round(ls.reduce((s,r)=>s+(+r[key]||0),0)*100)/100;c.z=k==='G'?'#,##0.0':'0.00'});
      ws['!cols']=[{wch:12},{wch:15},{wch:12},{wch:11},{wch:11},{wch:17},{wch:30}];
      ws['!merges']=[{s:{r:0,c:0},e:{r:0,c:6}},{s:{r:1,c:0},e:{r:1,c:6}}];
      ws['!autofilter']={ref:`A4:G${Math.max(L1,4)}`};
      X.utils.book_append_sheet(wb,ws,nome);
    });
    X.writeFile(wb,`TURNOS ${dd}.${mm}.${y}.xlsx`,{compression:true});
    toast(`Excel de turnos gerado (${per}).`);
  }catch(e){toast('Não foi possível gerar o Excel. '+errApp(e))}
  b.disabled=false;b.textContent=txt;
}
$('#prdExportTurnos').onclick=()=>prdExportarTurnos();
