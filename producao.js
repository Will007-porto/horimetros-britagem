/* ---------- PRODUÇÃO: acompanhamento diário (substitui a planilha ACOMPANHAMENTO_DIÁRIO_DA_PRODUÇÃO) ----------
   Dados: producao_mes (metas), producao_dia (calendário X/XX), producao_lanc (toneladas por dia/turno/material).
   Leitura: rpc prod_dados(p_mes). Gravação (só supervisor): prod_salvar_dia e prod_salvar_mes.
   Regra da meta diária igual à planilha: dia X pesa 1, sábado XX pesa peso_sabado (73,69%); meta do dia = meta do mês × peso ÷ soma dos pesos. */
const MATS=[['RACHAO','Rachão','var(--m1)'],['BRITA01','Brita 01','var(--m2)'],['PO','Pó de pedra','var(--m3)'],['BRITA02','Brita 02','var(--m4)']];
const MATN=Object.fromEntries(MATS.map(m=>[m[0],m[1]])),MATC=Object.fromEntries(MATS.map(m=>[m[0],m[2]]));
const EQS=[['BM10','BM10','Britador primário'],['BMM05','BMM05','Lokotrack']];
const MESN=['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
const mesTxt=m=>{const [y,mm]=m.split('-').map(Number);return `${MESN[mm-1]} / ${y}`};
const mesAdd=(m,n)=>{const [y,mm]=m.split('-').map(Number);return new Date(Date.UTC(y,mm-1+n,1)).toISOString().slice(0,10)};
const mesDe=d=>d.slice(0,7)+'-01';
const diasNoMes=m=>{const [y,mm]=m.split('-').map(Number);return new Date(Date.UTC(y,mm,0)).getUTCDate()};
const dmy=s=>{const [y,m,d]=s.split('-');return `${d}/${m}/${y}`};
const WDN=['dom','seg','ter','qua','qui','sex','sáb'];
const pc1=v=>(v*100).toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1})+'%';
const tnum=v=>(Math.round(v*100)/100).toLocaleString('pt-BR',{maximumFractionDigits:2});
const ehSup=()=>!!(EU.autorizado&&EU.papel==='supervisor');
/* Aderência: ≥100% no ritmo, ≥90% atenção, abaixo disso crítico. Sempre símbolo + texto. */
const stAd=a=>a==null?'':a>=1?`<span class="st ok">▲ ${pc1(a)}</span>`:a>=.9?`<span class="st at">● ${pc1(a)}</span>`:`<span class="st cr">▼ ${pc1(a)}</span>`;
const icoBox=p=>`<div class="ico"><svg viewBox="0 0 24 24">${p}</svg></div>`;
const chevS='<span class="chev"><svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg></span>';

let PR={mes:null,x:null,c:null,err:null,busy:false,dia:null,mat:'T',par:{},tab:false,tend:false};
try{PR.tend=localStorage.getItem('hb_tend')==='1'}catch(e){}
/* Visão do total: 'liq' = ESTOQUE, o atendimento do rachão: rachão disponível para aplicação = britado (rachão do BM10 + BMM05)
   menos o que o secundário transformou em finos (os finos saem do rachão do BM10). Comparado com a meta de rachão cadastrada.
   ou 'mat' = PRODUTIVIDADE, o que passou em cada etapa da planta (soma rachão + finos, como a planilha antiga). */
PR.vis='liq';try{if(localStorage.getItem('hb_prdvis')==='mat')PR.vis='mat'}catch(e){}
const visLiq=()=>PR.vis!=='mat';
/* Rachão que precisa ir para o secundário para cumprir as metas dos finos. 1 t de rachão vira os três finos ao
   mesmo tempo, no mix das balanças (fração de cada fino no total de finos, média ponderada do histórico).
   Então o material mais exigente (meta ÷ mix) define o volume: é o gargalo. O excedente dos outros vai para o estoque.
   Sem mix (sem histórico), cai na soma simples das metas. */
function rachParaFinos(mt,mix){
  const ks=['BRITA01','PO','BRITA02'],soma=ks.reduce((a,k)=>a+(+mt[k]||0),0);
  if(!mix||!ks.every(k=>+mix[k]>0))return {t:soma,garg:null,soma};
  let t=0,garg=null;ks.forEach(k=>{const v=(+mt[k]||0)/(+mix[k]);if(v>t){t=v;garg=k}});
  return {t,garg,soma};
}
const TXT_TOT=()=>visLiq()?{real:'Rachão p/ aplicação',prog:'Meta de atendimento do mês',dia:'Para aplicação no dia',col:'Aplicação',leg:'Rachão para aplicação acumulado (BMM05 + sobra do BM10 depois do secundário)',sub:'meta de rachão cadastrada'}
  :{real:'Realizado acumulado',prog:'Programado do mês',dia:'Total do dia',col:'Total',leg:'Realizado acumulado (produtividade: soma de todas as etapas)',sub:'soma das metas de todos os materiais'};

/* Tendência: mantém o ritmo já feito no mês (toneladas por dia programado, sábado com o peso dele)
   e projeta nos dias programados que faltam. Devolve o acumulado projetado dia a dia. */
function prdTend(c,mat){
  if(!c.ref)return null;
  const val=o=>mat==='T'?o.tot:o.real[mat];
  let feito=0,wAte=0;c.days.forEach(o=>{if(o.d<=c.ref){feito+=val(o);wAte+=o.w}});
  if(!wAte||c.ref>=c.days[c.days.length-1].d)return null;
  const taxa=feito/wAte;let ac=feito;
  const proj=c.days.map(o=>{if(o.d<c.ref)return null;if(o.d>c.ref)ac+=taxa*o.w;return ac});
  return {taxa,proj,fim:ac,feito};
}

async function prdLoad(mes,force,silencioso){
  if(!D)return;mes=mes||PR.mes||mesDe(D.hoje);
  if(PR.mes===mes&&PR.x&&!force){renderPrd();return}
  if(PR.mes!==mes){PR.x=null;PR.c=null;PR.tab=false}
  PR.mes=mes;PR.busy=true;PR.err=null;if(!PR.x)renderPrd();let igual=false;
  try{const x=await rpc('prod_dados',{p_mes:mes});if(PR.mes!==mes)return;
    /* Atualização automática sem mudança nos dados: não redesenha */
    if(silencioso&&PR.x&&typeof mesmoDado==='function'&&mesmoDado(x,PR.x)){igual=true;return}
    PR.x=x;PR.c=prdCalc(x,mes);if(force)PR.par={};
    if(!PR.dia||mesDe(PR.dia)!==mes)PR.dia=PR.c.ref||(mesDe(D.hoje)===mes?D.hoje:mes);
  }catch(e){if(PR.mes===mes)PR.err=e}
  finally{if(PR.mes===mes){PR.busy=false;if(!igual)renderPrd(!silencioso)}}
}

/* Na visão Estoque o material "Rachão" é o rachão para aplicação (o que virou finos sai da conta) */
function nomesVis(){const n=visLiq()?'Rachão p/ aplicação':'Rachão';MATS[0][1]=n;MATN.RACHAO=n;if(typeof RMN!=='undefined')RMN.RACHAO=visLiq()?'RACHÃO P/ APLICAÇÃO':'RACHÃO'}
function prdCalc(x,mes){
  nomesVis();
  const m=x.mes||null,n=diasNoMes(mes),peso=m?+m.peso_sabado:0.7369,pctBM=m?+m.pct_bm10:0.5;
  const meta={RACHAO:m?(+m.meta_rachao_irati)+(+m.meta_rachao_palmeira):0,BRITA01:m?+m.meta_brita01:0,PO:m?+m.meta_po:0,BRITA02:m?+m.meta_brita02:0};
  /* Visão Estoque: a meta de atendimento é a meta de rachão cadastrada (decisão da gerência em 20/11/2026:
     não somar o rachão necessário para os finos). O realizado é o rachão para aplicação: BMM05 + sobra do BM10 depois do secundário (21/11/2026). Na visão Produtividade, cada material tem a sua meta. */
  const metaRachUso=meta.RACHAO,rpf=rachParaFinos(meta,x.mix),metaFinos=rpf.t;
  const metaT=visLiq()?meta.RACHAO:MATS.reduce((a,[k])=>a+meta[k],0);
  const tipo={};(x.dias||[]).forEach(d=>tipo[d.dia]=d.tipo);
  const days=[];
  for(let i=0;i<n;i++){const d=addDays(mes,i),t=tipo[d]||null;
    days.push({d,t,w:t==='X'?1:t==='XX'?peso:0,real:{RACHAO:0,BRITA01:0,PO:0,BRITA02:0},tu:{1:{},2:{}},eq:{BM10:0,BMM05:0},eqTu:{1:{},2:{}},h:{AV10:0,CV07:0},tem:false,tot:0})}
  const W=days.reduce((a,o)=>a+o.w,0),byD=Object.fromEntries(days.map(o=>[o.d,o]));
  (x.horas||[]).forEach(([d,mo,hh])=>{const o=byD[d];if(o&&o.h[mo]!=null)o.h[mo]=+hh||0});
  (x.lanc||[]).forEach(l=>{const o=byD[l.dia];if(!o)return;const t=+l.t||0;o.tem=true;o.real[l.material]+=t;o.totMat=(o.totMat||0)+t;if(!visLiq()||l.material==='RACHAO')o.tot+=t;
    o.tu[l.turno][l.material]=(o.tu[l.turno][l.material]||0)+t;if(l.material==='RACHAO'){o.eq[l.equipamento]+=t;o.eqTu[l.turno][l.equipamento]=t}});
  /* Visão Estoque: rachão para aplicação = BMM05 (todo para o estoque de aplicação) + o que sobrou do BM10 depois do secundário.
     Os finos só saem do rachão do BM10 (soma dos finos = rachão que entrou no secundário, porque o mix soma 100%).
     No acumulado do mês a sobra do BM10 nunca fica negativa: se o secundário passou do BM10 britado, consumiu estoque antigo
     do BM10, não o rachão do BMM05. O valor do dia é a variação do acumulado, para a soma dos dias bater com o acumulado. */
  if(visLiq()){let bm=0,mm=0,fi=0,ant=0;days.forEach(o=>{bm+=o.eq.BM10;mm+=o.eq.BMM05;fi+=finosDia(o);
    const ac=mm+Math.max(0,bm-fi);o.consEst=Math.max(0,fi-bm);o.tot=ac-ant;ant=ac;o.rBruto=o.real.RACHAO;o.real.RACHAO=o.tot})}
  let pa=0,ra=0;
  days.forEach(o=>{o.meta={};MATS.forEach(([k])=>o.meta[k]=W?meta[k]*o.w/W:0);o.metaT=W?metaT*o.w/W:0;pa+=o.metaT;ra+=o.tot;o.prevAc=pa;o.realAc=ra});
  const feitos=days.filter(o=>o.tem),ref=feitos.length?feitos[feitos.length-1].d:null;
  const c={m,n,peso,pctBM,meta,metaT,metaRachUso,metaFinos,garg:rpf.garg,mix:x.mix||null,days,byD,W,ref,diasCom:feitos.length};
  Object.assign(c,prdAte(c,ref));
  c.diasProg=days.filter(o=>o.w>0).length;
  c.diasRest=days.filter(o=>o.w>0&&(!ref||o.d>ref)).length;
  /* Meta por equipamento: a meta de rachão dividida pelo % do BM10 cadastrado no mês */
  c.eqMeta={BM10:meta.RACHAO*pctBM,BMM05:meta.RACHAO*(1-pctBM)};
  c.fracEq=e=>meta.RACHAO?c.eqMeta[e]/meta.RACHAO:(e==='BM10'?pctBM:1-pctBM);
  return c;
}
/* Acumulados do mês até um dia (o painel usa o último dia lançado; o relatório usa o dia escolhido) */
function prdAte(c,dia){
  const ate=o=>!!dia&&o.d<=dia,real={},prev={};
  MATS.forEach(([k])=>{real[k]=c.days.filter(ate).reduce((a,o)=>a+o.real[k],0);prev[k]=c.days.filter(ate).reduce((a,o)=>a+o.meta[k],0)});
  const eqReal={},eqDias={};EQS.forEach(([e])=>{eqReal[e]=c.days.filter(ate).reduce((a,o)=>a+o.eq[e],0);eqDias[e]=c.days.filter(o=>ate(o)&&o.eq[e]>0).length});
  return {real,prev,realT:visLiq()?c.days.filter(ate).reduce((a,o)=>a+o.tot,0):MATS.reduce((a,[k])=>a+real[k],0),prevT:visLiq()?prev.RACHAO:MATS.reduce((a,[k])=>a+prev[k],0),
    diasFeitos:c.days.filter(o=>o.w>0&&ate(o)).length,eqReal,eqDias};
}

