const express = require('express');
const fetch = require('node-fetch');
const { google } = require('googleapis');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const TELEGRAM_TOKEN     = process.env.TELEGRAM_TOKEN;
const SHEET_ID           = process.env.SHEET_ID;
const CALENDAR_ID        = process.env.CALENDAR_ID;
const GOOGLE_CREDENTIALS = process.env.GOOGLE_CREDENTIALS
  ? JSON.parse(process.env.GOOGLE_CREDENTIALS)
  : null;

const CATEGORIAS_SAIDA = [
  'Alimentação','Casa','Transporte','Saúde','Educação',
  'Lazer','Vestuário','Assinaturas','Pet','Investimento','Outros'
];
const CATEGORIAS_ENTRADA = [
  'Salário Jakson','Salário Dany','Freelance Jakson',
  'Freelance Dany','Rendimento','Presente','Outras entradas'
];
const FORMAS_PAGAMENTO = ['pix','debito','crédito','credito','dinheiro','ted','doc'];
const MESES = {
  'janeiro':1,'fevereiro':2,'março':3,'abril':4,'maio':5,'junho':6,
  'julho':7,'agosto':8,'setembro':9,'outubro':10,'novembro':11,'dezembro':12
};

// Contas reconhecidas no lançamento
const CONTAS_PALAVRAS = {
  'c6dany':'C6 Dany','c6 dany':'C6 Dany','dany':'C6 Dany',
  'c6jakson':'C6 Jakson','c6 jakson':'C6 Jakson','jakson':'C6 Jakson',
  'c6j':'C6 Jakson','c6':'C6 J. crédito',
  'neon':'Neon crédito','carteira':'Carteira','dinheiro':'Carteira'
};

const pendentes = {};
let ultimoMesVerificado = null;

// ============================================================
//  HELPERS DE MÊS
// ============================================================
function mesAnoAtual() {
  const h = new Date();
  return `${String(h.getMonth()+1).padStart(2,'0')}/${h.getFullYear()}`;
}
function mesAnoAnterior() {
  const h = new Date();
  h.setMonth(h.getMonth()-1);
  return `${String(h.getMonth()+1).padStart(2,'0')}/${h.getFullYear()}`;
}

// ============================================================
//  DETECTAR CONTA A PARTIR DO LANÇAMENTO
// ============================================================
function detectarConta(tokens, usados, forma, username) {
  // 1. Verifica se algum token é uma conta explícita
  for (let i = 0; i < tokens.length; i++) {
    if (usados.has(i)) continue;
    const t = tokens[i].toLowerCase();
    // tenta combinar token com próximo para "c6 dany" etc
    const par = i+1 < tokens.length ? t + ' ' + tokens[i+1].toLowerCase() : null;
    if (par && CONTAS_PALAVRAS[par]) {
      usados.add(i); usados.add(i+1);
      return CONTAS_PALAVRAS[par];
    }
    if (CONTAS_PALAVRAS[t] && t !== 'dinheiro') { // dinheiro já é forma de pgto
      usados.add(i);
      return CONTAS_PALAVRAS[t];
    }
  }

  // 2. Regra padrão pela forma + usuário
  const f = (forma || '').toLowerCase();
  const u = (username || '').toLowerCase();
  if (f === 'dinheiro') return 'Carteira';
  if (f === 'credito' || f === 'crédito') return 'Neon crédito';
  // pix / debito / ted / doc / pix → pela pessoa
  if (u === 'dany' || u.includes('dany')) return 'C6 Dany';
  return 'C6 Jakson'; // padrão Jakson
}

// ============================================================
//  CÓPIA AUTOMÁTICA DE METAS NO INÍCIO DO MÊS
// ============================================================
async function verificarECopiarMetas() {
  const mesAtual = mesAnoAtual();
  if (ultimoMesVerificado === mesAtual) return;
  ultimoMesVerificado = mesAtual;

  try {
    const { sheets } = await getSheetsClient();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID, range: 'Página2!A:D'
    });
    const rows = res.data.values || [];
    const jaExiste = rows.slice(1).some(r => (r[3]||'').trim() === mesAtual);
    if (jaExiste) return;

    const mesAnt = mesAnoAnterior();
    let fonte = rows.slice(1).filter(r => (r[3]||'').trim() === mesAnt);
    if (fonte.length === 0) fonte = rows.slice(1).filter(r => !r[3] || r[3].trim() === '');
    if (fonte.length === 0) return;

    const novas = fonte.map(r => [r[0]||'', r[1]||'', r[2]||'', mesAtual]);
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID, range: 'Página2!A:D',
      valueInputOption: 'USER_ENTERED',
      resource: { values: novas }
    });
    console.log(`✅ Metas copiadas para ${mesAtual}`);
  } catch(err) { console.error('Erro ao copiar metas:', err); }
}

// ============================================================
//  WEBHOOK + PING (anti-sleep Render)
// ============================================================
app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  try { await handleUpdate(req.body); }
  catch(err) { console.error('Erro webhook:', err); }
});

app.get('/', (req, res) => res.send('Bot Financeiro Casa rodando!'));
app.get('/ping', (req, res) => res.json({ status: 'ok', ts: Date.now() }));

