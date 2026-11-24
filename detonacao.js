/* ---------- DETONAÇÃO: datas programadas e arquivos do plano de fogo ----------
   Dados: detonacoes (data, hora, local, situação, observação) e detonacao_arquivos (lista dos arquivos).
   Arquivos no bucket privado "planos-fogo", pasta <id da detonação>/; abre por link temporário de 5 min.
   Todos os liberados veem e baixam; só o supervisor programa, edita e envia arquivos. */
const DET_BK='planos-fogo',DET_MAX=25*1024*1024;
const DET_ACEITA='.pdf,.jpg,.jpeg,.png,.webp,.heic,.xlsx,.xls,.csv,.docx,.doc,.dwg,.dxf,.kmz,.kml,.zip';
const DET_ST={programada:['Programada','pg','◷'],realizada:['Realizada','ok','✓'],cancelada:['Cancelada','cr','✕']};
const DET_WD=['domingo','segunda','terça','quarta','quinta','sexta','sábado'];
const DET_MES=['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
let DT={rows:null,err:null,busy:false,hist:false};
let DTF=null; /* estado do formulário aberto */

const detSup=()=>!!(EU&&EU.autorizado&&EU.papel==='supervisor');
const detHoje=()=>(D&&D.hoje)||new Date().toLocaleDateString('en-CA',{timeZone:TZ});
const detHora=h=>h?h.slice(0,5):'';
const detTam=n=>n==null?'':n<1024*1024?`${Math.max(1,Math.round(n/1024))} KB`:`${(n/1048576).toLocaleString('pt-BR',{maximumFractionDigits:1})} MB`;
const detExt=n=>{const m=/\.([a-z0-9]{1,5})$/i.exec(n||'');return m?m[1].toLowerCase():''};
function detFalta(dia){const a=new Date(detHoje()+'T00:00:00Z'),b=new Date(dia+'T00:00:00Z'),n=Math.round((b-a)/864e5);
  return n===0?'hoje':n===1?'amanhã':n===-1?'ontem':n>1?`em ${n} dias`:`há ${-n} dias`}
/* Programada com data que já passou: pede para o supervisor marcar se foi feita */
const detNome=r=>[r.numero?`Fogo ${r.numero}`:'',r.local].filter(Boolean).join(' · ')||'Detonação';
const detVencida=r=>r.status==='programada'&&r.dia<detHoje();

async function detLoad(force,silencioso){
  if(!D)return;if(DT.rows&&!force){renderDet();return}
  DT.busy=true;DT.err=null;if(!silencioso||!DT.rows)renderDet();
  try{
    const {data,error}=await sb.from('detonacoes').select('*,arquivos:detonacao_arquivos(*)').order('dia',{ascending:false}).order('hora',{ascending:false,nullsFirst:false}).limit(300);
    if(error)throw error;
    data.forEach(r=>r.arquivos.sort((a,b)=>a.enviado_em<b.enviado_em?-1:1));
    DT.rows=data;
  }catch(e){DT.err=e}
  DT.busy=false;renderDet();
}

function detChip(r){
  if(detVencida(r))return '<span class="st at">● Confirmar se foi feita</span>';
  const s=DET_ST[r.status]||DET_ST.programada;return `<span class="st ${s[1]}">${s[2]} ${s[0]}</span>`;
}
function detArqs(r){
  if(!r.arquivos.length)return '<div class="dtnone">Sem plano de fogo anexado</div>';
  return `<ul class="dtfiles">${r.arquivos.map(a=>`<li><button type="button" class="dtfile" data-detarq="${esc(a.id)}" title="Abrir ${esc(a.nome)}">
    <span class="dtext">${esc(detExt(a.nome)||'arq')}</span><span class="dtfn">${esc(a.nome)}</span><small>${esc(detTam(a.tamanho))}</small></button></li>`).join('')}</ul>`;
}
function detCard(r){
  const [y,m,d]=r.dia.split('-');
  return `<article class="dtc${r.status==='cancelada'?' canc':''}">
    <div class="dtd" aria-hidden="true"><b>${+d}</b><span>${DET_MES[+m-1]}</span><small>${DET_WD[wd(r.dia)].slice(0,3)}</small></div>
    <div class="dti">
      <div class="dtt"><h3>${esc(detNome(r))}</h3>${detChip(r)}</div>
      <div class="dtm">${DET_WD[wd(r.dia)]}, ${d}/${m}/${y}${r.hora?` · ${detHora(r.hora)}`:''} · ${detFalta(r.dia)}</div>
      ${r.obs?`<p class="dto">${esc(r.obs)}</p>`:''}
      ${detArqs(r)}
    </div>
    ${detSup()?`<button type="button" class="btn2 dted" data-deted="${esc(r.id)}">Editar</button>`:''}
  </article>`;
}

function renderDet(){
  const b=$('#detBody');if(!b)return;
  $('#detNova').hidden=!detSup();
  if(DT.busy&&!DT.rows){b.innerHTML='<span class="sr">Carregando</span><div class="box"><div class="boxb" style="padding-top:16px"><div class="skel" style="width:60%"></div><div class="skel" style="width:85%"></div><div class="skel" style="width:40%"></div></div></div>';return}
  if(DT.err&&!DT.rows){b.innerHTML=`<div class="box"><div class="pempty"><b>Não foi possível carregar as detonações</b><br>${esc(errApp(DT.err))}<br><button type="button" class="btn2" data-detre style="margin-top:12px">Tentar de novo</button></div></div>`;return}
  const hoje=detHoje(),rows=DT.rows||[];
  const prox=rows.filter(r=>r.status==='programada'&&r.dia>=hoje).sort((a,b)=>a.dia===b.dia?(a.hora||'99')<(b.hora||'99')?-1:1:a.dia<b.dia?-1:1);
  const venc=rows.filter(detVencida),hist=rows.filter(r=>!prox.includes(r)&&!venc.includes(r));
  $('#detStamp').textContent=`${prox.length} ${prox.length===1?'programada':'programadas'} · ${rows.filter(r=>r.status==='realizada').length} realizadas no histórico`;
  let h='';
  const p=prox[0];
  if(p){const [,m,d]=p.dia.split('-');
    h+=`<section class="dthero" aria-label="Próxima detonação">
      <div class="dthk">Próxima detonação</div>
      <div class="dthd"><b>${DET_WD[wd(p.dia)]}, ${d}/${m}</b>${p.hora?`<span>${detHora(p.hora)}</span>`:''}</div>
      <div class="dthf">${esc(detFalta(p.dia))}${p.numero||p.local?` · ${esc(detNome(p))}`:''} · ${p.arquivos.length?`${p.arquivos.length} ${p.arquivos.length===1?'arquivo':'arquivos'} do plano de fogo`:'sem plano de fogo anexado'}</div>
      ${p.arquivos.length?detArqs(p):''}
    </section>`}
  else h+=`<section class="dthero vazio"><div class="dthk">Próxima detonação</div><div class="dthd"><b>Nenhuma programada</b></div><div class="dthf">${detSup()?'Toque em "Programar detonação" para lançar a data e anexar o plano de fogo.':'Quando o supervisor programar, a data e o plano de fogo aparecem aqui.'}</div></section>`;
  if(venc.length)h+=`<div class="box"><div class="dthead"><h2>Confirmar</h2><span>${venc.length} ${venc.length===1?'data já passou':'datas já passaram'} e ainda ${venc.length===1?'está':'estão'} como programada${venc.length===1?'':'s'}${detSup()?': toque em Editar e marque Realizada ou Cancelada':''}</span></div><div class="dtlist">${venc.map(detCard).join('')}</div></div>`;
  h+=`<div class="box"><div class="dthead"><h2>Programadas</h2><span>Da mais próxima para a mais distante</span></div>${prox.length?`<div class="dtlist">${prox.map(detCard).join('')}</div>`:'<div class="pempty">Nenhuma detonação programada.</div>'}</div>`;
  if(hist.length){const mostra=DT.hist?hist:hist.slice(0,8);
    h+=`<div class="box"><div class="dthead"><h2>Histórico</h2><span>Realizadas e canceladas, da mais recente para a mais antiga</span></div><div class="dtlist">${mostra.map(detCard).join('')}</div>${hist.length>8?`<div class="dtmore"><button type="button" class="fclear" data-dethist>${DT.hist?'Mostrar menos':`Mostrar todas (${hist.length})`}</button></div>`:''}</div>`}
  b.innerHTML=h;
}

/* Abre o arquivo por link temporário. A janela abre antes da busca para o navegador não bloquear. */
async function detAbrir(id){
  const a=(DT.rows||[]).flatMap(r=>r.arquivos).find(x=>x.id===id);if(!a)return;
  const w=window.open('','_blank');
  const {data,error}=await sb.storage.from(DET_BK).createSignedUrl(a.caminho,300,['pdf','jpg','jpeg','png','webp'].includes(detExt(a.nome))?undefined:{download:a.nome});
  if(error||!data){if(w)w.close();toast('Não foi possível abrir o arquivo. '+errApp(error||{}));return}
  if(w)w.location.href=data.signedUrl;else location.href=data.signedUrl;
}

/* ---------- formulário (supervisor) ---------- */
function detForm(id){
  if(!detSup())return;
  const r=id?(DT.rows||[]).find(x=>x.id===id):null;if(id&&!r)return;
  DTF={id:r?r.id:null,status:r?r.status:'programada',tirar:new Set(),novos:[]};
  const segSt=Object.entries(DET_ST).map(([k,v])=>`<button type="button" data-dtst="${k}" class="${DTF.status===k?'on':''}" aria-pressed="${DTF.status===k}">${v[0]}</button>`).join('');
  gOpen({k:'Detonação',t:r?'Editar detonação':'Programar detonação',ok:r?'Salvar':'Programar',w:560,body:`
    <div class="fs"><div class="mgrid">
      <label>Data<input class="tin" type="date" id="dtDia" value="${esc(r?r.dia:addDays(detHoje(),1))}" required></label>
      <label>Hora (se já souber)<input class="tin" type="time" id="dtHora" value="${esc(r?detHora(r.hora):'')}"></label></div></div>
    <div class="fs"><div class="mgrid">
      <label>Fogo nº<input class="tin" type="text" id="dtNum" inputmode="numeric" maxlength="5" placeholder="Ex.: 13" value="${esc(r&&r.numero?r.numero:detProxNum())}"></label>
      <label>Bancada / local<input class="tin" type="text" id="dtLocal" maxlength="120" placeholder="Ex.: Bancada B1P2" value="${esc(r?r.local:'')}"></label></div></div>
    ${r?`<div class="fs"><h4>Situação</h4><div class="seg" id="dtSt">${segSt}</div></div>`:''}
    <div class="fs"><h4>Observação</h4><textarea id="dtObs" rows="3" maxlength="1000" placeholder="Ex.: empresa responsável, nº de furos, volume, aviso à vizinhança">${esc(r?r.obs:'')}</textarea></div>
    <div class="fs"><h4>Plano de fogo</h4>
      <div id="dtArqs"></div>
      <label class="dtup"><input type="file" id="dtFile" multiple accept="${DET_ACEITA}"><span><svg viewBox="0 0 24 24"><path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>Anexar arquivos</span></label>
      <div class="fhint">PDF, foto, planilha, Word ou desenho (DWG/DXF), até 25 MB cada. Plano de fogo, ordem de serviço, volume da bancada, furação… Os arquivos sobem quando você toca em ${r?'Salvar':'Programar'}.</div></div>
    ${r?`<div class="fs"><button type="button" class="fclear dtdel" data-dtdel>Apagar esta detonação e os arquivos dela</button></div>`:''}`,
    onOk:detSalvar});
  detFormArqs();
}
/* Sugere o próximo número de fogo: maior já lançado + 1 */
function detProxNum(){const n=Math.max(0,...(DT.rows||[]).map(r=>r.numero||0));return n?String(n+1):''}
function detFormArqs(){
  const r=DTF.id?(DT.rows||[]).find(x=>x.id===DTF.id):null,ex=r?r.arquivos:[];
  const li=[...ex.map(a=>{const fora=DTF.tirar.has(a.id);return `<li class="${fora?'fora':''}"><span class="dtext">${esc(detExt(a.nome)||'arq')}</span><span class="dtfn">${esc(a.nome)}</span><small>${fora?'será removido':esc(detTam(a.tamanho))}</small><button type="button" class="xbtn" data-dtx="${esc(a.id)}" aria-label="${fora?'Manter':'Remover'} ${esc(a.nome)}">${fora?'↺':'×'}</button></li>`}),
    ...DTF.novos.map((f,i)=>`<li class="novo"><span class="dtext">${esc(detExt(f.name)||'arq')}</span><span class="dtfn">${esc(f.name)}</span><small>novo · ${esc(detTam(f.size))}</small><button type="button" class="xbtn" data-dtxn="${i}" aria-label="Tirar ${esc(f.name)}">×</button></li>`)];
  $('#dtArqs').innerHTML=li.length?`<ul class="dtflist">${li.join('')}</ul>`:'<div class="dtnone">Nenhum arquivo anexado ainda.</div>';
}
async function detSalvar(){
  const dia=$('#dtDia').value,hora=$('#dtHora').value||null,local=$('#dtLocal').value.trim().replace(/\s+/g,' '),obs=$('#dtObs').value.trim();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(dia))throw falha('Escolha a data da detonação.');
  const nt=$('#dtNum').value.trim(),numero=nt?+nt:null;
  if(nt&&!(/^\d{1,5}$/.test(nt)&&numero>0))throw falha('O número do fogo precisa ser só número (ex.: 13).');
  const reg={dia,hora,numero,local,obs,status:DTF.id?DTF.status:'programada'};
  ULT_SALVO=Date.now();let id=DTF.id;
  if(id){const {error}=await sb.from('detonacoes').update(reg).eq('id',id);if(error)throw error}
  else{const {data,error}=await sb.from('detonacoes').insert(reg).select('id').single();if(error)throw error;id=data.id;DTF.id=id}
  const erros=[];
  /* remove os marcados: arquivo primeiro, depois a linha (se o arquivo falhar, a linha fica e dá para tentar de novo) */
  const r=(DT.rows||[]).find(x=>x.id===id);
  for(const a of (r?r.arquivos:[]).filter(a=>DTF.tirar.has(a.id))){
    const {error:e1}=await sb.storage.from(DET_BK).remove([a.caminho]);
    if(e1){erros.push(a.nome);continue}
    const {error:e2}=await sb.from('detonacao_arquivos').delete().eq('id',a.id);if(e2)erros.push(a.nome)}
  for(const f of DTF.novos){
    const ext=detExt(f.name),cam=`${id}/${crypto.randomUUID()}${ext?'.'+ext:''}`;
    const $b=$('#gOk');if($b)$b.textContent=`Enviando ${f.name}…`;
    const {error:e1}=await sb.storage.from(DET_BK).upload(cam,f,{contentType:f.type||'application/octet-stream',upsert:false});
    if(e1){erros.push(f.name);continue}
    const {error:e2}=await sb.from('detonacao_arquivos').insert({detonacao_id:id,caminho:cam,nome:f.name.slice(0,200),tamanho:f.size,tipo:f.type||null});
    if(e2){erros.push(f.name);await sb.storage.from(DET_BK).remove([cam])}}
  ULT_SALVO=Date.now();DTF.novos=[];DTF.tirar.clear();
  await detLoad(true,true);
  if(erros.length){detFormArqs();throw falha(`A detonação foi salva, mas ${erros.length===1?'este arquivo não foi':'estes arquivos não foram'}: ${erros.join(', ')}. Tente de novo.`)}
  toast(`${numero?`Fogo ${numero}`:'Detonação'} de ${ddmm(dia)} salvo.`);
}
async function detApagar(){
  const r=(DT.rows||[]).find(x=>x.id===DTF.id);if(!r)return;
  if(!confirm(`Apagar a detonação de ${ddmm(r.dia)}${r.arquivos.length?` e ${r.arquivos.length===1?'o arquivo':'os '+r.arquivos.length+' arquivos'} do plano de fogo`:''}? Não dá para desfazer.`))return;
  GO.busy=true;$('#gErr').textContent='';ULT_SALVO=Date.now();
  try{
    if(r.arquivos.length){const {error}=await sb.storage.from(DET_BK).remove(r.arquivos.map(a=>a.caminho));if(error)throw error}
    const {error}=await sb.from('detonacoes').delete().eq('id',r.id);if(error)throw error;
    GO.busy=false;gClose();toast(`Detonação de ${ddmm(r.dia)} apagada.`);await detLoad(true,true);
  }catch(e){GO.busy=false;$('#gErr').textContent=errApp(e)}
}