/* ---------- tela ---------- */
function renderPrd(anima){
  const sup=ehSup();$('#prdLancar').hidden=!sup;$('#prdMetas').hidden=!sup;
  const hoje=D?mesDe(D.hoje):null,ms=new Set(((PR.x&&PR.x.meses)||[]).map(m=>m.mes));
  if(hoje){ms.add(hoje);if(sup)ms.add(mesAdd(hoje,1))}if(PR.mes)ms.add(PR.mes);
  const lista=[...ms].sort(),ix=lista.indexOf(PR.mes);PR.lista=lista;
  $('#prdMes').innerHTML=lista.map(m=>`<option value="${m}" ${m===PR.mes?'selected':''}>${mesTxt(m)}</option>`).join('');
  $('#prdPrev').disabled=ix<=0;$('#prdNext').disabled=ix<0||ix>=lista.length-1;
  $('#prdMetas').textContent=PR.c&&PR.c.m?'Metas do mês':'Cadastrar metas';
  const B=$('#prdBody');
  if(!PR.c){$('#prdStamp').innerHTML='';$('#p-prd').classList.remove('carregado');
    B.innerHTML=PR.err?`<div class="box"><div class="pempty"><b>Não foi possível carregar a produção</b>${esc(errApp(PR.err))}<br><button class="btn1" type="button" data-prdre>Tentar de novo</button></div></div>`
      :`<div class="box"><div class="boxb" style="border:0;padding-top:16px"><span class="sr">Carregando a produção</span><div class="skel" style="width:40%;height:28px"></div><div class="skel" style="width:70%"></div><div class="skel" style="width:45%"></div></div></div>`;return}
  $('#p-prd').classList.add('carregado');
  const c=PR.c,ref=c.ref;
  $('#prdStamp').innerHTML=ref?`Atualizado até <b>${dmy(ref)}</b><br>${c.diasCom} ${c.diasCom===1?'dia lançado':'dias lançados'}`:'Sem lançamentos<br>neste mês';
  $('#prdPk').innerHTML=`${esc(mesTxt(PR.mes))}<br>${ref?'Atualizado até '+dmy(ref):'Sem lançamentos'}`;
  let h='';
  if(!c.m)h+=`<div class="warnb prdwarn"><span>As metas de <b>${esc(mesTxt(PR.mes))}</b> ainda não foram cadastradas. Sem elas não há programado, aderência nem curva S.</span>${sup?'<button class="act pri" type="button" data-prdmetas>Cadastrar metas</button>':'<span>Peça ao supervisor para cadastrar.</span>'}</div>`;

  /* visão geral do mês */
  const ad=c.prevT?c.realT/c.prevT:null,saldo=c.realT-c.metaT;
  h+=`<div class="kpis">`
    +kt(c.metaT,TXT_TOT().prog,'var(--navy2)',`${c.diasProg} dias programados · ${TXT_TOT().sub}`,'t')
    +kt(c.realT,TXT_TOT().real,'var(--m1)',c.metaT?`${pc1(c.realT/c.metaT)} da meta do mês`:'sem meta cadastrada','t')
    +kt(ad!=null?ad*100:0,'Aderência ao previsto',ad==null?'var(--off)':ad>=1?'var(--green)':ad>=.9?'var(--orange)':'var(--red)',ad!=null?`${ad>=1?'▲ no ritmo':ad>=.9?'● atenção':'▼ abaixo'} · previsto até ${ddmm(ref)}: ${f0(c.prevT)} t`:'sem previsto até agora','%',1)
    +kt(saldo,'Saldo vs meta do mês',saldo>=0?'var(--green)':'var(--red)',saldo>=0?'meta do mês superada':`faltam ${f0(-saldo)} t em ${c.diasRest} ${c.diasRest===1?'dia programado':'dias programados'}`,'t')
    +`</div>`;

  /* por material */
  h+=`<div class="box rv"><div class="boxh" style="cursor:default">${icoBox('<path d="M3 20h18M6 16l3-8 4 5 3-3 2 6"/>')}<div><div class="tt">Produção por material</div><div class="kk">Realizado × meta do mês${ref&&c.m?` · o traço marca o previsto até ${ddmm(ref)}`:''}</div></div></div>
    <div class="boxb"><div class="pmat">${MATS.map(([k,n,col])=>{const r=c.real[k],mt=c.meta[k],pv=c.prev[k];
      return `<div class="pm"><div class="pmh"><i style="background:${col}"></i>${n}</div><b>${f0(r)}<small>t</small></b>
        <div class="pmsub">${mt?`de ${f0(mt)} t · ${pc1(r/mt)} do mês`:'sem meta'}</div>
        <div class="bul" role="img" aria-label="${esc(`${n}: ${f0(r)} t de ${f0(mt)} t`)}" data-tip="${esc(`<div class='m'>${n}</div><b>${f0(r)} t realizadas</b><div class='tl'><span>Meta do mês</span><b>${f0(mt)} t</b></div><div class='tl'><span>Previsto até ${ref?ddmm(ref):'—'}</span><b>${f0(pv)} t</b></div><div class='tl'><span>Falta para a meta</span><b>${f0(Math.max(0,mt-r))} t</b></div>`)}"><div class="bulf" style="width:${mt?Math.min(100,r/mt*100):0}%;background:${col}"></div>${mt&&pv?`<div class="bult" style="left:${Math.min(100,pv/mt*100)}%"></div>`:''}</div>
        <div class="pmrow"><span>Aderência ao previsto</span>${pv?stAd(r/pv):'<span>—</span>'}</div></div>`}).join('')}</div></div></div>`;

  /* produção do dia (preenchido por renderPrdDia) */
  h+=`<div class="box rv" id="prdDiaBox"><div class="boxh" style="cursor:default">${icoBox('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>')}<div><div class="tt">Produção do dia</div><div class="kk" id="prdDiaK"></div></div></div><div class="boxb" id="prdDiaIn"></div></div>`;

  /* ritmo */
  const media=c.diasFeitos?c.realT/c.diasFeitos:0,nec=c.diasRest?Math.max(0,c.metaT-c.realT)/c.diasRest:0,gap=media-nec;
  const crit=MATS.filter(([k])=>c.prev[k]>0).map(([k,n])=>({k,n,a:c.real[k]/c.prev[k]})).sort((a,b)=>a.a-b.a)[0];
  h+=`<div class="box rv"><div class="boxh" style="cursor:default">${icoBox('<circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2h6"/>')}<div><div class="tt">Ritmo de produção</div><div class="kk">Média feita × média necessária para bater a meta</div></div></div>
    <div class="boxb"><div class="rstat">
      <div class="rs"><span>Média por dia realizada</span><b>${f0(media)}<small>t/dia</small></b><em>em ${c.diasFeitos} ${c.diasFeitos===1?'dia programado':'dias programados'} até ${ref?ddmm(ref):'agora'}</em></div>
      <div class="rs"><span>Média por dia necessária</span><b>${c.diasRest?f0(nec):'—'}<small>${c.diasRest?'t/dia':''}</small></b><em>${c.diasRest?`para bater a meta nos ${c.diasRest} dias programados que faltam`:'não há dias programados restantes'}</em></div>
      <div class="rs"><span>Diferença de ritmo</span><b>${c.diasRest?(gap>0?'+':'')+f0(gap):'—'}<small>${c.diasRest?'t/dia':''}</small></b><em>${!c.diasRest?(saldo>=0?'meta do mês superada':'mês encerrado abaixo da meta'):gap>=0?'<span class="st ok">▲ ritmo suficiente</span>':`<span class="st cr">▼ acelerar ${f0(-gap)} t/dia</span>`}</em></div>
      <div class="rs"><span>Material mais atrasado</span><b style="font-size:22px">${crit?esc(crit.n):'—'}</b><em>${crit?`menor aderência: ${stAd(crit.a)}`:'sem previsto até agora'}</em></div>
    </div>${(()=>{const t=prdTend(c,'T');return t&&c.metaT?`<p class="note">Mantendo o ritmo feito até ${ddmm(ref)} (${f0(t.taxa)} t por dia programado), o mês fecha em cerca de <b>${f0(t.fim)} t</b>: ${stAd(t.fim/c.metaT)} da meta${t.fim<c.metaT?`, faltariam ${f0(c.metaT-t.fim)} t`:''}. Veja a linha de tendência na curva S.</p>`:''})()}</div></div>`;

  /* curva S */
  h+=`<div class="box rv"><button class="boxh">${icoBox('<path d="M3 20c6 0 6-16 18-16"/>')}<div><div class="tt">Curva S · previsto × realizado</div><div class="kk">Acumulado do mês</div></div>${chevS}</button>
    <div class="cwrap"><div class="cinner"><div class="boxb"><div class="prdseg">${segHtml('prdMatSeg',[['T','Total'],...MATS.map(([k,n,col])=>[k,`<i style="background:${col}"></i>${n}`])],PR.mat)}<button type="button" class="pbtn tendb${PR.tend?' on':''}" data-prdtend aria-pressed="${PR.tend}" title="Projeta o fim do mês mantendo o ritmo já feito"><svg viewBox="0 0 24 24"><path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/></svg>Linha de tendência</button></div><div id="prdCurva">${prdCurva(c,PR.mat)}</div></div></div></div></div>`;

  /* por dia */
  h+=`<div class="box rv"><button class="boxh">${icoBox('<path d="M5 20V10M10 20V4M15 20v-7M20 20v-4"/>')}<div><div class="tt">Produção por dia</div><div class="kk">Toneladas por dia · traço = meta do dia · % = atendimento da meta</div></div>${chevS}</button>
    <div class="cwrap"><div class="cinner"><div class="boxb"><div id="prdBarsBloco">${prdBarrasBloco(c)}</div>
      <div class="prdtab"><button type="button" class="fclear" data-prdtab>${PR.tab?'Esconder a tabela dia a dia':'Ver a tabela dia a dia'}</button></div>
      <div class="scrollx" id="prdTab">${PR.tab?prdTabela(c):''}</div></div></div></div></div>`;

  /* toneladas × horas trabalhadas (só na visão Produtividade) */
  if(!visLiq())h+=`<div class="box rv"><button class="boxh">${icoBox('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>')}<div><div class="tt">Toneladas por hora trabalhada</div><div class="kk">Horas ligado do AV10 (primário · BM10) e do CV07 (secundário · finos) × toneladas lançadas</div></div>${chevS}</button>
    <div class="cwrap"><div class="cinner"><div class="boxb" id="prdHoraIn">${prdHoraBloco(c)}</div></div></div></div>`;

  /* saldo de material: BM10 = rachão que ficou rachão + finos do secundário; BMM05 à parte */
  h+=`<div class="box rv" id="prdSaldoBox"><button class="boxh">${icoBox('<path d="M4 6h16M4 12h10M4 18h6"/><path d="M17 15l3 3-3 3"/>')}<div><div class="tt">Saldo de material</div><div class="kk">Britado = BM10 (rachão + finos do secundário) + BMM05</div></div>${chevS}</button>
    <div class="cwrap"><div class="cinner"><div class="boxb" id="prdSaldoIn">${prdSaldoBloco(c)}</div></div></div></div>`;

  /* equipamentos + meses */
  h+=`<div class="two">
    <div class="box rv"><button class="boxh">${icoBox('<rect x="3" y="7" width="18" height="12" rx="2"/><path d="M7 7V5h10v2M7 13h4"/>')}<div><div class="tt">Rachão por equipamento</div><div class="kk">BM10 × BMM05 · meta ${Math.round(c.fracEq('BM10')*100)}% / ${Math.round(c.fracEq('BMM05')*100)}%</div></div>${chevS}</button>
      <div class="cwrap"><div class="cinner"><div class="boxb"><div class="pmat eq">${EQS.map(([e,n,s])=>{const r=c.eqReal[e],mt=c.eqMeta[e],dd=c.eqDias[e],pv=c.prev.RACHAO*c.fracEq(e);
        return `<div class="pm"><div class="pmh"><i style="background:var(--m1)"></i>${n} · ${s}</div><b>${f0(r)}<small>t</small></b><div class="pmsub">${mt?`de ${f0(mt)} t · ${pc1(r/mt)} do mês`:'sem meta'}</div>
        <div class="bul"><div class="bulf" style="width:${mt?Math.min(100,r/mt*100):0}%;background:var(--m1)"></div>${mt&&pv?`<div class="bult" style="left:${Math.min(100,pv/mt*100)}%"></div>`:''}</div>
        <div class="pmrow"><span>Saldo vs meta</span><b>${f0(r-mt)} t</b></div><div class="pmrow"><span>Média por dia trabalhado</span><b>${dd?f0(r/dd):'—'} t</b></div><div class="pmrow"><span>Dias trabalhados</span><b>${dd}</b></div></div>`}).join('')}</div>
        ${c.m?`<p class="note">Meta de rachão por obra: <b>Irati ${f0(+c.m.meta_rachao_irati)} t</b> · <b>Palmeira ${f0(+c.m.meta_rachao_palmeira)} t</b>.</p>`:''}</div></div></div></div>
    <div class="box rv"><button class="boxh">${icoBox('<path d="M4 6h16M4 12h16M4 18h16"/>')}<div><div class="tt">Comparativo dos meses</div><div class="kk">Programado × realizado</div></div>${chevS}</button>
      <div class="cwrap"><div class="cinner"><div class="boxb scrollx">${prdMeses()}</div></div></div></div>
  </div>`;
  const op=new Set($$('#prdBody .box.closed').map(b=>b.querySelector('.tt')&&b.querySelector('.tt').textContent));
  B.innerHTML=h;
  $$('#prdBody .box').forEach(b=>{const t=b.querySelector('.tt');if(t&&op.has(t.textContent))b.classList.add('closed')});
  renderPrdDia();
  if(PANE==='prd'){if(anima)reveal();else $$('#prdBody .rv').forEach(el=>{el.classList.add('in');el.querySelectorAll('.swipe').forEach(s=>s.classList.add('in'));el.querySelectorAll('[data-count]').forEach(e=>{const v=+e.dataset.count||0,dc=+e.dataset.dec||0;e.textContent=dc?v.toLocaleString('pt-BR',{minimumFractionDigits:dc,maximumFractionDigits:dc}):f0(v)})})}
}