// ============================================================
//  HANDLER PRINCIPAL
// ============================================================
async function handleUpdate(update) {
  // Copia metas do mês anterior se necessário (roda em background)
  verificarECopiarMetas().catch(console.error);

  if (update.callback_query) { await handleCallback(update.callback_query); return; }

  const message = update.message || update.edited_message;
  if (!message) return;

  const chatId   = message.chat.id;
  const username = message.from.username || message.from.first_name || 'desconhecido';
  const text     = message.text || '';
  const tl       = text.toLowerCase().trim();

  if (message.photo && message.photo.length > 0) { await handleSemIA(chatId, message.caption||'', username); return; }
  if (pendentes[chatId]) { await handleConfirmacao(chatId, tl); return; }

  if (tl.startsWith('/gasto')      || tl.startsWith('gasto'))      { await handleLancamento(chatId, text, username, 'Saída');   return; }
  if (tl.startsWith('/entrada')    || tl.startsWith('entrada'))    { await handleLancamento(chatId, text, username, 'Entrada'); return; }
  if (tl.startsWith('/apagar')     || tl.startsWith('apagar')     || tl.startsWith('a pagar')) { await handleApagar(chatId, text, username); return; }
  if (tl.startsWith('/editar')     || tl.startsWith('editar'))     { await handleEditar(chatId, text, username);                return; }
  if (tl.startsWith('/excluir')    || tl.startsWith('excluir'))    { await handleExcluir(chatId, text);                        return; }
  if (tl.startsWith('/resumo')     || tl.startsWith('resumo')  ||
      tl.startsWith('/saldo')      || tl.startsWith('saldo'))      { await handleResumo(chatId);                               return; }
  if (tl.startsWith('/ultimos')    || tl.startsWith('ultimos'))    { await handleUltimos(chatId);                              return; }
  if (tl.startsWith('/categorias') || tl.startsWith('categorias')) { await handleCategorias(chatId);                          return; }
  if (tl.startsWith('/metas')      || tl.startsWith('metas'))      { await handleMetas(chatId);                               return; }
  if (tl.startsWith('/contas')     || tl.startsWith('contas'))     { await handleContas(chatId);                              return; }
  if (tl.startsWith('/menu')       || tl.startsWith('menu')    ||
      tl.startsWith('/ajuda')      || tl.startsWith('ajuda')   ||
      tl === '/start')                                              { await handleMenu(chatId);                                return; }
}