/* ---------- eventos ---------- */
$('#detNova').onclick=()=>detForm(null);
$('#detBody').addEventListener('click',e=>{
  const t=e.target;
  const a=t.closest('[data-detarq]');if(a)return detAbrir(a.dataset.detarq);
  const ed=t.closest('[data-deted]');if(ed)return detForm(ed.dataset.deted);
  if(t.closest('[data-detre]'))return detLoad(true);
  if(t.closest('[data-dethist]')){DT.hist=!DT.hist;renderDet()}
});
$('#gB').addEventListener('click',e=>{
  if(!DTF||!$('#dtArqs'))return;const t=e.target;
  const st=t.closest('[data-dtst]');if(st){DTF.status=st.dataset.dtst;$$('#dtSt button').forEach(b=>{const on=b===st;b.classList.toggle('on',on);b.setAttribute('aria-pressed',on)});return}
  const x=t.closest('[data-dtx]');if(x){const k=x.dataset.dtx;DTF.tirar.has(k)?DTF.tirar.delete(k):DTF.tirar.add(k);detFormArqs();return}
  const xn=t.closest('[data-dtxn]');if(xn){DTF.novos.splice(+xn.dataset.dtxn,1);detFormArqs();return}
  if(t.closest('[data-dtdel]'))detApagar();
});
$('#gB').addEventListener('change',e=>{
  if(e.target.id!=='dtFile'||!DTF)return;
  const grandes=[];[...e.target.files].forEach(f=>{if(f.size>DET_MAX)grandes.push(f.name);else if(!DTF.novos.some(n=>n.name===f.name&&n.size===f.size))DTF.novos.push(f)});
  e.target.value='';detFormArqs();
  $('#gErr').textContent=grandes.length?`Passa de 25 MB e ficou de fora: ${grandes.join(', ')}.`:'';
});