/* Dia escolhido: tabela por turno e material + paradas do dia */
function prdTabelaDia(c,o){
  let h=`<table class="tb"><thead><tr><th>Material</th><th class="n">1º turno</th><th class="n">2º turno</th><th class="n">Total</th><th class="n hm">Meta</th><th class="n">vs meta</th></tr></thead><tbody>`;
  const cel=v=>v==null?'<span style="color:var(--muted)">—</span>':f0(v);
  const tuV=(t,k)=>{const v=o.tu[t][k];if(!visLiq()||k!=='RACHAO'||v==null)return v;return v-(o.tu[t].BRITA01||0)-(o.tu[t].PO||0)-(o.tu[t].BRITA02||0)};
  MATS.forEach(([k,n,col])=>{const a=tuV(1,k),b=tuV(2,k),r=o.real[k],mt=o.meta[k];
    h+=`<tr><td class="m"><span class="sw" style="background:${col}"></span>${n}</td><td class="n">${cel(a)}</td><td class="n">${cel(b)}</td><td class="n" style="font-weight:700;color:var(--ink)">${a==null&&b==null?cel(null):f0(r)}</td><td class="n hm">${mt?f0(mt):'—'}</td><td class="n">${mt&&(a!=null||b!=null)?stAd(r/mt):'—'}</td></tr>`;
    if(k==='RACHAO')EQS.forEach(([e,en,es])=>{const x=o.eqTu[1][e],y=o.eqTu[2][e];if(x==null&&y==null)return;
      h+=`<tr class="sb"><td>${en} · ${es}</td><td class="n">${cel(x)}</td><td class="n">${cel(y)}</td><td class="n">${f0((x||0)+(y||0))}</td><td class="n hm">${mt?f0(mt*c.fracEq(e)):'—'}</td><td class="n"></td></tr>`});
    if(k==='RACHAO'&&visLiq()&&o.tem){const f1=(o.tu[1].BRITA01||0)+(o.tu[1].PO||0)+(o.tu[1].BRITA02||0),f2=(o.tu[2].BRITA01||0)+(o.tu[2].PO||0)+(o.tu[2].BRITA02||0);
      h+=`<tr class="sb"><td>− Foi para o secundário (finos)</td><td class="n">${f0(-f1)}</td><td class="n">${f0(-f2)}</td><td class="n">${f0(-(f1+f2))}</td><td class="n hm"></td><td class="n"></td></tr>`;
      if(o.consEst>0)h+=`<tr class="sb"><td>Secundário acima do BM10 no mês (estoque antigo)</td><td class="n"></td><td class="n"></td><td class="n">${f0(o.consEst)}</td><td class="n hm"></td><td class="n"></td></tr>`}});
  const somaT=t=>visLiq()?(o.tu[t].RACHAO||0)-(o.tu[t].BRITA01||0)-(o.tu[t].PO||0)-(o.tu[t].BRITA02||0):MATS.reduce((a,[k])=>a+(o.tu[t][k]||0),0),t1=somaT(1),t2=somaT(2);
  h+=`<tr class="tot"><td>${visLiq()?'Para aplicação (BMM05 + sobra do BM10)':'Total'}</td><td class="n">${f0(t1)}</td><td class="n">${f0(t2)}</td><td class="n">${f0(o.tot)}</td><td class="n hm">${o.metaT?f0(o.metaT):'—'}</td><td class="n">${o.metaT&&o.tem?stAd(o.tot/o.metaT):'—'}</td></tr></tbody></table>`;
  return h;
}
function renderPrdDia(){
  const c=PR.c,box=$('#prdDiaIn');if(!c||!box)return;
  const o=c.byD[PR.dia]||c.days[0];PR.dia=o.d;const sup=ehSup(),fut=D&&o.d>D.hoje;
  const tp=o.t==='X'?'dia programado (X)':o.t==='XX'?'sábado programado (XX)':'dia sem produção programada';
  $('#prdDiaK').textContent=`${WDN[wd(o.d)]}, ${dmy(o.d)} · ${tp}`;
  const ix=c.days.indexOf(o);
  let h=`<div class="dayctl" style="margin-top:12px">
    <button type="button" data-prddia="-1" title="Dia anterior" ${ix<=0?'disabled':''}><svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg></button>
    <select id="prdDia" aria-label="Dia">${c.days.map(x=>`<option value="${x.d}" ${x.d===o.d?'selected':''}>${ddmm(x.d)} · ${WDN[wd(x.d)]}${x.t?' · '+x.t:''}${x.tem?'':' · sem lançamento'}</option>`).join('')}</select>
    <button type="button" data-prddia="1" title="Próximo dia" ${ix>=c.days.length-1?'disabled':''}><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></button>
    <button type="button" class="tog" data-prdrel ${o.tem?'':'disabled'} title="Relatório do dia em A4 para imprimir ou salvar em PDF">Relatório do dia</button>
    ${sup&&!fut?`<button type="button" class="tog" data-prdlanc>${o.tem?'Corrigir este dia':'Lançar este dia'}</button>`:''}</div>`;
  h+=`<div class="pdia"><div>`;
  if(o.tem)h+=`<div class="pdhero"><b>${f0(o.tot)}<small>t</small></b><span>${o.metaT?`meta do dia ${f0(o.metaT)} t`:'sem meta neste dia'}</span>${o.metaT?stAd(o.tot/o.metaT):''}</div>`+prdTabelaDia(c,o);
  else h+=`<div class="pempty"><b>${fut?'Dia ainda não chegou':'Sem lançamento neste dia'}</b>${o.metaT?`Meta do dia: ${f0(o.metaT)} t.`:''}${sup&&!fut?'<br><button class="btn1" type="button" data-prdlanc>Lançar este dia</button>':''}</div>`;
  h+=`</div><div class="pdpar">${prdParHtml(o.d)}</div></div>`;
  box.innerHTML=h;
  if($('#prdSaldoIn'))$('#prdSaldoIn').innerHTML=prdSaldoBloco(c); /* o saldo acompanha o dia escolhido */
  prdParadas(o.d);
}
async function prdParadas(dia){
  if(!dia||PR.par[dia])return;PR.par[dia]={busy:true};
  try{const [d]=await Promise.all([rpc('painel_paradas',{p_desde:dia,p_ate:dia,p_pendentes:false}),ensureCat()]);PR.par[dia]={rows:(d.rows||[]).map(normRow)}}
  catch(e){PR.par[dia]={err:e}}
  if(PR.dia===dia){const p=$('#prdBody .pdpar');if(p)p.innerHTML=prdParHtml(dia)}
}
const parMot=r=>{if(r.cod)return motNome(r.cod)+(r.eqc?' · '+r.eqc:'');const p=(r.cat||'').split(SEP);return p[p.length-1]||''};
function prdParHtml(dia){
  const p=PR.par[dia];
  if(!p||p.busy)return `<h5><span>Paradas do dia</span></h5><div class="skel" style="width:80%"></div><div class="skel" style="width:55%"></div>`;
  if(p.err)return `<h5><span>Paradas do dia</span></h5><p class="note">Não foi possível carregar as paradas: ${esc(errApp(p.err))}</p>`;
  const rows=p.rows.slice().sort((a,b)=>a.iniMs-b.iniMs),fech=rows.filter(r=>r.min!=null);
  const tot=fech.reduce((a,r)=>a+r.min,0)/60,sem=rows.filter(r=>r.s==='ag'||r.s==='ab').length;
  const porA={};rows.forEach(r=>{const a=areaOf(r);porA[a]=(porA[a]||0)+(r.min||0)/60});
  let h=`<h5><span>Paradas do dia (${rows.length})</span><a class="fclear" style="padding:0" data-prdpar="${dia}">Ver em Paradas</a></h5>`;
  if(!rows.length)return h+`<p class="note">Nenhuma parada registrada pelos sensores neste dia.</p>`;
  h+=`<div class="pdsum"><span class="chip">${hm(tot)} parado</span>${Object.entries(porA).filter(([,v])=>v>0).map(([a,v])=>`<span class="chip">${esc(AREA_N[a]||a)} ${hm(v)}</span>`).join('')}${sem?`<span class="chip sem"><i></i>${sem} sem justificativa</span>`:''}</div>`;
  const top=rows.slice().sort((a,b)=>(b.min||0)-(a.min||0)).slice(0,8).sort((a,b)=>a.iniMs-b.iniMs);
  h+=`<table class="tb"><thead><tr><th>Equip.</th><th>Início</th><th class="n">Duração</th><th>Motivo</th></tr></thead><tbody>${top.map(r=>`<tr><td class="m">${esc(r.mo)}</td><td style="white-space:nowrap">${dtFmt.format(r.iniMs).split(' ')[1]||''}</td><td class="n">${r.min!=null?hm(r.min/60):'aberta'}</td><td>${r.cat||r.cod?esc(parMot(r)):'<span style="color:var(--orange);font-weight:600">sem justificativa</span>'}</td></tr>`).join('')}</tbody></table>`;
  if(rows.length>top.length)h+=`<p class="note">Mostrando as ${top.length} maiores. Lista completa na aba Paradas.</p>`;
  return h;
}