// ============================================================
//  CALLBACK DE BOTÕES
// ============================================================
async function handleCallback(query) {
  const chatId = query.message.chat.id;
  const data   = query.data;
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/answerCallbackQuery`, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ callback_query_id: query.id })
  });
  switch(data) {
    case 'como_gasto':
      await sendMessage(chatId,
        `💸 *Como lançar uma saída:*\n\n` +
        `*Formato:* gasto [valor] [descrição] [categoria] [forma] [parcelas] [data] [-- obs]\n\n` +
        `*Exemplos:*\n• gasto 45,90 mercado Alimentação\n• gasto 45,90 mercado Alimentação pix\n` +
        `• gasto 1200 geladeira Casa credito 3x\n• gasto 250 farmacia Saúde debito 30/05\n` +
        `• gasto 80 roupa Vestuário credito c6\n• gasto 50 padaria Alimentação pix dany\n\n` +
        `_Apenas valor e descrição são obrigatórios!_`
      ); break;
    case 'como_entrada':
      await sendMessage(chatId,
        `💰 *Como lançar uma entrada:*\n\n` +
        `*Formato:* entrada [valor] [descrição] [categoria] [forma] [data]\n\n` +
        `*Exemplos:*\n• entrada 5000 salario\n• entrada 5000 salario "Salário Jakson" pix 05/06\n\n` +
        `_Apenas valor e descrição são obrigatórios!_`
      ); break;
    case 'como_apagar':
      await sendMessage(chatId,
        `📋 *Como lançar conta a pagar:*\n\n` +
        `*Formato:* apagar [valor] [descrição] [dd/mm]\n\n` +
        `*Exemplos:*\n• apagar 150,00 conta-luz 15/06\n• apagar 89,90 netflix 10/06`
      ); break;
    case 'como_editar':
      await sendMessage(chatId,
        `✏️ *Como editar:*\n\n` +
        `editar [linha] [valor] [descrição] [categoria]\n\n` +
        `• editar 5 65,00 mercado Alimentação`
      ); break;
    case 'como_excluir':
      await sendMessage(chatId,
        `🗑️ *Como excluir:*\n\nexcluir [linha]\n\n• excluir 5`
      ); break;
    case 'ver_categorias':  await handleCategorias(chatId); break;
    case 'ver_formas':
      await sendMessage(chatId,
        `💳 *Formas de pagamento:*\n\n• pix\n• debito\n• credito\n• dinheiro\n• ted\n• doc\n\n` +
        `*Contas (opcional):*\n• _credito c6_ → C6 J. crédito\n• _pix dany_ → C6 Dany\n• _neon_ → Neon crédito`
      ); break;
    case 'ver_resumo':  await handleResumo(chatId);  break;
    case 'ver_ultimos': await handleUltimos(chatId); break;
    case 'ver_metas':   await handleMetas(chatId);   break;
    case 'ver_contas':  await handleContas(chatId);  break;
  }
}

// ============================================================
//  MENU
// ============================================================
async function handleMenu(chatId) {
  await sendMessageWithButtons(chatId,
    `👋 *Financeiro Casa - Menu*\n\nO que você quer fazer?`,
    [
      [{ text:'💸 Como lançar gasto',    callback_data:'como_gasto'    },
       { text:'💰 Como lançar entrada',  callback_data:'como_entrada'  }],
      [{ text:'📋 Conta a pagar',        callback_data:'como_apagar'   }],
      [{ text:'✏️ Como editar',          callback_data:'como_editar'   },
       { text:'🗑️ Como excluir',         callback_data:'como_excluir'  }],
      [{ text:'📊 Resumo do mês',        callback_data:'ver_resumo'    },
       { text:'📋 Últimos lançamentos',  callback_data:'ver_ultimos'   }],
      [{ text:'🎯 Metas',                callback_data:'ver_metas'     },
       { text:'🏦 Contas e cartões',     callback_data:'ver_contas'    }],
      [{ text:'🏷️ Categorias',           callback_data:'ver_categorias'},
       { text:'💳 Formas de pagamento',  callback_data:'ver_formas'    }],
    ]
  );
}

// ============================================================
//  PARSER INTELIGENTE
// ============================================================
function parsearLancamento(text, tipo, username) {
  let raw = text.replace(/^\/?(?:gasto|entrada)\s*/i,'').trim();
  let observacao = '';
  if (raw.includes('--')) {
    const p = raw.split('--');
    raw = p[0].trim(); observacao = p[1].trim();
  }

  const tokens = raw.split(/\s+/);
  let valor = null, categoria = null, formaPgto = '', parcelas = '1', dataGasto = null;
  const usados = new Set();

  // Valor
  for (let i = 0; i < tokens.length; i++) {
    const n = parseFloat(tokens[i].replace(',','.'));
    if (!isNaN(n) && tokens[i].match(/[\d,\.]+/)) { valor = n; usados.add(i); break; }
  }
  // Parcelas
  for (let i = 0; i < tokens.length; i++) {
    if (usados.has(i)) continue;
    if (/^\d+x$/i.test(tokens[i])) { parcelas = tokens[i].replace(/x/i,''); usados.add(i); }
  }
  // Forma de pagamento
  for (let i = 0; i < tokens.length; i++) {
    if (usados.has(i)) continue;
    const t = tokens[i].toLowerCase();
    if (FORMAS_PAGAMENTO.includes(t)) { formaPgto = capitalizar(tokens[i]); usados.add(i); break; }
  }
  // Data
  for (let i = 0; i < tokens.length; i++) {
    if (usados.has(i)) continue;
    const d = parsearData(tokens[i], tokens[i+1]);
    if (d) { dataGasto = d.data; usados.add(i); if (d.consumiu2) usados.add(i+1); }
  }
  // Categoria
  const lista = tipo === 'Entrada' ? CATEGORIAS_ENTRADA : CATEGORIAS_SAIDA;
  for (let i = 0; i < tokens.length; i++) {
    if (usados.has(i)) continue;
    const t = tokens[i].toLowerCase();
    const cat = lista.find(c => c.toLowerCase().startsWith(t) || t.startsWith(c.toLowerCase().split(' ')[0]));
    if (cat) { categoria = cat; usados.add(i); break; }
  }
  // Conta (passa usados para marcar tokens consumidos)
  const conta = detectarConta(tokens, usados, formaPgto, username);

  // Descrição = o que sobrou
  const descricao = capitalizar(tokens.filter((_,i) => !usados.has(i)).join(' ') || 'Sem descrição');

  if (!dataGasto) dataGasto = new Date().toLocaleDateString('pt-BR', { timeZone:'America/Sao_Paulo' });
  if (!categoria) categoria = tipo === 'Saída' ? 'Outros' : 'Outras entradas';

  return { valor, descricao, categoria, formaPgto, parcelas, dataGasto, observacao, conta };
}

// ============================================================
//  PARSER DE DATA
// ============================================================
function parsearData(token, tokenNext) {
  if (!token) return null;
  const t = token.toLowerCase();
  if (t === 'ontem') {
    const d = new Date(); d.setDate(d.getDate()-1);
    return { data: d.toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'}), consumiu2:false };
  }
  if (t === 'hoje') return { data: new Date().toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'}), consumiu2:false };
  const m1 = token.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (m1) {
    const dia = m1[1].padStart(2,'0'), mes = m1[2].padStart(2,'0');
    const ano = m1[3] ? (m1[3].length===2?'20'+m1[3]:m1[3]) : new Date().getFullYear();
    return { data:`${dia}/${mes}/${ano}`, consumiu2:false };
  }
  if (/^(\d{1,2})$/.test(token) && tokenNext) {
    const tn = tokenNext.toLowerCase().replace(/^de\s+|^do\s+/,'');
    const mesNum = MESES[tn] || parseInt(tn);
    if (mesNum >= 1 && mesNum <= 12) {
      return { data:`${token.padStart(2,'0')}/${String(mesNum).padStart(2,'0')}/${new Date().getFullYear()}`, consumiu2:true };
    }
  }
  return null;
}

// ============================================================
//  METAS
// ============================================================
async function getMetas(mesAno) {
  try {
    const { sheets } = await getSheetsClient();
    const res = await sheets.spreadsheets.values.get({ spreadsheetId:SHEET_ID, range:'Página2!A:D' });
    const rows = res.data.values || [];
    const mes = mesAno || mesAnoAtual();
    const metas = {};
    // Primeiro tenta pegar do mês específico, depois sem mês (legado)
    for (const row of rows.slice(1)) {
      const cat  = (row[0]||'').trim();
      const val  = parseFloat((row[1]||'0').toString().replace(',','.')) || 0;
      const tipo = (row[2]||'Gasto').trim();
      const rm   = (row[3]||'').trim();
      if (!cat || !val) continue;
      if (rm === mes || rm === '') metas[cat] = { meta:val, tipo };
    }
    return metas;
  } catch(e) { return {}; }
}

async function getGastoMesCategoria(categoria, mesAno) {
  try {
    const rows = await getSheetRows();
    const mes = mesAno || mesAnoAtual();
    let total = 0;
    for (const row of rows.slice(1)) {
      if (!row[0] || row[9] !== mes) continue;
      if ((row[3]||'').trim() === categoria && row[5] !== 'Entrada') total += parseFloat(row[2])||0;
    }
    return total;
  } catch(e) { return 0; }
}

async function getMensagemMeta(categoria, mesAno) {
  const metas = await getMetas(mesAno);
  if (!metas[categoria]) return null;
  const { meta, tipo } = metas[categoria];
  const gasto    = await getGastoMesCategoria(categoria, mesAno);
  const restante = meta - gasto;
  const pct      = Math.min(100,(gasto/meta*100)).toFixed(0);
  if (tipo === 'Investimento') {
    return gasto >= meta
      ? `🎯 *${categoria}:* Meta atingida! R$ ${fmt(gasto)} de R$ ${fmt(meta)}`
      : `🎯 *${categoria}:* R$ ${fmt(gasto)} investido — faltam R$ ${fmt(Math.abs(restante))}`;
  }
  if (restante < 0) return `⚠️ *Meta de ${categoria} ultrapassada!* R$ ${fmt(gasto)} de R$ ${fmt(meta)} (${pct}%)`;
  return `🎯 *${categoria}:* R$ ${fmt(gasto)} de R$ ${fmt(meta)} — saldo R$ ${fmt(restante)}`;
}

async function handleMetas(chatId) {
  const mes   = mesAnoAtual();
  const metas = await getMetas(mes);
  if (Object.keys(metas).length === 0) {
    await sendMessage(chatId, '📋 Nenhuma meta cadastrada na aba *Página2* da planilha.'); return;
  }
  const rows = await getSheetRows();
  const gastos = {};
  for (const row of rows.slice(1)) {
    if (!row[0] || row[9] !== mes) continue;
    const cat = (row[3]||'').trim();
    if (row[5] !== 'Entrada') gastos[cat] = (gastos[cat]||0) + (parseFloat(row[2])||0);
  }
  const nomeMes = new Date().toLocaleDateString('pt-BR',{month:'long',year:'numeric',timeZone:'America/Sao_Paulo'});
  let msg = `🎯 *Metas — ${nomeMes}*\n\n`;
  for (const [cat, { meta, tipo }] of Object.entries(metas)) {
    const gasto    = gastos[cat]||0;
    const restante = meta - gasto;
    const pct      = Math.min(100,(gasto/meta*100)).toFixed(0);
    const barra    = '█'.repeat(Math.round(Math.min(1,gasto/meta)*8)) + '░'.repeat(8-Math.round(Math.min(1,gasto/meta)*8));
    if (tipo === 'Investimento') {
      msg += `${gasto>=meta?'✅':'📈'} *${cat}* (Investimento)\n${barra} ${pct}%\n`;
      msg += `R$ ${fmt(gasto)} de R$ ${fmt(meta)}${gasto>=meta?' ✓ Meta atingida!':`  — faltam R$ ${fmt(restante)}`}\n\n`;
    } else {
      const emoji = restante<0?'🔴':restante<meta*0.2?'🟡':'🟢';
      msg += `${emoji} *${cat}*\n${barra} ${pct}%\n`;
      msg += `R$ ${fmt(gasto)} de R$ ${fmt(meta)}${restante<0?` ⚠️ Passou R$ ${fmt(Math.abs(restante))}`:` — saldo R$ ${fmt(restante)}`}\n\n`;
    }
  }
  msg += `_Edite as metas na aba Página2 da planilha_`;
  await sendMessage(chatId, msg);
}

// ============================================================
//  CONTAS E CARTÕES
// ============================================================
async function getContas() {
  try {
    const { sheets } = await getSheetsClient();
    const res = await sheets.spreadsheets.values.get({ spreadsheetId:SHEET_ID, range:'Página3!A:D' });
    const rows = res.data.values || [];
    return rows.slice(1).filter(r => r[0]).map(r => ({
      nome:         (r[0]||'').trim(),
      tipo:         (r[1]||'').trim(),
      limite:       parseFloat((r[2]||'0').toString().replace(/[R$\s\.]/g,'').replace(',','.')) || 0,
      saldoInicial: parseFloat((r[3]||'0').toString().replace(/[R$\s\.]/g,'').replace(',','.')) || 0,
    }));
  } catch(e) { return []; }
}

async function handleContas(chatId) {
  const contas = await getContas();
  if (contas.length === 0) { await sendMessage(chatId, '📋 Nenhuma conta cadastrada na aba *Página3* da planilha.'); return; }

  const rows   = await getSheetRows();
  const mes    = mesAnoAtual();

  // Calcula movimentação por conta no mês
  const movMes = {};
  for (const row of rows.slice(1)) {
    if (!row[0]) continue;
    const conta = (row[11]||'').trim(); // coluna L
    if (!conta) continue;
    const valor = parseFloat(row[2])||0;
    if (!movMes[conta]) movMes[conta] = { entradas:0, saidas:0, faturaAtual:0 };
    if (row[5]==='Entrada') movMes[conta].entradas += valor;
    else if (row[5]==='Saída') {
      movMes[conta].saidas += valor;
      if (row[9]===mes) movMes[conta].faturaAtual += valor;
    }
  }

  const nomeMes = new Date().toLocaleDateString('pt-BR',{month:'long',year:'numeric',timeZone:'America/Sao_Paulo'});
  let msg = `🏦 *Contas e Cartões — ${nomeMes}*\n\n`;

  for (const c of contas) {
    const mov = movMes[c.nome] || { entradas:0, saidas:0, faturaAtual:0 };
    if (c.tipo === 'Cartão crédito') {
      const usado     = mov.faturaAtual;
      const disponivel = c.limite - usado;
      msg += `💳 *${c.nome}*\n`;
      msg += `Fatura: R$ ${fmt(usado)} de R$ ${fmt(c.limite)}\n`;
      msg += `Disponível: R$ ${fmt(disponivel)}\n`;
      const barra = '█'.repeat(Math.round(Math.min(1,usado/c.limite)*8))+'░'.repeat(8-Math.round(Math.min(1,usado/c.limite)*8));
      msg += `${barra} ${Math.min(100,(usado/c.limite*100)).toFixed(0)}%\n\n`;
    } else {
      const saldo = c.saldoInicial + mov.entradas - mov.saidas;
      const emoji = saldo >= 0 ? '🟢' : '🔴';
      msg += `${emoji} *${c.nome}* (${c.tipo})\n`;
      msg += `Saldo: R$ ${fmt(saldo)}\n\n`;
    }
  }
  msg += `_Atualize saldos iniciais na aba Página3 da planilha_`;
  await sendMessage(chatId, msg);
}

// ============================================================
//  HANDLER — lançamento
// ============================================================
async function handleLancamento(chatId, text, username, tipo) {
  const p = parsearLancamento(text, tipo, username);
  if (!p.valor || isNaN(p.valor)) {
    const cmd = tipo==='Saída'?'gasto':'entrada';
    await sendMessage(chatId, `⚠️ Não encontrei o valor.\nUse: ${cmd} 45,90 descrição`); return;
  }
  const registradoEm = new Date().toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'});
  const mesAno = calcularMesAno(p.dataGasto);
  const dadosBase = { ...p, username, tipo, registradoEm, mesAno };

  const duplicata = await verificarDuplicata(p.valor, p.descricao);
  if (duplicata) {
    pendentes[chatId] = { dados: dadosBase };
    await sendMessage(chatId,
      `⚠️ *Lançamento similar encontrado!*\n` +
      `📌 Linha #${duplicata.linha} | ${duplicata.descricao} | R$ ${parseFloat(duplicata.valor).toFixed(2)} | ${duplicata.data}\n\n` +
      `Confirma o novo lançamento?\n\n✅ *sim*  ou  ❌ *não*`
    ); return;
  }
  await salvarLancamento(chatId, dadosBase);
}