/* Curva S: uma escala só; previsto tracejado, realizado na cor do material */
function prdCurva(c,mat){
  const W=Math.max(560,largGraf(false)),H=250,L=56,R=104,T=14,Bo=28,iw=W-L-R,ih=H-T-Bo,n=c.days.length;
  const col=mat==='T'?'var(--P)':MATC[mat];
  let pa=0,ra=0;const pts=c.days.map(o=>{pa+=mat==='T'?o.metaT:o.meta[mat];ra+=mat==='T'?o.tot:o.real[mat];return {d:o.d,p:pa,r:ra,ok:!!c.ref&&o.d<=c.ref}});
  const metaM=mat==='T'?c.metaT:c.meta[mat],tn=PR.tend?prdTend(c,mat):null;
  const max=Math.max(1,metaM,...pts.map(p=>p.r),tn?tn.fim:0),step=Math.pow(10,Math.floor(Math.log10(max)))/2,top=Math.ceil(max/step)*step;
  const X=i=>L+iw*(i+.5)/n,Y=v=>T+ih-ih*v/top;
  let s=`<svg class="ch swipe" viewBox="0 0 ${W} ${H}" style="max-width:${W}px" role="img" aria-label="Curva S de ${esc(mat==='T'?'todos os materiais':MATN[mat])}">`;
  [0,.25,.5,.75,1].forEach(f=>{const y=Y(top*f);s+=`<line class="gl" x1="${L}" x2="${L+iw}" y1="${y}" y2="${y}"/><text class="ax" x="${L-8}" y="${y+3}" text-anchor="end">${f0(top*f)}</text>`});
  const stp=Math.max(1,Math.ceil(n/10));c.days.forEach((o,i)=>{if(i%stp===0||i===n-1)s+=`<text class="ax" x="${X(i)}" y="${H-8}" text-anchor="middle">${ddmm(o.d)}</text>`});
  if(metaM){s+=`<path class="ln" d="${pts.map((p,i)=>(i?'L':'M')+X(i).toFixed(1)+' '+Y(p.p).toFixed(1)).join('')}" stroke="var(--muted)" stroke-dasharray="6 5"/>`;
    s+=`<text class="vl" x="${X(n-1)+8}" y="${Y(pts[n-1].p)+4}" fill="var(--grey)">meta ${f0(metaM)}</text>`}
  const rr=pts.filter(p=>p.ok);
  if(rr.length){s+=`<path class="ln" d="${rr.map((p,i)=>(i?'L':'M')+X(i).toFixed(1)+' '+Y(p.r).toFixed(1)).join('')}" stroke="${col}"/>`;
    const li=rr.length-1;s+=`<circle cx="${X(li)}" cy="${Y(rr[li].r)}" r="4.5" fill="${col}" stroke="var(--card)" stroke-width="2"/><text class="vl" x="${X(li)+9}" y="${Y(rr[li].r)-6}" fill="var(--ink)">${f0(rr[li].r)}</text>`}
  if(tn){const tp=tn.proj.map((v,i)=>v==null?null:[X(i),Y(v)]).filter(Boolean);
    /* Ao ligar o botão, a linha é desenhada aos poucos da esquerda para a direita (uma máscara que se abre),
       e o ponto final com o valor aparece quando ela chega. Sem animação se o sistema pede movimento reduzido. */
    const q=tp[tp.length-1],anim=PR.tendAnim&&!matchMedia('(prefers-reduced-motion:reduce)').matches,DUR=1.4;PR.tendAnim=false;
    const cid='tclip'+Date.now(),x0=tp[0][0]-3,wF=q[0]-x0+12;
    if(anim)s+=`<clipPath id="${cid}"><rect x="${x0}" y="0" width="0" height="${H}"><animate attributeName="width" from="0" to="${wF}" dur="${DUR}s" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines=".3 .1 .3 1"/></rect></clipPath>`;
    s+=`<path class="ln" d="${tp.map((q,i)=>(i?'L':'M')+q[0].toFixed(1)+' '+q[1].toFixed(1)).join('')}" stroke="${col}" stroke-dasharray="2 5" stroke-width="2.5" opacity=".85"${anim?` clip-path="url(#${cid})"`:''}/>`;
    s+=`<g${anim?' opacity="0"':''}>${anim?`<animate attributeName="opacity" from="0" to="1" begin="${DUR-.15}s" dur=".35s" fill="freeze"/>`:''}<circle cx="${q[0]}" cy="${q[1]}" r="4" fill="var(--card)" stroke="${col}" stroke-width="2"/><text class="vl" x="${q[0]+8}" y="${q[1]+(Math.abs(q[1]-Y(pts[n-1].p))<14?16:4)}" fill="var(--ink)">tend. ${f0(tn.fim)}</text></g>`}
  pts.forEach((p,i)=>{const dif=p.r-p.p,pj=tn&&tn.proj[i]!=null&&!p.ok?tn.proj[i]:null;
    s+=`<g class="dy" data-tip="${esc(`<div class='m'>${ddmm(p.d)} · ${WDN[wd(p.d)]}</div><div class='tl'><span>Previsto acumulado</span><b>${f0(p.p)} t</b></div>${p.ok?`<div class='tl'><span>Realizado acumulado</span><b>${f0(p.r)} t</b></div><div class='tl'><span>Diferença</span><b>${dif>=0?'+':''}${f0(dif)} t</b></div>`:''}${pj!=null?`<div class='tl'><span>Tendência acumulada</span><b>${f0(pj)} t</b></div>`:''}`)}"><line class="hl" x1="${X(i)}" x2="${X(i)}" y1="${T}" y2="${T+ih}"/><rect class="hv" x="${L+iw*i/n}" y="${T}" width="${iw/n}" height="${ih}"/></g>`});
  s+='</svg>';
  return s+`<div class="leg"><span><i style="background:${col}"></i>${mat==='T'?TXT_TOT().leg:'Realizado acumulado · '+MATN[mat]}</span><span><i style="background:none;border-top:2px dashed var(--muted);height:0;border-radius:0;width:16px;vertical-align:3px"></i>Previsto acumulado (meta distribuída nos dias X e XX)</span>${tn?`<span><i style="background:none;border-top:2.5px dotted ${col};height:0;border-radius:0;width:16px;vertical-align:3px"></i>Tendência: ritmo feito (${f0(tn.taxa)} t por dia programado) até o fim do mês → <b style="color:var(--ink)">${f0(tn.fim)} t</b>${metaM?` (${pc1(tn.fim/metaM)} da meta)`:''}</span>`:''}</div>`;
}
/* Barras empilhadas por dia, 2px de folga entre materiais; traço da meta do dia */
/* Filtro do gráfico por dia: Total (empilhado) ou um material; no rachão, BM10 / BMM05 separados.
   A meta acompanha o filtro e cada barra mostra o atendimento da meta do dia. */
function prdBarrasBloco(c){
  const bm=PR.bm||'T',be=bm==='RACHAO'?(PR.be||'AMB'):'AMB';
  const segM=segHtml('prdBarMat',[['T','Total'],...MATS.map(([k,n,col])=>[k,`<i style="background:${col}"></i>${n}`])],bm);
  const segE=bm==='RACHAO'?segHtml('prdBarEq',[['AMB','Os dois'],['BM10','BM10 · Primário'],['BMM05','BMM05 · Lokotrack']],be):'';
  return `<div class="prdbarf">${segM}${segE}</div><div class="scrollx">${bm==='T'?prdBarras(c):prdBarrasMat(c,bm,be)}</div>${prdAtendResumo(c,bm,be)}`;
}
/* valor, meta e cor de um dia conforme o filtro */
function prdSerie(c,bm,be){
  const pct=e=>c.fracEq(e);
  return c.days.map(o=>{
    if(bm==='T')return {o,v:o.tot,m:o.metaT};
    if(bm==='RACHAO'&&be!=='AMB')return {o,v:o.eq[be],m:o.meta.RACHAO*pct(be)};
    return {o,v:o.real[bm],m:o.meta[bm]};
  });
}
function prdAtendResumo(c,bm,be){
  const ser=prdSerie(c,bm,be).filter(x=>x.o.tem&&x.m>0);if(!ser.length)return '';
  const v=ser.reduce((a,x)=>a+x.v,0),m=ser.reduce((a,x)=>a+x.m,0),ok=ser.filter(x=>x.v>=x.m).length;
  const nome=bm==='T'?(visLiq()?'estoque: rachão para aplicação (BMM05 + sobra do BM10)':'produtividade: soma de todas as etapas'):bm==='RACHAO'&&be!=='AMB'?`rachão no ${be}`:MATN[bm].toLowerCase();
  return `<p class="note">Atendimento da meta nos dias programados lançados (${esc(nome)}): ${stAd(v/m)} · ${f0(v)} t de ${f0(m)} t · <b>${ok}</b> de ${ser.length} ${ser.length===1?'dia':'dias'} na meta ou acima.</p>`;
}
/* Um material só (ou o rachão por equipamento): barras simples, meta do material, % por dia */
function prdBarrasMat(c,bm,be){
  const ser=prdSerie(c,bm,be),dois=bm==='RACHAO'&&be==='AMB'&&!visLiq();
  const n=c.days.length,L=48,W=Math.max(L+n*18,largGraf(false)),H=250,T=26,Bo=28,cw=(W-L)/n,ih=H-T-Bo;
  const max=Math.max(1,...ser.map(x=>Math.max(x.v,x.m))),step=Math.pow(10,Math.floor(Math.log10(max)))/2,top=Math.ceil(max/step)*step;
  const Y=v=>ih*v/top,col=MATC[bm],corEq={BM10:'var(--m1)',BMM05:'var(--m3)'};
  let s=`<svg class="ch swipe" viewBox="0 0 ${W} ${H}" style="min-width:${Math.min(W,n*18+L)}px;max-width:${W}px" role="img" aria-label="Produção por dia de ${esc(MATN[bm])}">`;
  [0,.5,1].forEach(f=>{const y=T+ih-Y(top*f);s+=`<line class="gl" x1="${L}" x2="${W}" y1="${y}" y2="${y}"/><text class="ax" x="${L-6}" y="${y+3}" text-anchor="end">${f0(top*f)}</text>`});
  const stp=Math.max(1,Math.ceil(46/cw));
  ser.forEach(({o,v,m},i)=>{const x=L+i*cw,bw=Math.min(30,cw*.66),bx=x+(cw-bw)/2,at=o.tem&&m>0?v/m:null;
    const linhasEq=bm==='RACHAO'?EQS.map(([e,en])=>`<div class='tl'><span>${en}</span><b>${f0(o.eq[e])} t</b></div>`).join(''):'';
    const tip=`<div class='m'>${ddmm(o.d)} · ${WDN[wd(o.d)]}${o.t?' · '+o.t:''} · ${MATN[bm]}${bm==='RACHAO'&&be!=='AMB'?' '+be:''}</div><b>${o.tem?f0(v)+' t':'Sem lançamento'}</b>${dois?linhasEq:''}${m?`<div class='tl'><span>Meta do dia</span><b>${f0(m)} t</b></div>`:''}${at!=null?`<div class='tl'><span>Atendimento</span><b>${pc1(at)}</b></div>`:''}`;
    s+=`<g class="bd" data-dia="${o.d}" data-tip="${esc(tip)}"><rect class="bg" x="${x}" y="${T}" width="${cw}" height="${ih}" fill="transparent" rx="3"/>`;
    if(v>0){
      if(dois){/* BM10 embaixo, BMM05 em cima, 2px de folga */
        const h1=Y(o.eq.BM10),h2=Y(o.eq.BMM05);let y=T+ih;
        if(h1>0){y-=h1;s+=`<rect x="${bx}" y="${y+(h2>0?2:0)}" width="${bw}" height="${Math.max(1,h1-(h2>0?2:0))}" fill="${corEq.BM10}" rx="${h2>0?0:3}"/>`}
        if(h2>0){y-=h2;s+=`<rect x="${bx}" y="${y}" width="${bw}" height="${Math.max(1,h2)}" fill="${corEq.BMM05}" rx="3"/>`}
      }else{const hh=Y(v);s+=`<rect x="${bx}" y="${T+ih-hh}" width="${bw}" height="${Math.max(1,hh)}" fill="${be!=='AMB'?corEq[be]:col}" rx="3"/>`}
    }
    if(m){const ym=T+ih-Y(m);s+=`<line x1="${x+cw*.08}" x2="${x+cw*.92}" y1="${ym}" y2="${ym}" stroke="var(--ink)" stroke-width="2" stroke-linecap="round"/>`}
    if(at!=null&&cw>=24){const yt=T+ih-Math.max(Y(v),Y(m))-6;s+=`<text x="${x+cw/2}" y="${Math.max(10,yt)}" text-anchor="middle" style="font:700 ${cw>=34?10.5:9}px var(--mono)" fill="${at>=1?'var(--ok)':at>=.9?'var(--at)':'var(--cr)'}">${at>=1?'▲':'▼'}${Math.round(at*100)}%</text>`}
    s+='</g>';
    if(i%stp===0)s+=`<text class="ax" x="${x+cw/2}" y="${H-8}" text-anchor="middle" ${o.d===PR.dia?'fill="var(--ink)" style="font-weight:700"':''}>${ddmm(o.d)}</text>`});
  const leg=dois?`<span><i style="background:${corEq.BM10}"></i>BM10 · Primário</span><span><i style="background:${corEq.BMM05}"></i>BMM05 · Lokotrack</span>`:`<span><i style="background:${be!=='AMB'?corEq[be]:col}"></i>${MATN[bm]}${be!=='AMB'?' · '+be:''}</span>`;
  return s+'</svg>'+`<div class="leg">${leg}<span><i style="background:var(--ink);height:2px;border-radius:1px;vertical-align:3px"></i>Meta do dia${bm==='RACHAO'&&be!=='AMB'?` (${Math.round(c.fracEq(be)*100)}% da meta de rachão)`:''}</span><span>▲ % = atendimento da meta do dia</span></div>`;
}
/* Barras por dia. Produtividade: um bloco por material (rachão inteiro + finos).
   Estoque: só o rachão que ficou para aplicação (BMM05 + sobra do BM10), comparado com a meta do dia. O tooltip abre BMM05, BM10 e os finos. */
const SEG_EST=['EST','Rachão para aplicação',MATC.RACHAO];
const finosDia=o=>(o.real.BRITA01||0)+(o.real.PO||0)+(o.real.BRITA02||0);
function prdBarras(c){
  const liq=visLiq(),SEGS=liq?[SEG_EST]:MATS,vS=(o,k)=>k==='EST'?Math.max(0,o.tot):o.real[k],cS=k=>k==='EST'?SEG_EST[2]:MATC[k];
  const n=c.days.length,L=48,W=Math.max(L+n*18,largGraf(false)),H=230,T=12,Bo=28,cw=(W-L)/n,ih=H-T-Bo;
  const max=Math.max(1,...c.days.map(o=>Math.max(o.tot,o.metaT))),step=Math.pow(10,Math.floor(Math.log10(max)))/2,top=Math.ceil(max/step)*step;
  const Y=v=>ih*v/top;
  let s=`<svg class="ch swipe" viewBox="0 0 ${W} ${H}" style="min-width:${Math.min(W,n*18+L)}px;max-width:${W}px" role="img" aria-label="Produção por dia">`;
  [0,.5,1].forEach(f=>{const y=T+ih-Y(top*f);s+=`<line class="gl" x1="${L}" x2="${W}" y1="${y}" y2="${y}"/><text class="ax" x="${L-6}" y="${y+3}" text-anchor="end">${f0(top*f)}</text>`});
  const stp=Math.max(1,Math.ceil(46/cw));
  c.days.forEach((o,i)=>{const x=L+i*cw,bw=Math.min(30,cw*.66),bx=x+(cw-bw)/2;let y=T+ih;
    const tip=`<div class='m'>${ddmm(o.d)} · ${WDN[wd(o.d)]}${o.t?' · '+o.t:''}</div><b>${o.tem?f0(o.tot)+' t'+(liq?' para aplicação':''):'Sem lançamento'}</b>${liq?(o.tem?`<div class='tl'><span>Rachão BMM05</span><b>${f0(o.eq.BMM05)} t</b></div><div class='tl'><span>Rachão BM10</span><b>${f0(o.eq.BM10)} t</b></div><div class='tl'><span>Foi para o secundário (finos)</span><b>− ${f0(finosDia(o))} t</b></div>${o.consEst>0?`<div class='tl'><span>Secundário acima do BM10 no mês</span><b>${f0(o.consEst)} t do estoque antigo</b></div>`:''}`:''):SEGS.filter(([k])=>vS(o,k)>0).map(([k,nm])=>`<div class='tl'><span>${nm}</span><b>${f0(vS(o,k))} t</b></div>`).join('')}${o.metaT?`<div class='tl'><span>Meta do dia</span><b>${f0(o.metaT)} t</b></div>`:''}`;
    s+=`<g class="bd" data-dia="${o.d}" data-tip="${esc(tip)}"><rect class="bg" x="${x}" y="${T}" width="${cw}" height="${ih}" fill="transparent" rx="3"/>`;
    const segs=SEGS.filter(([k])=>vS(o,k)>0);
    segs.forEach(([k],j)=>{const hh=Y(vS(o,k));const g=j<segs.length-1?2:0,top1=j===segs.length-1;const hv=Math.max(1,hh-g);y-=hh;
      s+=top1?`<path d="M${bx} ${y+hv+g}V${y+g+Math.min(4,hv)}q0 -4 4 -4h${bw-8}q4 0 4 4V${y+hv+g}Z" fill="${cS(k)}" transform="translate(0,${-g})"/>`:`<rect x="${bx}" y="${y+g}" width="${bw}" height="${hv}" fill="${cS(k)}"/>`});
    if(o.metaT){const ym=T+ih-Y(o.metaT);s+=`<line x1="${x+cw*.08}" x2="${x+cw*.92}" y1="${ym}" y2="${ym}" stroke="var(--ink)" stroke-width="2" stroke-linecap="round"/>`}
    s+='</g>';
    if(i%stp===0)s+=`<text class="ax" x="${x+cw/2}" y="${H-8}" text-anchor="middle" ${o.d===PR.dia?'fill="var(--ink)" style="font-weight:700"':''}>${ddmm(o.d)}</text>`});
  return s+'</svg>'+`<div class="leg">${SEGS.map(([k,n])=>`<span><i style="background:${cS(k)}"></i>${n}</span>`).join('')}<span><i style="background:var(--ink);height:2px;border-radius:1px;vertical-align:3px"></i>${liq?'Meta de atendimento do dia':'Meta do dia'}</span><span style="color:var(--muted)">Clique num dia para ver o detalhe</span></div>`;
}
function prdTabela(c){
  let h=`<table class="tb"><thead><tr><th>Dia</th>${MATS.map(([,n])=>`<th class="n">${n}</th>`).join('')}<th class="n">${TXT_TOT().col}</th><th class="n">Meta</th><th class="n">Desvio</th></tr></thead><tbody>`;
  c.days.filter(o=>o.w>0||o.tem).forEach(o=>{const dv=o.tot-o.metaT;
    h+=`<tr><td class="m">${ddmm(o.d)}<span class="sub">${WDN[wd(o.d)]}${o.t?' · '+o.t:''}</span></td>${MATS.map(([k])=>`<td class="n">${o.tem?f0(o.real[k]):'—'}</td>`).join('')}<td class="n" style="font-weight:700;color:var(--ink)">${o.tem?f0(o.tot):'—'}</td><td class="n">${o.metaT?f0(o.metaT):'—'}</td><td class="n" style="color:${!o.tem?'var(--muted)':dv>=0?'var(--ok)':'var(--cr)'}">${o.tem?(dv>=0?'▲ +':'▼ ')+f0(dv):'—'}</td></tr>`});
  h+=`<tr class="tot"><td>Total</td>${MATS.map(([k])=>`<td class="n">${f0(c.real[k])}</td>`).join('')}<td class="n">${f0(c.realT)}</td><td class="n">${f0(c.metaT)}</td><td class="n">${f0(c.realT-c.metaT)}</td></tr></tbody></table>`;
  return h;
}
/* ---------- SALDO DE MATERIAL ----------
   O rachão do BM10 lançado é TUDO o que o BM10 britou. Os finos do secundário (Brita 01, Pó, Brita 02)
   saem de dentro desse rachão; o que sobra vai para o estoque de rachão. O BMM05 só faz rachão (estoque).
   Britado total = rachão do BM10 + BMM05.  Estoque de rachão = sobra do BM10 + BMM05.
   Se num período os finos passam do rachão britado no BM10, o secundário consumiu rachão do estoque anterior. */
function prdSaldo(c,dia,soDia){
  const dd=c.days.filter(o=>soDia?o.d===dia:(!dia||o.d<=dia));const s={rBM:0,rMM:0,b1:0,po:0,b2:0};
  dd.forEach(o=>{s.rBM+=o.eq.BM10;s.rMM+=o.eq.BMM05;s.b1+=o.real.BRITA01;s.po+=o.real.PO;s.b2+=o.real.BRITA02});
  s.finos=s.b1+s.po+s.b2;s.bm10=s.rBM;
  s.saldoBM=s.rBM-s.finos;                 /* com sinal: negativo = consumiu estoque */
  s.sobra=Math.max(0,s.saldoBM);s.consumo=Math.max(0,-s.saldoBM);s.daBM10=Math.min(s.finos,s.rBM);
  s.total=s.rBM+s.rMM;s.estoque=s.sobra+s.rMM;s.saldoEst=s.saldoBM+s.rMM;
  return s;
}
const pcS=(a,b)=>b?Math.round(a*1000/b)/10:0;
const fmtPc=v=>v.toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1})+'%';
const fSin=v=>(v<0?'−':'')+f0(Math.abs(v));
/* Diagrama de Sankey do saldo: BMM05 e BM10 à esquerda. Do rachão do BM10, uma faixa vai para o
   secundário (vira Brita 01, Pó e Brita 02) e o que sobra vai para o estoque de rachão, junto com o BMM05.
   Se o secundário consumiu estoque anterior, aparece um nó "Estoque anterior" alimentando o secundário.
   Largura das faixas proporcional às toneladas; ordem pensada para as faixas não se cruzarem. */
function sankeySaldo(s,o={}){
  const W=Math.max(o.min||620,o.W||900),H=o.H||300,nw=o.nw||14,gap=o.gap||16,Lm=o.lm||160,Rm=o.rm||200,T0=o.top||10;
  const C=Object.assign({bm10:'var(--P)',bmm05:'var(--m1)',ant:'var(--muted)',rach:'var(--m1)',sec:'var(--mfin)',b1:'var(--m2)',po:'var(--m3)',b2:'var(--m4)',txt:'var(--ink)',sub:'var(--grey)',faixa:.42},o.cores||{});
  const tot=(s.rBM+s.rMM+s.consumo)||1,k=(H-T0*2-3*gap)/tot,hh=v=>Math.max(v>0?2:0,v*k);
  const x1=Lm,x3=W-Rm-nw,x2=Math.round((x1+x3)/2),n={};
  n.bmm05={x:x1,y:T0,h:hh(s.rMM)};n.bm10={x:x1,y:n.bmm05.y+n.bmm05.h+gap,h:hh(s.rBM)};n.ant={x:x1,y:n.bm10.y+n.bm10.h+gap,h:hh(s.consumo)};
  n.est={x:x3,y:T0,h:hh(s.estoque)};n.b1={x:x3,y:n.est.y+n.est.h+gap,h:hh(s.b1)};n.po={x:x3,y:n.b1.y+n.b1.h+gap,h:hh(s.po)};n.b2={x:x3,y:n.po.y+n.po.h+gap,h:hh(s.b2)};
  const ySaiFinos=n.bm10.y+hh(s.sobra);n.sec={x:x2,y:Math.round((ySaiFinos+n.b1.y)/2),h:hh(s.finos)};
  const pct=(v,b)=>b?fmtPc(v*100/b):'—',tl=(a,b)=>`<div class='tl'><span>${a}</span><b>${b}</b></div>`;
  const faixa=(xa,ya,xb,yb,h,cor,tip)=>{if(h<=0)return '';const m=(xa+xb)/2;
    return `<path d="M${xa} ${ya}C${m} ${ya} ${m} ${yb} ${xb} ${yb}L${xb} ${yb+h}C${m} ${yb+h} ${m} ${ya+h} ${xa} ${ya+h}Z" fill="${cor}" fill-opacity="${C.faixa}" class="skf" data-tip="${esc(tip)}"/>`};
  let g='';
  g+=faixa(x1+nw,n.bmm05.y,x3,n.est.y,hh(s.rMM),C.rach,`<div class='m'>Lokotrack → estoque de rachão</div><b>${f0(s.rMM)} t</b>${tl('Parte do estoque',pct(s.rMM,s.estoque))}`);
  g+=faixa(x1+nw,n.bm10.y,x3,n.est.y+hh(s.rMM),hh(s.sobra),C.rach,`<div class='m'>Primário → sobrou rachão (estoque)</div><b>${f0(s.sobra)} t</b>${tl('Parte do rachão do primário',pct(s.sobra,s.rBM))}`);
  g+=faixa(x1+nw,ySaiFinos,x2,n.sec.y,hh(s.daBM10),C.sec,`<div class='m'>Primário → aplicado no secundário</div><b>${f0(s.daBM10)} t</b>${tl('Parte do rachão do primário',pct(s.daBM10,s.rBM))}`);
  g+=faixa(x1+nw,n.ant.y,x2,n.sec.y+hh(s.daBM10),hh(s.consumo),C.ant,`<div class='m'>Estoque anterior → secundário</div><b>${f0(s.consumo)} t</b>${tl('Finos acima do rachão britado','consumiu estoque')}`);
  let sy=n.sec.y;[['b1','Brita 01',s.b1],['po','Pó de pedra',s.po],['b2','Brita 02',s.b2]].forEach(([id,nm,v])=>{g+=faixa(x2+nw,sy,x3,n[id].y,hh(v),C[id],`<div class='m'>Secundário → ${nm}</div><b>${f0(v)} t</b>${tl('Parte dos finos',pct(v,s.finos))}`);sy+=hh(v)});
  const no=(id,cor,nome,v,lado,sub)=>{const q=n[id];if(!q.h)return '';const cy=q.y+q.h/2;
    const tx=lado==='e'?q.x-10:lado==='d'?q.x+nw+10:q.x+nw/2,an=lado==='e'?'end':lado==='d'?'start':'middle',ty=lado==='c'?q.y+q.h+16:cy-3;
    return `<rect x="${q.x}" y="${q.y}" width="${nw}" height="${q.h}" rx="2" fill="${cor}" class="skn"/><text x="${tx}" y="${ty}" text-anchor="${an}" class="skl" fill="${C.txt}">${nome}</text><text x="${tx}" y="${ty+14}" text-anchor="${an}" class="sks" fill="${C.sub}">${f0(v)} t${sub?' · '+sub:''}</text>`};
  g+=no('bmm05',C.bmm05,'Lokotrack · BMM05',s.rMM,'e',pct(s.rMM,s.total)+' do britado');
  g+=no('bm10',C.bm10,'Primário · BM10',s.rBM,'e',pct(s.rBM,s.total)+' do britado');
  g+=no('ant',C.ant,'Estoque anterior',s.consumo,'e','consumido');
  g+=no('sec',C.sec,'Aplicado no secundário',s.finos,'c',pct(s.daBM10,s.rBM)+' do rachão do primário');
  g+=no('est',C.rach,'Estoque de rachão',s.estoque,'d','estoque primário + Lokotrack');
  g+=no('b1',C.b1,'Brita 01',s.b1,'d',pct(s.b1,s.finos)+' dos finos');
  g+=no('po',C.po,'Pó de pedra',s.po,'d',pct(s.po,s.finos)+' dos finos');
  g+=no('b2',C.b2,'Brita 02',s.b2,'d',pct(s.b2,s.finos)+' dos finos');
  const Hr=Math.max(n.b2.y+n.b2.h,n.ant.y+n.ant.h,n.bm10.y+n.bm10.h,n.sec.y+n.sec.h+30)+T0+4;
  return `<svg class="ch sk" viewBox="0 0 ${W} ${Hr}" style="max-width:${W}px;min-width:${o.min||620}px" role="img" aria-label="${esc(`Saldo: BM10 britou ${f0(s.rBM)} t de rachão; ${f0(s.finos)} t viraram finos; sobraram ${f0(s.sobra)} t no estoque; BMM05 ${f0(s.rMM)} t`)}">${g}</svg>`;
}
function prdSaldoBloco(c){
  const modo=PR.sm||'M',dia=modo==='D'?PR.dia:(c.ref||PR.dia),s=prdSaldo(c,dia,modo==='D');
  const seg=segHtml('prdSaldoSeg',[['M',`Mês até ${dia?ddmm(dia):'—'}`],['D',`Só o dia ${PR.dia?ddmm(PR.dia):'—'}`]],modo);
  if(!s.total&&!s.finos)return `<div class="prdbarf">${seg}</div><div class="pempty"><b>Sem produção lançada ${modo==='D'?'neste dia':'neste mês'}</b></div>`;
  let h=`<div class="prdbarf">${seg}</div><div class="sldk">
    <div><span>Britado total</span><b>${f0(s.total)}<small>t</small></b><em>rachão do primário + Lokotrack</em></div>
    <div><span>Rachão do primário</span><b>${f0(s.rBM)}<small>t</small></b><em>${fmtPc(pcS(s.rBM,s.total))} do britado</em></div>
    <div><span>Aplicado no secundário</span><b>${f0(s.finos)}<small>t</small></b><em>${s.consumo?'passou do rachão do primário':fmtPc(pcS(s.finos,s.rBM))+' do rachão do primário'}</em></div>
    <div><span>Sobrou do primário (estoque)</span><b>${fSin(s.saldoBM)}<small>t</small></b><em>${s.consumo?'consumiu estoque anterior':fmtPc(pcS(s.sobra,s.rBM))+' foi para o estoque'}</em></div>
    <div><span>Estoque de rachão</span><b>${fSin(s.saldoEst)}<small>t</small></b><em>estoque primário + Lokotrack (${f0(s.rMM)} t)</em></div></div>`;
  if(s.consumo)h+=`<div class="warnb" style="margin-top:12px">O aplicado no secundário (${f0(s.finos)} t) passou do rachão do primário (${f0(s.rBM)} t) em <b>${f0(s.consumo)} t</b>: o secundário consumiu rachão do estoque anterior do primário.</div>`;
  h+=`<div class="scrollx sldsk">${sankeySaldo(s,{W:largGraf(false)})}</div>
    <p class="note">Largura de cada faixa = toneladas. Passe o mouse sobre uma faixa para ver os números.</p>`;
  h+=`<div class="prdtab"><button type="button" class="fclear" data-sldtab>${PR.stab?'Esconder o saldo dia a dia':'Ver o saldo dia a dia'}</button></div><div class="scrollx" id="sldTab">${PR.stab?prdSaldoTabela(c):''}</div>`;
  return h;
}
function prdSaldoTabela(c){
  const cor=v=>v<0?' style="color:var(--cr)"':'';
  let h=`<table class="tb"><thead><tr><th>Dia</th><th class="n">Rachão primário</th><th class="n">Brita 01</th><th class="n">Pó</th><th class="n">Brita 02</th><th class="n">Aplicado no secundário</th><th class="n hm">% aplicado</th><th class="n">Sobra primário</th><th class="n">Lokotrack</th><th class="n">Estoque rachão</th><th class="n">Britado</th></tr></thead><tbody>`;
  const lin=(nome,s,cl='')=>`<tr${cl}><td class="m">${nome}</td><td class="n">${f0(s.rBM)}</td><td class="n">${f0(s.b1)}</td><td class="n">${f0(s.po)}</td><td class="n">${f0(s.b2)}</td><td class="n">${f0(s.finos)}</td><td class="n hm">${s.rBM?fmtPc(pcS(s.finos,s.rBM)):'—'}</td><td class="n"${cor(s.saldoBM)}>${fSin(s.saldoBM)}</td><td class="n">${f0(s.rMM)}</td><td class="n"${cor(s.saldoEst)} style="font-weight:700">${fSin(s.saldoEst)}</td><td class="n" style="font-weight:700;color:var(--ink)">${f0(s.total)}</td></tr>`;
  c.days.filter(o=>o.tem).forEach(o=>{h+=lin(`${ddmm(o.d)}<span class="sub">${WDN[wd(o.d)]}</span>`,prdSaldo(c,o.d,true))});
  h+=lin('Total',prdSaldo(c,c.ref),' class="tot"')+'</tbody></table><p class="note">Sobra negativa (em vermelho) = naquele dia o secundário fez mais finos do que o BM10 britou: consumiu rachão do estoque.</p>';
  return h;
}
/* ---------- toneladas × horas trabalhadas ----------
   Primário: rachão lançado no BM10 ÷ horas ligado do AV10 (alimentador do BM10).
   Secundário: Brita 01 + Pó + Brita 02 ÷ horas ligado do CV07.
   Horas = dia de produção 07:30 → 07:30, intervalos ligados acima de 16h cortados (mesma regra do mapa de operação).
   Só entram na conta os dias com produção lançada E horas registradas. */