async function handleConfirmacao(chatId, tl) {
  const pendente = pendentes[chatId];
  delete pendentes[chatId];
  if (tl==='sim'||tl==='s') await salvarLancamento(chatId, pendente.dados);
  else await sendMessage(chatId, '❌ Lançamento cancelado!');
}

async function salvarLancamento(chatId, d) {
  const numParcelas = parseInt(d.parcelas)||1;
  if (numParcelas > 1) {
    const linhas = [];
    for (let i = 0; i < numParcelas; i++) {
      const dataParc = somarMeses(d.dataGasto, i);
      const mesAno   = calcularMesAno(dataParc);
      const desc     = `${d.descricao} (${i+1}/${numParcelas})`;
      const linha    = await appendToSheet(dataParc, desc, d.valor/numParcelas, d.categoria, d.username, d.tipo, d.formaPgto, `${i+1}/${numParcelas}`, d.observacao, mesAno, d.registradoEm, d.conta);
      linhas.push(linha);
    }
    const emoji = d.tipo==='Saída'?'💸':'💰';
    await sendMessage(chatId,
      `${emoji} *${numParcelas}x registradas!*\n📝 ${d.descricao}\n` +
      `💵 Total: R$ ${fmt(d.valor)} | Parcela: R$ ${fmt(d.valor/numParcelas)}\n` +
      `🏷️ ${d.categoria} | 💳 ${d.formaPgto||'Não informada'} | 🏦 ${d.conta}\n` +
      `📌 Linhas: #${linhas.join(', #')}`
    );
  } else {
    const linha = await appendToSheet(d.dataGasto, d.descricao, d.valor, d.categoria, d.username, d.tipo, d.formaPgto, '', d.observacao, d.mesAno, d.registradoEm, d.conta);
    const emoji = d.tipo==='Saída'?'💸':'💰';
    let msg =
      `${emoji} *Lançado!* ${d.descricao} — R$ ${fmt(d.valor)}\n` +
      `📅 ${d.dataGasto} | 🏷️ ${d.categoria}\n` +
      `💳 ${d.formaPgto||'Não informada'} | 🏦 ${d.conta}\n` +
      (d.observacao ? `📌 ${d.observacao}\n` : '') +
      `👤 ${d.username} | 📌 Linha #${linha}\n`;

    if (d.tipo==='Saída') {
      const msgMeta = await getMensagemMeta(d.categoria, d.mesAno);
      if (msgMeta) msg += `\n${msgMeta}`;
    }
    msg += `\n\n_editar ${linha} valor descrição_\n_excluir ${linha}_`;
    await sendMessage(chatId, msg);
  }
}