const ETH=[{m:'AV10',nome:'Primário · BM10',sub:'rachão do BM10 ÷ horas do AV10',lt:'Rachão BM10',t:o=>o.eq.BM10,cor:'var(--m1)'},
           {m:'CV07',nome:'Secundário · finos',sub:'Brita 01 + Pó + Brita 02 ÷ horas do CV07',lt:'Finos',t:o=>finosDia(o),cor:'var(--m3)'}];
const fH=v=>v.toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1});
function prdHoraEt(c,e,ate){
  const ds=c.days.filter(o=>!ate||o.d<=ate);
  const pts=ds.filter(o=>o.tem&&o.h[e.m]>0&&e.t(o)>0).map(o=>({o,h:o.h[e.m],t:e.t(o)}));
  const T=pts.reduce((a,p)=>a+p.t,0),H=pts.reduce((a,p)=>a+p.h,0),n=pts.length;
  let r=null;if(n>=3){const mh=H/n,mt=T/n;let sxy=0,sxx=0,syy=0;pts.forEach(p=>{sxy+=(p.h-mh)*(p.t-mt);sxx+=(p.h-mh)**2;syy+=(p.t-mt)**2});r=sxx&&syy?sxy/Math.sqrt(sxx*syy):null}
  const semH=ds.filter(o=>o.tem&&e.t(o)>0&&!(o.h[e.m]>0)).map(o=>o.d),semT=ds.filter(o=>o.h[e.m]>0&&!(o.tem&&e.t(o)>0)).map(o=>o.d);
  /* fora do padrão: rendeu mais de 1,5× ou menos da metade da média do mês (costuma ser hora perdida pelo sensor ou lançamento trocado) */
  const th=H?T/H:0,fora=th?pts.filter(p=>p.t/p.h>th*1.5||p.t/p.h<th*.5):[];fora.forEach(p=>p.fora=true);
  return {pts,T,H,n,th,r,semH,semT,fora,hDia:n?H/n:0};
}
const rCorr=r=>r==null?'poucos dias para medir':Math.abs(r)>=.8?'forte':Math.abs(r)>=.5?'moderada':'fraca';
/* Barras de t/h por dia: verde = acima da média do mês, laranja = abaixo, vazada = fora do padrão.
   A escala vai até 2× a média para um dia com hora perdida pelo sensor não achatar os outros; o que passa ganha uma seta no topo. */
function prdHoraBarras(c,e,k,W){
  const n=c.days.length,L=40,H=210,T=16,Bo=24,cw=(W-L)/n,ih=H-T-Bo;
  const byD=Object.fromEntries(k.pts.map(p=>[p.o.d,p]));
  const maxV=Math.max(1,...k.pts.map(p=>p.t/p.h)),lim=Math.min(maxV,k.th*2||maxV),st=Math.pow(10,Math.floor(Math.log10(lim)))/2,top=Math.ceil(lim/st)*st;
  const Y=v=>ih*Math.min(v,top)/top;
  let s=`<svg class="ch swipe" viewBox="0 0 ${W} ${H}" style="max-width:${W}px" role="img" aria-label="${esc(`${e.nome}: toneladas por hora em cada dia, média ${fH(k.th)} t/h`)}">`;
  [0,.5,1].forEach(f=>{const y=T+ih-Y(top*f);s+=`<line class="gl" x1="${L}" x2="${W}" y1="${y}" y2="${y}"/><text class="ax" x="${L-6}" y="${y+3}" text-anchor="end">${f0(top*f)}</text>`});
  const stp=Math.max(1,Math.ceil(40/cw));
  c.days.forEach((o,i)=>{const x=L+i*cw,bw=Math.max(3,Math.min(22,cw*.68)),bx=x+(cw-bw)/2,p=byD[o.d];
    if(p){const v=p.t/p.h,hh=Math.max(1,Y(v)),y=T+ih-hh,acima=v>=k.th,cor=acima?'var(--ok)':'var(--at)';
      const tip=`<div class='m'>${ddmm(o.d)} · ${WDN[wd(o.d)]} · ${e.nome}</div><b>${fH(v)} t/h</b><div class='tl'><span>${e.lt}</span><b>${f0(p.t)} t</b></div><div class='tl'><span>Horas ${e.m}</span><b>${fH(p.h)} h</b></div><div class='tl'><span>Média do mês</span><b>${fH(k.th)} t/h</b></div><div class='tl'><span>Diferença</span><b>${v>=k.th?'+':''}${pc1(v/k.th-1)}</b></div>${p.fora?`<div class='tl'><span>Fora do padrão</span><b>conferir horas e lançamento</b></div>`:''}`;
      s+=`<g class="bd" data-dia="${o.d}" data-tip="${esc(tip)}"><rect class="bg" x="${x}" y="${T}" width="${cw}" height="${ih}" fill="transparent" rx="3"/>`
        +(p.fora?`<rect x="${bx+1}" y="${y+1}" width="${bw-2}" height="${Math.max(1,hh-1)}" fill="none" stroke="${cor}" stroke-width="2" stroke-dasharray="3 2" rx="2"/>`
               :`<rect x="${bx}" y="${y}" width="${bw}" height="${hh}" fill="${cor}" rx="3" ${o.d===PR.dia?'stroke="var(--ink)" stroke-width="1.5"':''}/>`)
        +(v>top?`<text x="${x+cw/2}" y="${T-4}" text-anchor="middle" style="font:700 10px var(--mono)" fill="${cor}">▲${f0(v)}</text>`:'')+'</g>'}
    if(i%stp===0)s+=`<text class="ax" x="${x+cw/2}" y="${H-7}" text-anchor="middle" ${o.d===PR.dia?'fill="var(--ink)" style="font-weight:700"':''}>${ddmm(o.d).slice(0,2)}</text>`});
  if(k.th){const ym=T+ih-Y(k.th);s+=`<line x1="${L}" x2="${W}" y1="${ym}" y2="${ym}" stroke="var(--ink)" stroke-width="1.6" stroke-dasharray="5 4" opacity=".7"/><text x="${W-2}" y="${ym-5}" text-anchor="end" style="font:700 10.5px var(--mono)" fill="var(--ink)">média ${fH(k.th)} t/h</text>`}
  return s+`</svg><div class="leg"><span><i style="background:var(--ok)"></i>Acima da média</span><span><i style="background:var(--at)"></i>Abaixo da média</span>${k.fora.length?`<span><i style="background:transparent;outline:2px dashed var(--grey);outline-offset:-2px"></i>Fora do padrão</span>`:''}</div>`;
}
function prdHoraBloco(c){
  const ks=ETH.map(e=>[e,prdHoraEt(c,e,c.ref)]);
  if(!ks.some(([,k])=>k.n))return `<div class="pempty"><b>Sem dias com produção e horas registradas neste mês</b>As horas vêm do sensor de liga/desliga do AV10 e do CV07.</div>`;
  const W=Math.max(280,Math.min(620,largGraf(true)-16));
  let h=`<div class="hrg">${ks.map(([e,k])=>`<div class="hrc"><div class="pmh"><i style="background:${e.cor}"></i>${e.nome}</div>
    <div class="hrk"><div><span>Toneladas por hora</span><b>${k.n?fH(k.th):'—'}<small>t/h</small></b><em>${e.sub}</em></div>
      <div><span>Horas trabalhadas</span><b>${fH(k.H)}<small>h</small></b><em>${k.n} ${k.n===1?'dia':'dias'} · média ${fH(k.hDia)} h/dia</em></div>
      <div><span>Toneladas</span><b>${f0(k.T)}<small>t</small></b><em>${k.fora.length?`${k.fora.length} ${k.fora.length===1?'dia':'dias'} fora do padrão (barra tracejada)`:'todos os dias dentro do padrão'}</em></div>
      <div><span>Correlação t × h</span><b>${k.r==null?'—':fH(k.r*k.r*100)+'<small>%</small>'}</b><em>${k.r==null?rCorr(k.r):`${rCorr(k.r)} · R² (quanto das toneladas as horas explicam)`}</em></div></div>
    ${k.n?prdHoraBarras(c,e,k,W):''}
    ${k.fora.length?`<p class="note">Fora do padrão (mais de 1,5× ou menos da metade da média): ${k.fora.map(p=>`${ddmm(p.o.d)} (${f0(p.t/p.h)} t/h)`).join(', ')}. Costuma ser hora perdida pelo sensor ou lançamento trocado: vale conferir.</p>`:''}
    ${k.semH.length?`<p class="note warnt">${k.semH.length} ${k.semH.length===1?'dia':'dias'} com produção mas sem horas do ${e.m} (${k.semH.map(ddmm).join(', ')}): ficaram fora da conta. Provável sensor sem sinal.</p>`:''}</div>`).join('')}</div>`;
  h+=`<p class="note">Cada barra é um dia: toneladas lançadas ÷ horas ligado. Verde rendeu acima da média do mês, laranja abaixo (equipamento ligado em vazio, alimentação irregular, material diferente). Dias sem barra não tiveram produção ou horas registradas. Clique numa barra para abrir o dia.</p>`;
  h+=`<div class="prdtab"><button type="button" class="fclear" data-hortab>${PR.htab?'Esconder a tabela dia a dia':'Ver a tabela dia a dia'}</button></div><div class="scrollx">${PR.htab?prdHoraTabela(c):''}</div>`;
  return h;
}
function prdHoraTabela(c){
  const [p,s]=ETH,th=(t,hh)=>hh>0&&t>0?fH(t/hh):'—',hf=v=>v>0?fH(v):'—';
  let h=`<table class="tb"><thead><tr><th>Dia</th><th class="n">Horas AV10</th><th class="n">Rachão BM10</th><th class="n">t/h primário</th><th class="n">Horas CV07</th><th class="n">Finos</th><th class="n">t/h secundário</th></tr></thead><tbody>`;
  c.days.filter(o=>(o.tem||o.h.AV10>0||o.h.CV07>0)&&(!c.ref||o.d<=c.ref)).forEach(o=>{
    h+=`<tr><td class="m">${ddmm(o.d)}<span class="sub">${WDN[wd(o.d)]}</span></td><td class="n">${hf(o.h.AV10)}</td><td class="n">${o.tem?f0(p.t(o)):'—'}</td><td class="n" style="font-weight:700">${th(p.t(o),o.h.AV10)}</td><td class="n">${hf(o.h.CV07)}</td><td class="n">${o.tem?f0(s.t(o)):'—'}</td><td class="n" style="font-weight:700">${th(s.t(o),o.h.CV07)}</td></tr>`});
  const a=prdHoraEt(c,p,c.ref),b=prdHoraEt(c,s,c.ref);
  return h+`<tr class="tot"><td>Mês (dias com os dois)</td><td class="n">${fH(a.H)}</td><td class="n">${f0(a.T)}</td><td class="n">${a.n?fH(a.th):'—'}</td><td class="n">${fH(b.H)}</td><td class="n">${f0(b.T)}</td><td class="n">${b.n?fH(b.th):'—'}</td></tr></tbody></table>`;
}
function prdMeses(){
  const ms=((PR.x&&PR.x.meses)||[]).slice().reverse();
  if(!ms.length)return '<div class="pempty"><b>Nenhum mês cadastrado</b></div>';
  return `<table class="tb"><thead><tr><th>Mês</th><th class="n">Programado</th><th class="n">Realizado</th><th class="n">% da meta</th></tr></thead><tbody>${ms.map(m0=>{const m=visLiq()?{...m0,meta:+m0.meta_britado||0,real:2*(+m0.real_britado||0)-(+m0.real||0)}:m0;const p=m.meta?m.real/m.meta:null;
    return `<tr data-prdmes="${m.mes}" style="cursor:pointer" ${m.mes===PR.mes?'class="sel"':''}><td class="m" style="text-transform:capitalize">${esc(mesTxt(m.mes))}</td><td class="n">${f0(m.meta)} t</td><td class="n">${f0(m.real)} t</td><td class="n">${p!=null?pc1(p):'—'}<span class="mini"><i style="width:${p?Math.min(100,p*100):0}%;background:var(--m1)"></i></span></td></tr>`}).join('')}</tbody></table><p class="note">Clique num mês para abrir.</p>`;
}

/* ---------- relatório do dia (A4, imprimir ou salvar em PDF) ---------- */
async function prdRelatorio(){
  const c=PR.c,o=c&&c.byD[PR.dia];if(!o)return;
  if(!PR.par[o.d]||PR.par[o.d].busy){toast('Buscando as paradas do dia…');delete PR.par[o.d];await prdParadas(o.d)}
  const a=prdAte(c,o.d),p=PR.par[o.d]||{},rows=(p.rows||[]).slice().sort((x,y)=>x.iniMs-y.iniMs);
  const totP=rows.reduce((s,r)=>s+(r.min||0),0)/60;
  const mesMeta=c.metaT;
  let h=`<div class="rh"><img src="assets/logo-azul.png" alt="Tripoloni"><div class="t">Acompanhamento diário da produção · Britagem</div><div class="k">${WDN[wd(o.d)]}, ${dmy(o.d)}<br>${esc(mesTxt(PR.mes))}</div></div>
    <div class="rk"><div><span>${visLiq()?'Para aplicação no dia':'Produção do dia'}</span><b>${f0(o.tot)} t</b>${o.metaT?`meta ${f0(o.metaT)} t · ${pc1(o.tot/o.metaT)}`:''}</div>
    <div><span>Acumulado do mês</span><b>${f0(a.realT)} t</b>${mesMeta?`${pc1(a.realT/mesMeta)} da meta de ${f0(mesMeta)} t`:''}</div>
    <div><span>Aderência ao previsto</span><b>${a.prevT?pc1(a.realT/a.prevT):'—'}</b>previsto até o dia ${f0(a.prevT)} t</div>
    <div><span>Paradas no dia</span><b>${hm(totP)}</b>${rows.length} ${rows.length===1?'ocorrência':'ocorrências'}</div></div>
    <h4>Produção do dia por turno</h4>${prdTabelaDia(c,o)}
    <h4>Acumulado do mês até ${ddmm(o.d)}</h4><table class="tb"><thead><tr><th>Material</th><th class="n">Meta do mês</th><th class="n">Previsto até o dia</th><th class="n">Realizado</th><th class="n">% do mês</th><th class="n">Aderência</th></tr></thead><tbody>
    ${MATS.map(([k,n])=>`<tr><td class="m">${n}</td><td class="n">${f0(c.meta[k])}</td><td class="n">${f0(a.prev[k])}</td><td class="n">${f0(a.real[k])}</td><td class="n">${c.meta[k]?pc1(a.real[k]/c.meta[k]):'—'}</td><td class="n">${a.prev[k]?pc1(a.real[k]/a.prev[k]):'—'}</td></tr>`).join('')}
    ${EQS.map(([e,n,s])=>`<tr class="sb"><td>Rachão · ${n} (${s})</td><td class="n">${f0(c.eqMeta[e])}</td><td class="n"></td><td class="n">${f0(a.eqReal[e])}</td><td class="n">${c.eqMeta[e]?pc1(a.eqReal[e]/c.eqMeta[e]):'—'}</td><td class="n">${a.eqDias[e]} dias trab.</td></tr>`).join('')}
    <tr class="tot"><td>Total</td><td class="n">${f0(mesMeta)}</td><td class="n">${f0(a.prevT)}</td><td class="n">${f0(a.realT)}</td><td class="n">${mesMeta?pc1(a.realT/mesMeta):'—'}</td><td class="n">${a.prevT?pc1(a.realT/a.prevT):'—'}</td></tr></tbody></table>
    <h4>Ocorrências do dia (paradas registradas pelos sensores)</h4>`;
  h+=rows.length?`<table class="tb"><thead><tr><th>Equipamento</th><th>Início</th><th>Fim</th><th class="n">Duração</th><th>Justificativa</th></tr></thead><tbody>${rows.map(r=>`<tr><td class="m">${esc(r.mo)}</td><td>${dtFmt.format(r.iniMs).split(' ')[1]||''}</td><td>${r.fimMs?dtFmt.format(r.fimMs).split(' ')[1]||'':'aberta'}</td><td class="n">${r.min!=null?hm(r.min/60):'—'}</td><td>${r.cat||r.cod?esc(parMot(r))+(r.txt&&r.txt!=='Sem observações.'?' · '+esc(r.txt):''):'sem justificativa'}</td></tr>`).join('')}<tr class="tot"><td>Total</td><td></td><td></td><td class="n">${hm(totP)}</td><td></td></tr></tbody></table>`:(p.err?'<p>Não foi possível carregar as paradas.</p>':'<p>Nenhuma parada registrada neste dia.</p>');
  h+=`<div class="rf"><span>Construtora Tripoloni Ltda. · Britagem</span><span>Gerado em ${dtFmt.format(Date.now())} · painel Horímetros Britagem</span></div>`;
  $('#prdRel').innerHTML=h;document.body.classList.add('prel');
  const fim=()=>{document.body.classList.remove('prel');window.removeEventListener('afterprint',fim)};window.addEventListener('afterprint',fim);
  setTimeout(()=>{window.print();setTimeout(fim,500)},60);
}

/* ---------- lançamento do dia (supervisor) ---------- */
/* Aceita contas como na planilha: 34*25, 1934-1239+700, 1.234,5 */
function prdConta(s){
  s=String(s??'').trim().replace(/\s+/g,'');if(!s)return null;if(s[0]==='=')s=s.slice(1);
  /* jeito brasileiro: ponto antes de 3 dígitos é milhar (1.934), vírgula é decimal (318,5) */
  s=s.replace(/(\d)\.(?=\d{3}(?!\d))/g,'$1');if(s.includes(','))s=s.replace(/,/g,'.');
  if(!/^[0-9.+\-*/()]+$/.test(s))return NaN;
  let i=0;const pk=()=>s[i];
  const num=()=>{if(pk()==='('){i++;const v=ex();if(pk()!==')')throw 0;i++;return v}if(pk()==='-'){i++;return -num()}const m=/^\d+(\.\d+)?|^\.\d+/.exec(s.slice(i));if(!m)throw 0;i+=m[0].length;return +m[0]};
  const te=()=>{let v=num();while(pk()==='*'||pk()==='/'){const o=s[i++],b=num();v=o==='*'?v*b:v/b}return v};
  const ex=()=>{let v=te();while(pk()==='+'||pk()==='-'){const o=s[i++],b=te();v=o==='+'?v+b:v-b}return v};
  try{const v=ex();if(i!==s.length||!isFinite(v))return NaN;return Math.round(v*100)/100}catch(e){return NaN}
}
const PL_ROWS=[['RACHAO','BM10','Rachão · BM10','Britador primário'],['RACHAO','BMM05','Rachão · BMM05','Lokotrack'],['BRITA01','-','Brita 01',''],['PO','-','Pó de pedra',''],['BRITA02','-','Brita 02','']];
let PL=null;
function prdLancar(dia){
  if(!ehSup())return;
  dia=dia||(PR.c&&PR.c.ref&&PR.c.ref<D.hoje&&mesDe(D.hoje)===PR.mes?addDays(PR.c.ref,1):PR.dia)||D.hoje;if(dia>D.hoje)dia=D.hoje;
  PL={dia,orig:{}};
  gOpen({k:'Produção',t:'Lançar produção',ok:'Salvar lançamentos',w:600,
    body:`<div class="fs"><h4>Dia</h4><input class="tin" type="date" id="plDia" value="${dia}" max="${D.hoje}" style="height:44px;font-size:15px"><div class="plinfo" id="plInfo"></div></div>
      <div class="fs"><h4>Toneladas por turno</h4><div id="plGrid"><div class="skel" style="width:80%"></div></div>
      <div class="fhint">Dá para digitar contas, como na planilha: <b>34*25</b> (cargas × 25 t) ou <b>1934-1239+700</b>. Campo vazio = sem lançamento; <b>0</b> = parou o turno todo.</div></div>`,
    onOk:async()=>{
      const itens=[];let bad=0;
      $$('#plGrid .pin').forEach(inp=>{const [m,e,t]=inp.dataset.k.split('|');const v=prdConta(inp.value);if(Number.isNaN(v)||(v!=null&&(v<0||v>50000))){bad++;inp.setAttribute('aria-invalid','true')}else itens.push({turno:+t,material:m,equipamento:e,t:v})});
      if(bad)throw falha(bad===1?'Confira o valor marcado em vermelho.':`Confira os ${bad} valores marcados em vermelho.`);
      const d=$('#plDia').value;if(!isDay(d)||d>D.hoje)throw falha('Escolha um dia até hoje.');
      ULT_SALVO=Date.now();await rpc('prod_salvar_dia',{p_dia:d,p_itens:itens});ULT_SALVO=Date.now();
      toast(`Produção de ${dmy(d)} salva.`);PR.dia=d;delete PR.par[d];await prdLoad(mesDe(d),true);
    }});
  plFill(dia);
}
async function plFill(dia){
  PL.dia=dia;const g=$('#plGrid');if(!g)return;
  let lanc=null;
  if(PR.x&&mesDe(dia)===PR.mes)lanc=PR.x.lanc||[];
  else{g.innerHTML='<div class="skel" style="width:80%"></div><div class="skel" style="width:60%"></div>';
    try{const x=await rpc('prod_dados',{p_mes:mesDe(dia)});lanc=x.lanc||[]}catch(e){if(PL.dia===dia)g.innerHTML=`<p class="derr">${esc(errApp(e))}</p>`;return}}
  if(PL.dia!==dia)return;
  const v={};lanc.filter(l=>l.dia===dia).forEach(l=>v[`${l.material}|${l.equipamento}|${l.turno}`]=+l.t);
  const fmt=x=>x==null?'':String(x).replace('.',',');
  $('#plInfo').innerHTML=Object.keys(v).length?`<b>Já tem lançamento neste dia</b>: os valores abaixo são os gravados. Salvar substitui.`:`${WDN[wd(dia)]}, ${dmy(dia)} · sem lançamento ainda.`;
  g.innerHTML=`<table class="tb pltb"><thead><tr><th>Material</th><th class="n">1º turno</th><th class="n">2º turno</th><th class="n">Total</th></tr></thead><tbody>${PL_ROWS.map(([m,e,n,s])=>`<tr><td class="m">${n}${s?`<span class="sub">${s}</span>`:''}</td>${[1,2].map(t=>`<td><input class="tin pin" inputmode="decimal" autocomplete="off" aria-label="${esc(n)} · ${t}º turno" data-k="${m}|${e}|${t}" value="${fmt(v[`${m}|${e}|${t}`])}"></td>`).join('')}<td class="n" data-rt="${m}|${e}">—</td></tr>`).join('')}
    <tr class="tot"><td>Total</td><td class="n" data-ct="1">—</td><td class="n" data-ct="2">—</td><td class="n" data-ct="T">—</td></tr></tbody></table>`;
  plTotais();
  const f=g.querySelector('.pin');if(f)f.focus();
}
function plTotais(){
  const tt={1:0,2:0};let tem=false;
  PL_ROWS.forEach(([m,e])=>{let r=0,any=false;[1,2].forEach(t=>{const inp=$(`#plGrid .pin[data-k="${m}|${e}|${t}"]`);const v=prdConta(inp.value);
    const bad=Number.isNaN(v)||(v!=null&&(v<0||v>50000));inp.setAttribute('aria-invalid',bad?'true':'false');
    inp.classList.toggle('calc',!bad&&v!=null&&/[+\-*/()]/.test(inp.value.trim().replace(/^-/,'')));inp.title=!bad&&v!=null&&/[+*/()]|.-/.test(inp.value)?`= ${tnum(v)} t`:'';
    if(!bad&&v!=null){r+=v;tt[t]+=v;any=true;tem=true}});
    const c=$(`#plGrid [data-rt="${m}|${e}"]`);if(c)c.textContent=any?f0(r):'—'});
  const s=(k,v)=>{const c=$(`#plGrid [data-ct="${k}"]`);if(c)c.textContent=tem?f0(v):'—'};s(1,tt[1]);s(2,tt[2]);s('T',tt[1]+tt[2]);
}