// ============================================================
//  HANDLER — contas a pagar
// ============================================================
async function handleApagar(chatId, text, username) {
  const semCmd = text.replace(/^\/?a\s?pagar\s*/i,'').trim().split(' ');
  if (semCmd.length < 3) { await sendMessage(chatId,'⚠️ Use: apagar 150,00 descrição dd/mm'); return; }
  const valor   = parseFloat(semCmd[0].replace(',','.'));
  const desc    = capitalizar(semCmd[1]);
  const vencStr = semCmd[2];
  if (isNaN(valor)) { await sendMessage(chatId,'⚠️ Valor inválido.'); return; }
  const dataVenc = parsearDataCompleta(vencStr);
  if (!dataVenc) { await sendMessage(chatId,'⚠️ Data inválida. Use dd/mm. Ex: 15/06'); return; }

  const dataHoje     = new Date().toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'});
  const registradoEm = new Date().toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'});
  const dataVencFormatada = dataVenc.toLocaleDateString();
  const mesAno       = calcularMesAno(dataVencFormatada);
  const linha = await appendToSheet(dataVencFormatada, desc, valor, 'Casa', username, 'A Pagar', '', '', 'Lancado em '+dataHoje, mesAno, registradoEm, '');

  let calMsg = '', calEventId = '';
  try {
    calEventId = await criarEventoCalendar(desc, valor, dataVenc, vencStr);
    calMsg = `📅 Lembrete criado no Calendar!`;
    // Salva o ID do evento na coluna M
    if (calEventId) await salvarCalendarId(linha, calEventId);
  } catch(e) { calMsg = `⚠️ Erro ao criar lembrete no Calendar.`; }

  await sendMessage(chatId,
    `📋 *Conta a pagar registrada!*\n📝 ${desc} | R$ ${fmt(valor)}\n⏰ Vencimento: ${vencStr}\n👤 ${username} | 📌 Linha #${linha}\n${calMsg}`
  );
}

// ============================================================
//  HANDLER — editar
// ============================================================
async function handleEditar(chatId, text, username) {
  const partes = text.replace(/^\/?editar\s*/i,'').trim().split(' ');
  if (partes.length < 2) { await sendMessage(chatId,'⚠️ Use: editar linha valor descrição categoria'); return; }
  const linhaNum = parseInt(partes[0]);
  if (isNaN(linhaNum)) { await sendMessage(chatId,'⚠️ Número de linha inválido.'); return; }
  const valorT = parseFloat((partes[1]||'').replace(',','.'));
  if (isNaN(valorT)) { await sendMessage(chatId,`⚠️ Valor inválido.\nEx: editar ${linhaNum} 65,00 mercado Alimentação`); return; }

  const descricao  = capitalizar(partes[2]||'Sem descrição');
  const catDigitada = partes.slice(3).join(' ')||'';
  const dataHoje   = new Date().toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'});
  const regEm      = new Date().toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'});

  let tipoExistente = 'Saída', contaExistente = '';
  try {
    const rows = await getSheetRows();
    const row  = rows[linhaNum-1];
    if (row) { tipoExistente = row[5]||'Saída'; contaExistente = row[11]||''; }
  } catch(e) {}

  const categoria = encontrarCategoria(catDigitada, tipoExistente) || (tipoExistente==='Entrada'?'Outras entradas':'Outros');
  const mesAno    = calcularMesAno(dataHoje);
  await editarLinha(linhaNum, dataHoje, descricao, valorT, categoria, username, tipoExistente, '', '', '', mesAno, regEm, contaExistente);
  await sendMessage(chatId, `✏️ *Linha #${linhaNum} editada!*\n📝 ${descricao} | R$ ${fmt(valorT)} | ${categoria} | 🏦 ${contaExistente||'—'}`);
}

// ============================================================
//  HANDLER — excluir
// ============================================================
async function handleExcluir(chatId, text) {
  const linhaNum = parseInt(text.replace(/^\/?excluir\s*/i,'').trim());
  if (isNaN(linhaNum)) { await sendMessage(chatId,'⚠️ Use: excluir 5'); return; }

  // Verifica se tem evento no Calendar (coluna M) antes de excluir a linha
  let calMsg = '';
  try {
    const rows = await getSheetRows();
    const row  = rows[linhaNum - 1];
    const eventId = row && row[12] ? row[12].trim() : null;
    if (eventId) {
      await excluirEventoCalendar(eventId);
      calMsg = ' e lembrete do Calendar removido';
    }
  } catch(e) {}

  await excluirLinha(linhaNum);
  await sendMessage(chatId, `🗑️ Linha #${linhaNum} excluída${calMsg}!`);
}