/* ---------- metas do mês (supervisor) ---------- */
let MT=null;
function prdMetas(){
  if(!ehSup())return;
  const mes=PR.mes,c=PR.c,m=c&&c.m,n=diasNoMes(mes);
  const cal={};((PR.x&&PR.x.dias)||[]).forEach(d=>cal[+d.dia.slice(8)]=d.tipo);
  if(!m&&!Object.keys(cal).length)for(let i=1;i<=n;i++){const w=wd(addDays(mes,i-1));if(w>=1&&w<=5)cal[i]='X';else if(w===6)cal[i]='XX'}
  MT={mes,n,cal};
  const val=k=>m?String(+m[k]).replace('.',','):'';
  const campo=(id,lab,k,col)=>`<label>${col?`<span><i style="background:${col}"></i>${lab}</span>`:lab}<input class="tin" id="${id}" inputmode="decimal" autocomplete="off" value="${val(k)}" placeholder="0"></label>`;
  gOpen({k:'Produção',t:`Metas de ${mesTxt(mes)}`,ok:'Salvar metas',w:560,
    body:`<div class="fs"><h4>Meta do mês (toneladas)</h4><div class="mgrid">
        ${campo('mRI','Rachão · obra Irati','meta_rachao_irati','var(--m1)')}${campo('mRP','Rachão · obra Palmeira','meta_rachao_palmeira','var(--m1)')}
        ${campo('mB1','Brita 01','meta_brita01','var(--m2)')}${campo('mPO','Pó de pedra','meta_po','var(--m3)')}${campo('mB2','Brita 02','meta_brita02','var(--m4)')}</div>
        <div class="fhint" id="mTot"></div></div>
      <div class="fs"><h4>Dias programados</h4><div class="cal" id="mCal"></div>
        <div class="fhint">Toque no dia para trocar: <b>X</b> dia cheio → <b>XX</b> sábado (rende menos) → sem produção. <button type="button" class="fclear" data-mpad>Preencher o padrão (seg a sex X, sáb XX)</button></div></div>
      <div class="fs"><h4>Ajustes</h4><div class="mgrid">
        <label>Peso do sábado (XX), em %<input class="tin" id="mPeso" inputmode="decimal" value="${String(Math.round((m?+m.peso_sabado:0.7369)*10000)/100).replace('.',',')}"></label>
        <label>Parte do BM10 na meta de rachão, em %<input class="tin" id="mBM" inputmode="decimal" value="${String(Math.round((m?+m.pct_bm10:0.5)*10000)/100).replace('.',',')}"></label></div>
        <div class="fhint">O resto da meta de rachão fica com o BMM05 (Lokotrack). Peso 73,69% é o que a planilha usava.</div></div>`,
    onOk:async()=>{
      const g=id=>{const v=prdConta($('#'+id).value);if(Number.isNaN(v)||(v!=null&&v<0))throw falha('Confira as metas: use só números.');return v||0};
      const peso=g('mPeso')/100,bm=g('mBM')/100;
      if(!(peso>0&&peso<=1))throw falha('O peso do sábado precisa ficar entre 1% e 100%.');if(bm<0||bm>1)throw falha('A parte do BM10 precisa ficar entre 0% e 100%.');
      const dias=Object.entries(MT.cal).filter(([,t])=>t).map(([d,t])=>({dia:addDays(MT.mes,+d-1),tipo:t}));
      if(!dias.length)throw falha('Marque pelo menos um dia programado.');
      ULT_SALVO=Date.now();await rpc('prod_salvar_mes',{p_mes:MT.mes,p_meta_rachao_irati:g('mRI'),p_meta_rachao_palmeira:g('mRP'),p_meta_brita01:g('mB1'),p_meta_po:g('mPO'),p_meta_brita02:g('mB2'),p_peso_sabado:peso,p_pct_bm10:bm,p_dias:dias});
      ULT_SALVO=Date.now();toast(`Metas de ${mesTxt(MT.mes)} salvas.`);await prdLoad(MT.mes,true);
    }});
  mtCal();mtTot();
}
function mtCal(){
  const off=wd(MT.mes);let h=['D','S','T','Q','Q','S','S'].map(x=>`<div class="ch2">${x}</div>`).join('')+'<div></div>'.repeat(off);
  for(let i=1;i<=MT.n;i++){const t=MT.cal[i]||'';h+=`<button type="button" data-cd="${i}" class="${t.toLowerCase()}" aria-label="Dia ${i}: ${t==='X'?'dia cheio':t==='XX'?'sábado':'sem produção'}"><span>${i}</span><small>${t||'·'}</small></button>`}
  $('#mCal').innerHTML=h;
}
function mtTot(){
  const g=id=>{const v=prdConta(($('#'+id)||{}).value);return Number.isNaN(v)?0:v||0};
  const tot=['mRI','mRP','mB1','mPO','mB2'].reduce((a,id)=>a+g(id),0),peso=g('mPeso')/100||0.7369;
  const x=Object.values(MT.cal).filter(t=>t==='X').length,xx=Object.values(MT.cal).filter(t=>t==='XX').length,W=x+xx*peso;
  const e=$('#mTot');if(e)e.innerHTML=`Total do mês: <b>${f0(tot)} t</b> · rachão ${f0(g('mRI')+g('mRP'))} t · ${x+xx} dias programados (${xx} ${xx===1?'sábado':'sábados'}) · meta por dia cheio ≈ <b>${W?f0(tot/W):'—'} t</b>`;
}

/* ---------- eventos ---------- */
$('#prdMes').onchange=e=>prdLoad(e.target.value);
/* Visão do total: troca na hora, sem buscar de novo */
function prdVisUi(){$$('#prdVis button').forEach(b=>{const on=b.dataset.v===(visLiq()?'liq':'mat');b.classList.toggle('on',on);b.setAttribute('aria-pressed',on)})}
$('#prdVis').onclick=e=>{const b=e.target.closest('button');if(!b)return;PR.vis=b.dataset.v;try{localStorage.setItem('hb_prdvis',PR.vis)}catch(x){}prdVisUi();
  if(PR.x){PR.c=prdCalc(PR.x,PR.mes);renderPrd(false)}};
prdVisUi();
$('#prdPrev').onclick=()=>{const i=PR.lista.indexOf(PR.mes);if(i>0)prdLoad(PR.lista[i-1])};
$('#prdNext').onclick=()=>{const i=PR.lista.indexOf(PR.mes);if(i>=0&&i<PR.lista.length-1)prdLoad(PR.lista[i+1])};
$('#prdLancar').onclick=()=>prdLancar();
$('#prdMetas').onclick=()=>prdMetas();
$('#prdBody').addEventListener('click',e=>{
  const t=e.target;
  if(t.closest('[data-prdre]'))return prdLoad(PR.mes,true);
  if(t.closest('[data-prdmetas]'))return prdMetas();
  const dd=t.closest('[data-prddia]');if(dd&&!dd.disabled){const c=PR.c,i=c.days.findIndex(o=>o.d===PR.dia)+(+dd.dataset.prddia);if(c.days[i]){PR.dia=c.days[i].d;renderPrdDia()}return}
  if(t.closest('[data-prdrel]'))return prdRelatorio();
  if(t.closest('[data-prdlanc]'))return prdLancar(PR.dia);
  const bd=t.closest('g.bd[data-dia]');if(bd){PR.dia=bd.dataset.dia;renderPrdDia();$('#prdDiaBox').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'auto':'smooth',block:'start'});return}
  const pp=t.closest('[data-prdpar]');if(pp){F.key='custom';F.from=F.to=pp.dataset.prdpar;saveF();renderAll();go('par');return}
  const mr=t.closest('tr[data-prdmes]');if(mr)return prdLoad(mr.dataset.prdmes);
  const sgb=t.closest('#prdSaldoSeg button');if(sgb){PR.sm=sgb.dataset.v;$('#prdSaldoIn').innerHTML=prdSaldoBloco(PR.c);return}
  if(t.closest('[data-hortab]')){PR.htab=!PR.htab;$('#prdHoraIn').innerHTML=prdHoraBloco(PR.c);$$('#prdHoraIn .swipe').forEach(x=>x.classList.add('in'));return}
  if(t.closest('[data-sldtab]')){PR.stab=!PR.stab;$('#prdSaldoIn').innerHTML=prdSaldoBloco(PR.c);return}
  const bmb=t.closest('#prdBarMat button,#prdBarEq button');if(bmb){
    if(bmb.closest('#prdBarMat')){PR.bm=bmb.dataset.v;if(PR.bm!=='RACHAO')PR.be='AMB'}else PR.be=bmb.dataset.v;
    $('#prdBarsBloco').innerHTML=prdBarrasBloco(PR.c);$$('#prdBarsBloco .swipe').forEach(s=>s.classList.add('in'));return}
  if(t.closest('[data-prdtab]')){PR.tab=!PR.tab;$('#prdTab').innerHTML=PR.tab?prdTabela(PR.c):'';t.closest('[data-prdtab]').textContent=PR.tab?'Esconder a tabela dia a dia':'Ver a tabela dia a dia';return}
  if(t.closest('[data-prdtend]')){PR.tend=!PR.tend;PR.tendAnim=PR.tend;try{localStorage.setItem('hb_tend',PR.tend?'1':'0')}catch(e){}const b=t.closest('[data-prdtend]');b.classList.toggle('on',PR.tend);b.setAttribute('aria-pressed',PR.tend);$('#prdCurva').innerHTML=prdCurva(PR.c,PR.mat);$$('#prdCurva .swipe').forEach(s=>s.classList.add('in'));return}
  const sb=t.closest('#prdMatSeg button');if(sb){PR.mat=sb.dataset.v;$$('#prdMatSeg button').forEach(b=>b.classList.toggle('on',b===sb));$('#prdCurva').innerHTML=prdCurva(PR.c,PR.mat);$$('#prdCurva .swipe').forEach(s=>s.classList.add('in'));return}
});
$('#prdBody').addEventListener('change',e=>{if(e.target.id==='prdDia'){PR.dia=e.target.value;renderPrdDia()}});
$('#gB').addEventListener('input',e=>{if(e.target.classList.contains('pin'))plTotais();else if(MT&&e.target.closest('.mgrid'))mtTot()});
$('#gB').addEventListener('change',e=>{if(e.target.id==='plDia'&&PL&&isDay(e.target.value))plFill(e.target.value>D.hoje?D.hoje:e.target.value)});
$('#gB').addEventListener('click',e=>{
  const cd=e.target.closest('[data-cd]');if(cd&&MT){const i=+cd.dataset.cd,t=MT.cal[i]||'';MT.cal[i]=t===''?'X':t==='X'?'XX':'';if(!MT.cal[i])delete MT.cal[i];mtCal();mtTot();return}
  if(e.target.closest('[data-mpad]')&&MT){MT.cal={};for(let i=1;i<=MT.n;i++){const w=wd(addDays(MT.mes,i-1));if(w>=1&&w<=5)MT.cal[i]='X';else if(w===6)MT.cal[i]='XX'}mtCal();mtTot()}
});
/* Enter no lançamento pula para o próximo campo (mais rápido que mouse) */
$('#gB').addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.classList.contains('pin')){e.preventDefault();const all=$$('#plGrid .pin'),i=all.indexOf(e.target);if(all[i+1])all[i+1].focus();else $('#gOk').focus()}});