// ============================================================
//  HANDLER — últimos
// ============================================================
async function handleUltimos(chatId) {
  try {
    const rows = await getSheetRows();
    const dados = rows.slice(1).map((row,i) => ({linha:i+2,row})).filter(({row})=>row[0]).slice(-10).reverse();
    if (!dados.length) { await sendMessage(chatId,'Nenhum lançamento encontrado.'); return; }
    let msg = `📋 *Últimos lançamentos:*\n\n`;
    dados.forEach(({linha,row}) => {
      const emoji = row[5]==='Entrada'?'💰':row[5]==='A Pagar'?'📋':'💸';
      const conta = row[11] ? ` | ${row[11]}` : '';
      msg += `${emoji} *#${linha}* | ${row[0]} | ${row[1]} | R$ ${parseFloat(row[2]).toFixed(2)}${conta}\n`;
    });
    msg += `\n_editar linha valor descrição_\n_excluir linha_`;
    await sendMessage(chatId, msg);
  } catch(e) { await sendMessage(chatId,'❌ Erro ao buscar lançamentos.'); }
}

// ============================================================
//  HANDLER — resumo
// ============================================================
async function handleResumo(chatId) {
  try {
    const rows = await getSheetRows();
    const mes  = mesAnoAtual();
    let totEnt = 0, totSai = 0, totPag = 0;
    const porCat = {}, porForma = {}, porConta = {};
    for (const row of rows.slice(1)) {
      if (!row[0] || row[9] !== mes) continue;
      const valor = parseFloat(row[2])||0;
      const tipo  = row[5]||'Saída';
      const cat   = row[3]||'Outros';
      const forma = row[6]||'Não informada';
      const conta = row[11]||'—';
      if (tipo==='Entrada') { totEnt+=valor; }
      else if (tipo==='A Pagar') { totPag+=valor; }
      else { totSai+=valor; porCat[cat]=(porCat[cat]||0)+valor; porForma[forma]=(porForma[forma]||0)+valor; porConta[conta]=(porConta[conta]||0)+valor; }
    }
    const nomeMes = new Date().toLocaleDateString('pt-BR',{month:'long',year:'numeric',timeZone:'America/Sao_Paulo'});
    let msg = `📊 *Resumo de ${nomeMes}*\n\n💰 Entradas: R$ ${fmt(totEnt)}\n💸 Saídas: R$ ${fmt(totSai)}\n`;
    if (totPag>0) msg += `📋 A Pagar: R$ ${fmt(totPag)}\n`;
    msg += `📈 *Saldo: R$ ${fmt(totEnt-totSai)}*\n`;
    if (Object.keys(porCat).length) {
      msg += `\n*Por categoria:*\n`;
      Object.entries(porCat).sort((a,b)=>b[1]-a[1]).forEach(([c,v]) => msg += `🏷️ ${c}: R$ ${fmt(v)}\n`);
    }
    if (Object.keys(porConta).length) {
      msg += `\n*Por conta:*\n`;
      Object.entries(porConta).sort((a,b)=>b[1]-a[1]).forEach(([c,v]) => msg += `🏦 ${c}: R$ ${fmt(v)}\n`);
    }
    await sendMessage(chatId, msg);
  } catch(e) { await sendMessage(chatId,'❌ Erro ao buscar resumo.'); }
}

// ============================================================
//  HANDLER — categorias
// ============================================================
async function handleCategorias(chatId) {
  await sendMessage(chatId,
    `🏷️ *Categorias disponíveis*\n\n*💸 Saídas:*\n${CATEGORIAS_SAIDA.map(c=>`• ${c}`).join('\n')}\n\n*💰 Entradas:*\n${CATEGORIAS_ENTRADA.map(c=>`• ${c}`).join('\n')}`
  );
}

// ============================================================
//  HANDLER — sem IA
// ============================================================
async function handleSemIA(chatId, caption, username) {
  if (caption) await handleLancamento(chatId, 'gasto '+caption, username, 'Saída');
  else await sendMessage(chatId,'📸 Foto recebida!\nMande com legenda: 45,90 mercado Alimentação pix');
}

// ============================================================
//  UTILITÁRIOS
// ============================================================
function capitalizar(t) { if (!t) return t; return t.charAt(0).toUpperCase()+t.slice(1).toLowerCase(); }
function fmt(n) { return Number(n).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}); }

function encontrarCategoria(texto, tipo) {
  if (!texto) return null;
  const lista = tipo==='Entrada' ? CATEGORIAS_ENTRADA : CATEGORIAS_SAIDA;
  const lower = texto.toLowerCase();
  return lista.find(c => c.toLowerCase().includes(lower) || lower.includes(c.toLowerCase().split(' ')[0]));
}

function calcularMesAno(dataStr) {
  if (!dataStr) return '';
  const p = dataStr.split('/');
  if (p.length < 2) return '';
  return `${p[1].padStart(2,'0')}/${p[2]||new Date().getFullYear()}`;
}

function somarMeses(dataStr, meses) {
  const p = dataStr.split('/');
  const d = new Date(p[2]||new Date().getFullYear(), parseInt(p[1])-1+meses, parseInt(p[0]));
  return d.toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'});
}

function parsearDataCompleta(str) {
  if (!str) return null;
  const p = str.split('/');
  if (p.length < 2) return null;
  // Retorna objeto com data formatada (sem usar new Date para evitar bug de fuso)
  const dia = p[0].padStart(2,'0');
  const mes = p[1].padStart(2,'0');
  const ano = p[2] ? parseInt(p[2]) : new Date().getFullYear();
  return {
    toISOString: () => `${ano}-${mes}-${dia}T12:00:00.000Z`,
    toLocaleDateString: () => `${dia}/${mes}/${ano}`
  };
}

async function verificarDuplicata(valor, descricao) {
  try {
    const rows  = await getSheetRows();
    const limite = new Date(Date.now()-7*24*60*60*1000);
    for (let i = rows.length-1; i >= 1; i--) {
      const row = rows[i]; if (!row[0]) continue;
      const p   = row[0].toString().split('/');
      if (p.length < 3) continue;
      const dt  = new Date(p[2],p[1]-1,p[0]);
      if (dt < limite) break;
      if (parseFloat(row[2])===valor && (row[1]||'').toLowerCase().includes(descricao.toLowerCase().split(' ')[0]))
        return { linha:i+1, descricao:row[1], valor:row[2], data:row[0] };
    }
    return null;
  } catch(e) { return null; }
}

// ============================================================
//  GOOGLE SHEETS
// ============================================================
async function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: GOOGLE_CREDENTIALS,
    scopes:['https://www.googleapis.com/auth/spreadsheets','https://www.googleapis.com/auth/calendar'],
  });
  return { sheets: google.sheets({version:'v4',auth}), auth };
}

async function appendToSheet(dataGasto, descricao, valor, categoria, quemPagou, tipo, formaPgto, parcelas, observacao, mesAno, registradoEm, conta) {
  const { sheets } = await getSheetsClient();
  const res = await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID, range: 'Página1!A:M',
    valueInputOption:'USER_ENTERED',
    resource: { values: [[dataGasto, descricao, valor, categoria, quemPagou, tipo, formaPgto, parcelas, observacao, mesAno, registradoEm, conta||'', '']] }
  });
  const match = res.data.updates.updatedRange.match(/(\d+)$/);
  return match ? parseInt(match[1]) : '?';
}

async function editarLinha(linha, dataGasto, descricao, valor, categoria, quemPagou, tipo, formaPgto, parcelas, observacao, mesAno, registradoEm, conta) {
  const { sheets } = await getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID, range: `Página1!A${linha}:L${linha}`,
    valueInputOption:'USER_ENTERED',
    resource: { values: [[dataGasto, descricao, valor, categoria, quemPagou, tipo, formaPgto, parcelas, observacao, mesAno, registradoEm, conta||'']] }
  });
}

async function excluirLinha(linha) {
  const { sheets } = await getSheetsClient();
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    resource: { requests:[{ deleteDimension:{ range:{ sheetId:0, dimension:'ROWS', startIndex:linha-1, endIndex:linha } } }] }
  });
}

async function getSheetRows() {
  const { sheets } = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId:SHEET_ID, range:'Página1!A:M' });
  return res.data.values||[];
}

async function salvarCalendarId(linha, eventId) {
  const { sheets } = await getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `Página1!M${linha}`,
    valueInputOption: 'USER_ENTERED',
    resource: { values: [[eventId]] }
  });
}

// ============================================================
//  GOOGLE CALENDAR
// ============================================================
async function criarEventoCalendar(descricao, valor, dataVenc, dataStr) {
  const auth = new google.auth.GoogleAuth({ credentials:GOOGLE_CREDENTIALS, scopes:['https://www.googleapis.com/auth/calendar'] });
  const calendar = google.calendar({version:'v3',auth});
  const res = await calendar.events.insert({
    calendarId: CALENDAR_ID,
    resource: {
      summary: `💸 Vence: ${descricao} - R$ ${valor.toFixed(2)}`,
      description: `Conta a pagar — R$ ${valor.toFixed(2)} — vence em ${dataStr}`,
      start:{ date: dataVenc.toISOString().split('T')[0] },
      end:  { date: dataVenc.toISOString().split('T')[0] },
      reminders:{ useDefault:false, overrides:[
        {method:'popup',minutes:3*24*60},
        {method:'popup',minutes:24*60},
        {method:'popup',minutes:0}
      ]}
    }
  });
  return res.data.id; // retorna o ID do evento
}

async function excluirEventoCalendar(eventId) {
  try {
    const auth = new google.auth.GoogleAuth({ credentials:GOOGLE_CREDENTIALS, scopes:['https://www.googleapis.com/auth/calendar'] });
    const calendar = google.calendar({version:'v3',auth});
    await calendar.events.delete({ calendarId: CALENDAR_ID, eventId });
  } catch(e) { console.error('Erro ao excluir evento Calendar:', e.message); }
}

// ============================================================
//  TELEGRAM
// ============================================================
async function sendMessage(chatId, text) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ chat_id:chatId, text, parse_mode:'Markdown' })
  });
}

async function sendMessageWithButtons(chatId, text, buttons) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ chat_id:chatId, text, parse_mode:'Markdown', reply_markup:{ inline_keyboard:buttons } })
  });
}

const PORT = process.env.PORT||3000;
app.listen(PORT, () => console.log(`Bot rodando na porta ${PORT}`));
