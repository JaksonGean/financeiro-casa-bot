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

const CATEGORIAS_LOJA = [
  'Shopify','Tráfego pago','Apps pagos','Taxas','Curso','Outros loja'
];

const MAPA_DESC_CATEGORIA = {
  'mercado':'Alimentação','supermercado':'Alimentação','feira':'Alimentação',
  'fruteira':'Alimentação','padaria':'Alimentação','açougue':'Alimentação',
  'acougue':'Alimentação','peixaria':'Alimentação','hortifruti':'Alimentação',
  'restaurante':'Alimentação','lanchonete':'Alimentação','pizza':'Alimentação',
  'hamburger':'Alimentação','hamburguer':'Alimentação','sushi':'Alimentação',
  'ifood':'Alimentação','delivery':'Alimentação','cafe':'Alimentação',
  'café':'Alimentação','doceria':'Alimentação','sorveteria':'Alimentação',
  'acai':'Alimentação','açaí':'Alimentação','snack':'Alimentação',
  'conveniencia':'Alimentação','conveniência':'Alimentação',
  'aluguel':'Casa','condominio':'Casa','condomínio':'Casa','iptu':'Casa',
  'luz':'Casa','energia':'Casa','agua':'Casa','água':'Casa','gas':'Casa',
  'gás':'Casa','internet':'Casa','telefone':'Casa','celular':'Casa',
  'reforma':'Casa','pintura':'Casa','encanador':'Casa','eletricista':'Casa',
  'marceneiro':'Casa','limpeza':'Casa','faxina':'Casa','diarista':'Casa',
  'mobilia':'Casa','móbilia':'Casa','movel':'Casa','móvel':'Casa',
  'colchao':'Casa','colchão':'Casa','geladeira':'Casa','fogao':'Casa',
  'fogão':'Casa','microondas':'Casa','maquina':'Casa','máquina':'Casa',
  'gasolina':'Transporte','combustivel':'Transporte','combustível':'Transporte',
  'abastecimento':'Transporte','abastecer':'Transporte',
  'etanol':'Transporte','alcool':'Transporte','álcool':'Transporte',
  'uber':'Transporte','99':'Transporte','taxi':'Transporte','táxi':'Transporte',
  'onibus':'Transporte','ônibus':'Transporte','metro':'Transporte','metrô':'Transporte',
  'pedagio':'Transporte','pedágio':'Transporte','estacionamento':'Transporte',
  'mecanico':'Transporte','mecânico':'Transporte','oficina':'Transporte',
  'pneu':'Transporte','bateria':'Transporte','revisao':'Transporte',
  'revisão':'Transporte','seguro-carro':'Transporte','ipva':'Transporte',
  'carro':'Transporte','moto':'Transporte','autoescola':'Transporte',
  'espelho':'Transporte','parabrisa':'Transporte','lataria':'Transporte',
  'farmacia':'Saúde','farmácia':'Saúde','remedio':'Saúde','remédio':'Saúde',
  'medico':'Saúde','médico':'Saúde','consulta':'Saúde','clinica':'Saúde',
  'clínica':'Saúde','hospital':'Saúde','exame':'Saúde','dentista':'Saúde',
  'ortodontista':'Saúde','psicólogo':'Saúde','psicologo':'Saúde',
  'academia':'Saúde','nutricionista':'Saúde','fisioterapia':'Saúde',
  'plano-saude':'Saúde','unimed':'Saúde','amil':'Saúde','hapvida':'Saúde',
  'drogaria':'Saúde','suplemento':'Saúde','vitamina':'Saúde',
  'escola':'Educação','faculdade':'Educação','universidade':'Educação',
  'curso':'Educação','livro':'Educação','apostila':'Educação',
  'material':'Educação','uniforme':'Educação','mensalidade':'Educação',
  'colegio':'Educação','colégio':'Educação','ingles':'Educação',
  'inglês':'Educação','idioma':'Educação','udemy':'Educação',
  'cinema':'Lazer','teatro':'Lazer','show':'Lazer','festa':'Lazer',
  'bar':'Lazer','balada':'Lazer','parque':'Lazer','viagem':'Lazer',
  'hotel':'Lazer','pousada':'Lazer','airbnb':'Lazer','passeio':'Lazer',
  'ingresso':'Lazer','jogo':'Lazer','game':'Lazer','steam':'Lazer',
  'playstation':'Lazer','xbox':'Lazer','nintendo':'Lazer',
  'roupa':'Vestuário','sapato':'Vestuário','tenis':'Vestuário',
  'tênis':'Vestuário','calcado':'Vestuário','calçado':'Vestuário',
  'camisa':'Vestuário','calca':'Vestuário','calça':'Vestuário',
  'vestido':'Vestuário','bolsa':'Vestuário','mochila':'Vestuário',
  'cinto':'Vestuário','relogio':'Vestuário','relógio':'Vestuário',
  'oculos':'Vestuário','óculos':'Vestuário','bijuteria':'Vestuário',
  'netflix':'Assinaturas','spotify':'Assinaturas','amazon':'Assinaturas',
  'prime':'Assinaturas','disney':'Assinaturas','youtube':'Assinaturas',
  'hbo':'Assinaturas','paramount':'Assinaturas','globoplay':'Assinaturas',
  'icloud':'Assinaturas','google-drive':'Assinaturas','dropbox':'Assinaturas',
  'office':'Assinaturas','adobe':'Assinaturas','antivirus':'Assinaturas',
  'veterinario':'Pet','veterinário':'Pet','petshop':'Pet','pet-shop':'Pet',
  'racao':'Pet','ração':'Pet','vacina-pet':'Pet','banho-pet':'Pet',
  'tosa':'Pet','remedio-pet':'Pet',
  'investimento':'Investimento','acao':'Investimento','ação':'Investimento',
  'fii':'Investimento','tesouro':'Investimento','cdb':'Investimento',
  'poupanca':'Investimento','poupança':'Investimento','aporte':'Investimento',
};

const MESES = {
  'janeiro':1,'fevereiro':2,'março':3,'abril':4,'maio':5,'junho':6,
  'julho':7,'agosto':8,'setembro':9,'outubro':10,'novembro':11,'dezembro':12
};

const CONTAS_PALAVRAS = {
  'c6dany':'C6 Dany','c6 dany':'C6 Dany','dany':'C6 Dany',
  'c6jakson':'C6 Jakson','c6 jakson':'C6 Jakson','jakson':'C6 Jakson',
  'c6j':'C6 Jakson','c6':'C6 J. crédito',
  'neon':'Neon crédito','carteira':'Carteira','dinheiro':'Carteira'
};

const pendentes = {};
let ultimoMesVerificado = null;

function mesAnoAtual() {
  const h = new Date();
  return `${String(h.getMonth()+1).padStart(2,'0')}/${h.getFullYear()}`;
}
function mesAnoAnterior() {
  const h = new Date();
  h.setMonth(h.getMonth()-1);
  return `${String(h.getMonth()+1).padStart(2,'0')}/${h.getFullYear()}`;
}

function detectarConta(tokens, usados, forma, username) {
  for (let i = 0; i < tokens.length; i++) {
    if (usados.has(i)) continue;
    const t = tokens[i].toLowerCase();
    const par = i+1 < tokens.length ? t + ' ' + tokens[i+1].toLowerCase() : null;
    if (par && CONTAS_PALAVRAS[par]) { usados.add(i); usados.add(i+1); return CONTAS_PALAVRAS[par]; }
    if (CONTAS_PALAVRAS[t] && t !== 'dinheiro') { usados.add(i); return CONTAS_PALAVRAS[t]; }
  }
  const f = (forma || '').toLowerCase();
  const u = (username || '').toLowerCase();
  if (f === 'dinheiro') return 'Carteira';
  if (f === 'credito' || f === 'crédito') return 'Neon crédito';
  if (u === 'dany' || u.includes('dany')) return 'C6 Dany';
  return 'C6 Jakson';
}

async function verificarECopiarMetas() {
  const mesAtual = mesAnoAtual();
  if (ultimoMesVerificado === mesAtual) return;
  ultimoMesVerificado = mesAtual;
  try {
    const { sheets } = await getSheetsClient();
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: 'Página2!A:D' });
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
      valueInputOption: 'USER_ENTERED', resource: { values: novas }
    });
    console.log('Metas copiadas para ' + mesAtual);
  } catch(err) { console.error('Erro ao copiar metas:', err); }
}

app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  try { await handleUpdate(req.body); }
  catch(err) { console.error('Erro webhook:', err); }
});
app.get('/', (req, res) => res.send('Bot Financeiro Casa rodando!'));
app.get('/ping', (req, res) => res.json({ status: 'ok', ts: Date.now() }));

async function handleUpdate(update) {
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
  if (tl.startsWith('/gasto') || tl.startsWith('gasto') || tl.startsWith('saida') || tl.startsWith('saída')) { await handleLancamento(chatId, text, username, 'Saída'); return; }
  if (tl.startsWith('/entrada') || tl.startsWith('entrada')) { await handleLancamento(chatId, text, username, 'Entrada'); return; }
  if (tl.startsWith('/apagar') || tl.startsWith('apagar') || tl.startsWith('a pagar')) { await handleApagar(chatId, text, username); return; }
  if (tl.startsWith('/editar') || tl.startsWith('editar')) { await handleEditar(chatId, text, username); return; }
  if (tl.startsWith('/excluir') || tl.startsWith('excluir')) { await handleExcluir(chatId, text); return; }
  if (tl.startsWith('/resumo') || tl.startsWith('resumo') || tl.startsWith('/saldo') || tl.startsWith('saldo')) { await handleResumo(chatId); return; }
  if (tl.startsWith('/ultimos') || tl.startsWith('ultimos')) { await handleUltimos(chatId); return; }
  if (tl.startsWith('/categorias') || tl.startsWith('categorias')) { await handleCategorias(chatId); return; }
  if (tl.startsWith('/metas') || tl.startsWith('metas')) {
    if (tl.includes('loja')) { await handleMetasLoja(chatId); return; }
    await handleMetas(chatId); return;
  }
  if (tl.startsWith('/contas') || tl.startsWith('contas')) { await handleContas(chatId); return; }
  if (tl.startsWith('/transferencia') || tl.startsWith('transferencia') || tl.startsWith('transf')) { await handleTransferencia(chatId, text, username); return; }
  if (tl.startsWith('/pago') || tl.startsWith('pago')) { await handlePago(chatId, text, username); return; }
  if (tl.startsWith('/menu') || tl.startsWith('menu') || tl.startsWith('/ajuda') || tl.startsWith('ajuda') || tl === '/start') { await handleMenu(chatId); return; }
}

async function handlePago(chatId, text, username) {
  const semCmd = text.replace(/^\/?pago\s*/i,'').trim();
  const partes = semCmd.split(/\s+/);
  if (partes.length < 2) {
    await sendMessage(chatId, '✅ *Como dar baixa em conta a pagar:*\n\npago [valor] [descrição]\n\n*Exemplos:*\n• pago 1350 aluguel\n• pago 89,90 netflix\n\n_O bot busca o lançamento A Pagar e dá baixa automaticamente._');
    return;
  }
  const valor = parseFloat(partes[0].replace(',','.'));
  if (isNaN(valor)) { await sendMessage(chatId, '⚠️ Valor inválido.\nEx: pago 1350 aluguel'); return; }
  const descBusca = partes.slice(1).join(' ').toLowerCase();
  try {
    const rows = await getSheetRows();
    let linhaEncontrada = null, rowEncontrada = null;
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row[0]) continue;
      if ((row[5]||'').trim() !== 'A Pagar') continue;
      const valorRow = parseFloat((row[2]||'0').toString().replace(',','.')) || 0;
      const descRow  = (row[1]||'').toLowerCase();
      if (Math.abs(valorRow - valor) < 0.01 && descRow.includes(descBusca.split(' ')[0])) {
        linhaEncontrada = i + 1;
        rowEncontrada = row;
        break;
      }
    }
    if (!linhaEncontrada) {
      await sendMessage(chatId, '⚠️ Não encontrei nenhum lançamento *A Pagar* com:\n💵 Valor: R$ ' + fmt(valor) + '\n📝 Descrição contendo: "' + descBusca + '"\n\nUse *ultimos* para ver os lançamentos pendentes.');
      return;
    }
    const dataHoje     = new Date().toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'});
    const registradoEm = new Date().toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'});
    const dataVencOrig = rowEncontrada[0] || dataHoje;
    const mesAnoOrig   = rowEncontrada[9] || calcularMesAno(dataVencOrig);
    const conta        = rowEncontrada[11] || '';
    const contaFinal   = conta || (username.toLowerCase().includes('dany') ? 'C6 Dany' : 'C6 Jakson');
    const obsOriginal  = rowEncontrada[8] || '';
    const obsFinal     = 'Pago em ' + dataHoje + (obsOriginal ? ' | '+obsOriginal : '');
    await editarLinha(linhaEncontrada, dataVencOrig, rowEncontrada[1]||'', valor, rowEncontrada[3]||'Casa', username, 'Saída', rowEncontrada[6]||'', rowEncontrada[7]||'', obsFinal, mesAnoOrig, registradoEm, contaFinal);
    const eventId = rowEncontrada[12] ? rowEncontrada[12].trim() : null;
    let calMsg = '';
    if (eventId) {
      try { await atualizarEventoCalendar(eventId, rowEncontrada[1], valor, dataHoje, dataVencOrig); calMsg = '\n📅 Calendar atualizado!'; }
      catch(e) { calMsg = '\n⚠️ Não foi possível atualizar o Calendar.'; }
    }
    await sendMessage(chatId, '✅ *Baixa realizada!*\n\n📝 ' + (rowEncontrada[1]||'') + ' — R$ ' + fmt(valor) + '\n📅 Vencimento: ' + dataVencOrig + ' | Pago em: ' + dataHoje + '\n🏦 Conta: ' + contaFinal + '\n📌 Linha #' + linhaEncontrada + calMsg);
  } catch(err) {
    console.error('Erro handlePago:', err);
    await sendMessage(chatId,'❌ Erro ao dar baixa. Tente novamente.');
  }
}

async function handleTransferencia(chatId, text, username) {
  const semCmd = text.replace(/^\/?transf(?:erencia)?\s*/i,'').trim().split(/\s+/);
  if (semCmd.length < 3) {
    await sendMessage(chatId, '↔️ *Como registrar transferência:*\n\ntransferencia [valor] [conta origem] [conta destino]\n\n*Exemplos:*\n• transferencia 100 dany jakson\n• transferencia 50 jakson dany\n\n*Contas disponíveis:* jakson, dany, neon, carteira');
    return;
  }
  const valor = parseFloat(semCmd[0].replace(',','.'));
  if (isNaN(valor)) { await sendMessage(chatId,'⚠️ Valor inválido.'); return; }
  const MAPA_CONTAS = { 'jakson':'C6 Jakson','c6jakson':'C6 Jakson','c6j':'C6 Jakson','dany':'C6 Dany','c6dany':'C6 Dany','neon':'Neon crédito','carteira':'Carteira' };
  const origem  = MAPA_CONTAS[semCmd[1].toLowerCase()];
  const destino = MAPA_CONTAS[semCmd[2].toLowerCase()];
  if (!origem)  { await sendMessage(chatId, '⚠️ Conta origem não reconhecida: *' + semCmd[1] + '*\nUse: jakson, dany, neon ou carteira'); return; }
  if (!destino) { await sendMessage(chatId, '⚠️ Conta destino não reconhecida: *' + semCmd[2] + '*\nUse: jakson, dany, neon ou carteira'); return; }
  if (origem === destino) { await sendMessage(chatId, '⚠️ Origem e destino são a mesma conta!'); return; }
  const dataHoje     = new Date().toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'});
  const registradoEm = new Date().toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'});
  const mesAno       = calcularMesAno(dataHoje);
  const desc         = 'Transferência ' + semCmd[1] + ' → ' + semCmd[2];
  const linSaida   = await appendToSheet(dataHoje, desc, valor, 'Transferência', username, 'Saída',  '', '', '', mesAno, registradoEm, origem);
  const linEntrada = await appendToSheet(dataHoje, desc, valor, 'Transferência', username, 'Entrada','', '', '', mesAno, registradoEm, destino);
  await sendMessage(chatId, '↔️ *Transferência registrada!*\n\n💸 Saída: R$ ' + fmt(valor) + ' de *' + origem + '* (linha #' + linSaida + ')\n💰 Entrada: R$ ' + fmt(valor) + ' em *' + destino + '* (linha #' + linEntrada + ')\n📅 ' + dataHoje + ' | 👤 ' + username);
}

async function handleCallback(query) {
  const chatId = query.message.chat.id;
  const data   = query.data;
  await fetch('https://api.telegram.org/bot' + TELEGRAM_TOKEN + '/answerCallbackQuery', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ callback_query_id: query.id })
  });
  switch(data) {
    case 'como_gasto':
      await sendMessage(chatId, '💸 *Como lançar uma saída:*\n\n*Formato:* gasto [valor] [descrição] [categoria] [forma] [parcelas] [data] [-- obs]\n\n*Exemplos:*\n• gasto 45,90 mercado\n• gasto 45,90 mercado pix\n• gasto 1200 geladeira Casa credito 3x\n• gasto 80 roupa credito c6\n• gasto 50 padaria pix dany\n\n_Apenas valor e descrição são obrigatórios!_'); break;
    case 'como_entrada':
      await sendMessage(chatId, '💰 *Como lançar uma entrada:*\n\n*Formato:* entrada [valor] [descrição] [categoria] [forma] [data]\n\n*Exemplos:*\n• entrada 5000 salario\n• entrada 5000 salario pix 05/06\n\n_Apenas valor e descrição são obrigatórios!_'); break;
    case 'como_apagar':
      await sendMessage(chatId, '📋 *Como lançar conta a pagar:*\n\n*Formato:* a pagar [valor] [descrição] [dd/mm]\n\n*Exemplos:*\n• a pagar 150,00 conta-luz 15/06\n• a pagar 1356,32 cartão neon 22/06'); break;
    case 'como_editar':
      await sendMessage(chatId, '✏️ *Como editar:*\n\neditar [linha] [valor] [descrição] [categoria]\n\n• editar 5 65,00 mercado Alimentação'); break;
    case 'como_excluir':
      await sendMessage(chatId, '🗑️ *Como excluir:*\n\nexcluir [linha]\n\n• excluir 5'); break;
    case 'ver_categorias':  await handleCategorias(chatId); break;
    case 'ver_formas':
      await sendMessage(chatId, '💳 *Formas de pagamento:*\n\n• pix\n• debito\n• credito\n• dinheiro\n• ted\n• doc\n\n*Contas (opcional):*\n• _credito c6_ → C6 J. crédito\n• _pix dany_ → C6 Dany\n• _neon_ → Neon crédito'); break;
    case 'ver_resumo':  await handleResumo(chatId);  break;
    case 'ver_ultimos': await handleUltimos(chatId); break;
    case 'ver_metas':   await handleMetas(chatId);   break;
    case 'ver_contas':  await handleContas(chatId);  break;
  }
}

async function handleMenu(chatId) {
  await sendMessageWithButtons(chatId, '👋 *Financeiro Casa - Menu*\n\nO que você quer fazer?', [
    [{ text:'💸 Como lançar gasto', callback_data:'como_gasto' }, { text:'💰 Como lançar entrada', callback_data:'como_entrada' }],
    [{ text:'📋 Conta a pagar', callback_data:'como_apagar' }],
    [{ text:'✏️ Como editar', callback_data:'como_editar' }, { text:'🗑️ Como excluir', callback_data:'como_excluir' }],
    [{ text:'📊 Resumo do mês', callback_data:'ver_resumo' }, { text:'📋 Últimos lançamentos', callback_data:'ver_ultimos' }],
    [{ text:'🎯 Metas', callback_data:'ver_metas' }, { text:'🏦 Contas e cartões', callback_data:'ver_contas' }],
    [{ text:'🏷️ Categorias', callback_data:'ver_categorias' }, { text:'💳 Formas de pagamento', callback_data:'ver_formas' }],
  ]);
}

function parsearLancamento(text, tipo, username) {
  let raw = text.replace(/^\/?(?:gasto|entrada|saida|saída)\s*/i,'').trim();
  let observacao = '';
  if (raw.includes('--')) { const p = raw.split('--'); raw = p[0].trim(); observacao = p[1].trim(); }
  const tokens = raw.split(/\s+/);
  let valor = null, categoria = null, formaPgto = '', parcelas = '1', dataGasto = null;
  const usados = new Set();
  for (let i = 0; i < tokens.length; i++) {
    const n = parseFloat(tokens[i].replace(',','.'));
    if (!isNaN(n) && tokens[i].match(/[\d,\.]+/)) { valor = n; usados.add(i); break; }
  }
  for (let i = 0; i < tokens.length; i++) {
    if (usados.has(i)) continue;
    if (/^\d+x$/i.test(tokens[i])) { parcelas = tokens[i].replace(/x/i,''); usados.add(i); }
  }
  for (let i = 0; i < tokens.length; i++) {
    if (usados.has(i)) continue;
    const t = tokens[i].toLowerCase();
    if (FORMAS_PAGAMENTO.includes(t)) { formaPgto = capitalizar(tokens[i]); usados.add(i); break; }
  }
  for (let i = 0; i < tokens.length; i++) {
    if (usados.has(i)) continue;
    const d = parsearData(tokens[i], tokens[i+1]);
    if (d) { dataGasto = d.data; usados.add(i); if (d.consumiu2) usados.add(i+1); }
  }
  const lista = tipo === 'Entrada' ? CATEGORIAS_ENTRADA : CATEGORIAS_SAIDA;
  for (let i = 0; i < tokens.length; i++) {
    if (usados.has(i)) continue;
    const t = tokens[i].toLowerCase();
    const cat = lista.find(c => c.toLowerCase().startsWith(t) || t.startsWith(c.toLowerCase().split(' ')[0]));
    if (cat) { categoria = cat; usados.add(i); break; }
  }
  const conta = detectarConta(tokens, usados, formaPgto, username);
  const descricao = capitalizar(tokens.filter((_,i) => !usados.has(i)).join(' ') || 'Sem descrição');
  if (!dataGasto) dataGasto = new Date().toLocaleDateString('pt-BR', { timeZone:'America/Sao_Paulo' });
  if (!categoria) {
    const descLower = descricao.toLowerCase();
    const catInferida = MAPA_DESC_CATEGORIA[descLower] || Object.entries(MAPA_DESC_CATEGORIA).find(([k]) => descLower.includes(k))?.[1];
    categoria = catInferida || (tipo === 'Saída' ? 'Outros' : 'Outras entradas');
  }
  if (!formaPgto && tipo === 'Saída') formaPgto = 'Pix';
  return { valor, descricao, categoria, formaPgto, parcelas, dataGasto, observacao, conta };
}

function parsearData(token, tokenNext) {
  if (!token) return null;
  const t = token.toLowerCase();
  if (t === 'ontem') { const d = new Date(); d.setDate(d.getDate()-1); return { data: d.toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'}), consumiu2:false }; }
  if (t === 'hoje') return { data: new Date().toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'}), consumiu2:false };
  const m1 = token.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (m1) {
    const dia = m1[1].padStart(2,'0'), mes = m1[2].padStart(2,'0');
    const ano = m1[3] ? (m1[3].length===2?'20'+m1[3]:m1[3]) : new Date().getFullYear();
    return { data: dia+'/'+mes+'/'+ano, consumiu2:false };
  }
  if (/^(\d{1,2})$/.test(token) && tokenNext) {
    const tn = tokenNext.toLowerCase().replace(/^de\s+|^do\s+/,'');
    const mesNum = MESES[tn] || parseInt(tn);
    if (mesNum >= 1 && mesNum <= 12) return { data: token.padStart(2,'0')+'/'+String(mesNum).padStart(2,'0')+'/'+new Date().getFullYear(), consumiu2:true };
  }
  return null;
}

async function getMetas(mesAno) {
  try {
    const { sheets } = await getSheetsClient();
    const res = await sheets.spreadsheets.values.get({ spreadsheetId:SHEET_ID, range:'Página2!A:D' });
    const rows = res.data.values || [];
    const mes = mesAno || mesAnoAtual();
    const metas = {};
    for (const row of rows.slice(1)) {
      const cat = (row[0]||'').trim(), val = parseFloat((row[1]||'0').toString().replace(',','.')) || 0;
      const tipo = (row[2]||'Gasto').trim(), rm = (row[3]||'').trim();
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
  if (tipo === 'Investimento') return gasto >= meta ? '🎯 *'+categoria+':* Meta atingida! R$ '+fmt(gasto)+' de R$ '+fmt(meta) : '🎯 *'+categoria+':* R$ '+fmt(gasto)+' investido — faltam R$ '+fmt(Math.abs(restante));
  if (restante < 0) return '⚠️ *Meta de '+categoria+' ultrapassada!* R$ '+fmt(gasto)+' de R$ '+fmt(meta)+' ('+pct+'%)';
  return '🎯 *'+categoria+':* R$ '+fmt(gasto)+' de R$ '+fmt(meta)+' — saldo R$ '+fmt(restante);
}

async function handleMetas(chatId) {
  const mes   = mesAnoAtual();
  const metas = await getMetas(mes);
  if (Object.keys(metas).length === 0) { await sendMessage(chatId, '📋 Nenhuma meta cadastrada na aba *Página2* da planilha.'); return; }
  const rows = await getSheetRows();
  const gastos = {};
  for (const row of rows.slice(1)) {
    if (!row[0] || row[9] !== mes) continue;
    const cat = (row[3]||'').trim();
    if (row[5] !== 'Entrada') gastos[cat] = (gastos[cat]||0) + (parseFloat(row[2])||0);
  }
  const nomeMes = new Date().toLocaleDateString('pt-BR',{month:'long',year:'numeric',timeZone:'America/Sao_Paulo'});
  let msg = '🎯 *Metas — ' + nomeMes + '*\n\n';
  for (const [cat, { meta, tipo }] of Object.entries(metas)) {
    const gasto = gastos[cat]||0, restante = meta - gasto;
    const pct   = Math.min(100,(gasto/meta*100)).toFixed(0);
    const barra = '█'.repeat(Math.round(Math.min(1,gasto/meta)*8)) + '░'.repeat(8-Math.round(Math.min(1,gasto/meta)*8));
    if (tipo === 'Investimento') {
      msg += (gasto>=meta?'✅':'📈') + ' *' + cat + '* (Investimento)\n' + barra + ' ' + pct + '%\n';
      msg += 'R$ ' + fmt(gasto) + ' de R$ ' + fmt(meta) + (gasto>=meta?' ✓ Meta atingida!':'  — faltam R$ '+fmt(restante)) + '\n\n';
    } else {
      const emoji = restante<0?'🔴':restante<meta*0.2?'🟡':'🟢';
      msg += emoji + ' *' + cat + '*\n' + barra + ' ' + pct + '%\n';
      msg += 'R$ ' + fmt(gasto) + ' de R$ ' + fmt(meta) + (restante<0?' ⚠️ Passou R$ '+fmt(Math.abs(restante)):' — saldo R$ '+fmt(restante)) + '\n\n';
    }
  }
  msg += '_Edite as metas na aba Página2 da planilha_';
  await sendMessage(chatId, msg);
}

async function getContas() {
  try {
    const { sheets } = await getSheetsClient();
    const res = await sheets.spreadsheets.values.get({ spreadsheetId:SHEET_ID, range:'Página3!A:D' });
    const rows = res.data.values || [];
    return rows.slice(1).filter(r => r[0]).map(r => ({
      nome: (r[0]||'').trim(), tipo: (r[1]||'').trim(),
      limite: parseFloat((r[2]||'0').toString().replace(/[R$\s\.]/g,'').replace(',','.')) || 0,
      saldoInicial: parseFloat((r[3]||'0').toString().replace(/[R$\s\.]/g,'').replace(',','.')) || 0,
    }));
  } catch(e) { return []; }
}

async function handleContas(chatId) {
  const contas = await getContas();
  if (contas.length === 0) { await sendMessage(chatId, '📋 Nenhuma conta cadastrada na aba *Página3* da planilha.'); return; }
  const rows = await getSheetRows();
  const mes  = mesAnoAtual();
  const movMes = {};
  for (const row of rows.slice(1)) {
    if (!row[0]) continue;
    const conta = (row[11]||'').trim();
    if (!conta) continue;
    const valor = parseFloat(row[2])||0;
    if (!movMes[conta]) movMes[conta] = { entradas:0, saidas:0, faturaAtual:0 };
    if (row[5]==='Entrada') movMes[conta].entradas += valor;
    else if (row[5]==='Saída') { movMes[conta].saidas += valor; if (row[9]===mes) movMes[conta].faturaAtual += valor; }
  }
  const nomeMes = new Date().toLocaleDateString('pt-BR',{month:'long',year:'numeric',timeZone:'America/Sao_Paulo'});
  let msg = '🏦 *Contas e Cartões — ' + nomeMes + '*\n\n';
  for (const c of contas) {
    const mov = movMes[c.nome] || { entradas:0, saidas:0, faturaAtual:0 };
    if (c.tipo === 'Cartão crédito') {
      const usado = mov.faturaAtual, disponivel = c.limite - usado;
      const barra = '█'.repeat(Math.round(Math.min(1,usado/c.limite)*8))+'░'.repeat(8-Math.round(Math.min(1,usado/c.limite)*8));
      msg += '💳 *' + c.nome + '*\nFatura: R$ ' + fmt(usado) + ' de R$ ' + fmt(c.limite) + '\nDisponível: R$ ' + fmt(disponivel) + '\n' + barra + ' ' + Math.min(100,(usado/c.limite*100)).toFixed(0) + '%\n\n';
    } else {
      const saldo = c.saldoInicial + mov.entradas - mov.saidas;
      msg += (saldo >= 0 ? '🟢' : '🔴') + ' *' + c.nome + '* (' + c.tipo + ')\nSaldo: R$ ' + fmt(saldo) + '\n\n';
    }
  }
  msg += '_Atualize saldos iniciais na aba Página3 da planilha_';
  await sendMessage(chatId, msg);
}

async function handleLancamento(chatId, text, username, tipo) {
  // Redireciona para aba Loja se contiver a palavra "loja"
  if (isLancamentoLoja(text)) { await handleLancamentoLoja(chatId, text, username, tipo); return; }
  const p = parsearLancamento(text, tipo, username);
  if (!p.valor || isNaN(p.valor)) {
    const cmd = tipo==='Saída'?'gasto':'entrada';
    await sendMessage(chatId, '⚠️ Não encontrei o valor.\nUse: ' + cmd + ' 45,90 descrição'); return;
  }
  const registradoEm = new Date().toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'});
  const mesAno = calcularMesAno(p.dataGasto);
  const dadosBase = { ...p, username, tipo, registradoEm, mesAno };
  const duplicata = await verificarDuplicata(p.valor, p.descricao);
  if (duplicata) {
    pendentes[chatId] = { dados: dadosBase };
    await sendMessage(chatId, '⚠️ *Lançamento similar encontrado!*\n📌 Linha #' + duplicata.linha + ' | ' + duplicata.descricao + ' | R$ ' + parseFloat(duplicata.valor).toFixed(2) + ' | ' + duplicata.data + '\n\nConfirma o novo lançamento?\n\n✅ *sim*  ou  ❌ *não*'); return;
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
      const desc     = d.descricao + ' (' + (i+1) + '/' + numParcelas + ')';
      const linha    = await appendToSheet(dataParc, desc, d.valor/numParcelas, d.categoria, d.username, d.tipo, d.formaPgto, (i+1)+'/'+numParcelas, d.observacao, mesAno, d.registradoEm, d.conta);
      linhas.push(linha);
    }
    const emoji = d.tipo==='Saída'?'💸':'💰';
    await sendMessage(chatId, emoji + ' *' + numParcelas + 'x registradas!*\n📝 ' + d.descricao + '\n💵 Total: R$ ' + fmt(d.valor) + ' | Parcela: R$ ' + fmt(d.valor/numParcelas) + '\n🏷️ ' + d.categoria + ' | 💳 ' + (d.formaPgto||'Não informada') + ' | 🏦 ' + d.conta + '\n📌 Linhas: #' + linhas.join(', #'));
  } else {
    const linha = await appendToSheet(d.dataGasto, d.descricao, d.valor, d.categoria, d.username, d.tipo, d.formaPgto, '', d.observacao, d.mesAno, d.registradoEm, d.conta);
    const emoji = d.tipo==='Saída'?'💸':'💰';
    let msg = emoji + ' *Lançado!* ' + d.descricao + ' — R$ ' + fmt(d.valor) + '\n📅 ' + d.dataGasto + ' | 🏷️ ' + d.categoria + '\n💳 ' + (d.formaPgto||'Não informada') + ' | 🏦 ' + d.conta + '\n' + (d.observacao ? '📌 ' + d.observacao + '\n' : '') + '👤 ' + d.username + ' | 📌 Linha #' + linha + '\n';
    if (d.tipo==='Saída') {
      const baixa = await verificarEQuitarAPagar(d.valor, d.descricao);
      if (baixa.encontrado) msg += '\n✅ *Baixa automática!* Conta a pagar "' + baixa.descricao + '" (venc. ' + baixa.vencimento + ') marcada como quitada.';
      const msgMeta = await getMensagemMeta(d.categoria, d.mesAno);
      if (msgMeta) msg += '\n' + msgMeta;
    }
    msg += '\n\n_editar ' + linha + ' valor descrição_\n_excluir ' + linha + '_';
    await sendMessage(chatId, msg);
  }
}

async function handleApagar(chatId, text, username) {
  const semCmd = text.replace(/^\/?a?\s?pagar\s*/i,'').trim();
  const tokens = semCmd.split(/\s+/);
  if (tokens.length < 2) {
    await sendMessage(chatId, '⚠️ Use: a pagar [valor] [descrição] [dd/mm]\nEx: a pagar 1356,32 cartão neon 22/06\n_Valor e data podem vir em qualquer posição!_');
    return;
  }
  let valor = null, vencStr = null;
  const usados = new Set();
  for (let i = 0; i < tokens.length; i++) {
    const n = parseFloat(tokens[i].replace(',','.'));
    if (!isNaN(n) && tokens[i].match(/[\d,\.]+/)) { valor = n; usados.add(i); break; }
  }
  for (let i = 0; i < tokens.length; i++) {
    if (usados.has(i)) continue;
    if (/^\d{1,2}\/\d{1,2}(\/\d{2,4})?$/.test(tokens[i])) { vencStr = tokens[i]; usados.add(i); break; }
  }
  const desc = capitalizar(tokens.filter((_,i) => !usados.has(i)).join(' ') || 'Sem descrição');
  if (!valor || isNaN(valor)) { await sendMessage(chatId,'⚠️ Valor não encontrado.\nEx: a pagar 1356,32 cartão neon 22/06'); return; }
  if (!vencStr) { await sendMessage(chatId,'⚠️ Data não encontrada. Use dd/mm.\nEx: a pagar 1356,32 cartão neon 22/06'); return; }
  const dataVenc = parsearDataCompleta(vencStr);
  if (!dataVenc) { await sendMessage(chatId,'⚠️ Data inválida. Use dd/mm. Ex: 15/06'); return; }
  const dataHoje     = new Date().toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'});
  const registradoEm = new Date().toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'});
  const dataVencFormatada = dataVenc.dataFormatada;
  const mesAno       = calcularMesAno(dataVencFormatada);
  const linha = await appendToSheet(dataVencFormatada, desc, valor, 'Casa', username, 'A Pagar', '', '', 'Lancado em '+dataHoje, mesAno, registradoEm, '');
  let calMsg = '';
  try {
    const calEventId = await criarEventoCalendar(desc, valor, dataVenc, vencStr);
    calMsg = '📅 Lembrete criado no Calendar!';
    if (calEventId) await salvarCalendarId(linha, calEventId);
  } catch(e) { calMsg = '⚠️ Erro ao criar lembrete no Calendar.'; }
  await sendMessage(chatId, '📋 *Conta a pagar registrada!*\n📝 ' + desc + ' | R$ ' + fmt(valor) + '\n⏰ Vencimento: ' + vencStr + '\n👤 ' + username + ' | 📌 Linha #' + linha + '\n' + calMsg);
}

async function handleEditar(chatId, text, username) {
  const partes = text.replace(/^\/?editar\s*/i,'').trim().split(' ');
  if (partes.length < 2) { await sendMessage(chatId,'⚠️ Use: editar linha valor descrição categoria'); return; }
  const linhaNum = parseInt(partes[0]);
  if (isNaN(linhaNum)) { await sendMessage(chatId,'⚠️ Número de linha inválido.'); return; }
  const valorT = parseFloat((partes[1]||'').replace(',','.'));
  if (isNaN(valorT)) { await sendMessage(chatId,'⚠️ Valor inválido.\nEx: editar ' + linhaNum + ' 65,00 mercado Alimentação'); return; }
  const descricao   = capitalizar(partes[2]||'Sem descrição');
  const catDigitada = partes.slice(3).join(' ')||'';
  const dataHoje    = new Date().toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'});
  const regEm       = new Date().toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'});
  let tipoExistente = 'Saída', contaExistente = '';
  try { const rows = await getSheetRows(); const row = rows[linhaNum-1]; if (row) { tipoExistente = row[5]||'Saída'; contaExistente = row[11]||''; } } catch(e) {}
  const categoria = encontrarCategoria(catDigitada, tipoExistente) || (tipoExistente==='Entrada'?'Outras entradas':'Outros');
  const mesAno    = calcularMesAno(dataHoje);
  await editarLinha(linhaNum, dataHoje, descricao, valorT, categoria, username, tipoExistente, '', '', '', mesAno, regEm, contaExistente);
  await sendMessage(chatId, '✏️ *Linha #' + linhaNum + ' editada!*\n📝 ' + descricao + ' | R$ ' + fmt(valorT) + ' | ' + categoria + ' | 🏦 ' + (contaExistente||'—'));
}

async function handleExcluir(chatId, text) {
  const semCmd = text.replace(/^\/?excluir\s*/i,'').trim();
  // Excluir da aba Loja
  if (semCmd.toLowerCase().startsWith('loja')) {
    const linhaNum = parseInt(semCmd.replace(/^loja\s*/i,'').trim());
    if (isNaN(linhaNum)) { await sendMessage(chatId,'⚠️ Use: excluir loja 5'); return; }
    const { sheets } = await getSheetsClient();
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: SHEET_ID, resource: { requests:[{ deleteDimension:{ range:{ sheetId: null, dimension:'ROWS', startIndex:linhaNum-1, endIndex:linhaNum } } }] } });
    await sendMessage(chatId, 'Linha #' + linhaNum + ' excluída da Loja!');
    return;
  }
  const linhaNum = parseInt(semCmd);
  if (isNaN(linhaNum)) { await sendMessage(chatId,'⚠️ Use: excluir 5'); return; }
  let calMsg = '';
  try {
    const rows = await getSheetRows();
    const row  = rows[linhaNum - 1];
    const eventId = row && row[12] ? row[12].trim() : null;
    if (eventId) { await excluirEventoCalendar(eventId); calMsg = ' e lembrete do Calendar removido'; }
  } catch(e) {}
  await excluirLinha(linhaNum);
  await sendMessage(chatId, '🗑️ Linha #' + linhaNum + ' excluída' + calMsg + '!');
}

async function handleUltimos(chatId) {
  try {
    const rows = await getSheetRows();
    const dados = rows.slice(1).map((row,i) => ({linha:i+2,row})).filter(({row})=>row[0]).slice(-10).reverse();
    if (!dados.length) { await sendMessage(chatId,'Nenhum lançamento encontrado.'); return; }
    let msg = '📋 *Últimos lançamentos:*\n\n';
    dados.forEach(({linha,row}) => {
      const emoji = row[5]==='Entrada'?'💰':row[5]==='A Pagar'?'📋':'💸';
      const conta = row[11] ? ' | ' + row[11] : '';
      msg += emoji + ' *#' + linha + '* | ' + row[0] + ' | ' + row[1] + ' | R$ ' + parseFloat(row[2]).toFixed(2) + conta + '\n';
    });
    msg += '\n_editar linha valor descrição_\n_excluir linha_';
    await sendMessage(chatId, msg);
  } catch(e) { await sendMessage(chatId,'❌ Erro ao buscar lançamentos.'); }
}

async function handleResumo(chatId) {
  try {
    const rows = await getSheetRows();
    const mes  = mesAnoAtual();
    let totEnt = 0, totSai = 0, totPag = 0;
    const porCat = {}, porConta = {};
    for (const row of rows.slice(1)) {
      if (!row[0] || row[9] !== mes) continue;
      const valor = parseFloat(row[2])||0, tipo = row[5]||'Saída', cat = row[3]||'Outros', conta = row[11]||'—';
      if (tipo==='Entrada') { totEnt+=valor; }
      else if (tipo==='A Pagar') { totPag+=valor; }
      else { totSai+=valor; porCat[cat]=(porCat[cat]||0)+valor; porConta[conta]=(porConta[conta]||0)+valor; }
    }
    const nomeMes = new Date().toLocaleDateString('pt-BR',{month:'long',year:'numeric',timeZone:'America/Sao_Paulo'});
    let msg = '📊 *Resumo de ' + nomeMes + '*\n\n💰 Entradas: R$ ' + fmt(totEnt) + '\n💸 Saídas: R$ ' + fmt(totSai) + '\n';
    if (totPag>0) msg += '📋 A Pagar: R$ ' + fmt(totPag) + '\n';
    msg += '📈 *Saldo: R$ ' + fmt(totEnt-totSai) + '*\n';
    if (Object.keys(porCat).length) { msg += '\n*Por categoria:*\n'; Object.entries(porCat).sort((a,b)=>b[1]-a[1]).forEach(([c,v]) => msg += '🏷️ ' + c + ': R$ ' + fmt(v) + '\n'); }
    if (Object.keys(porConta).length) { msg += '\n*Por conta:*\n'; Object.entries(porConta).sort((a,b)=>b[1]-a[1]).forEach(([c,v]) => msg += '🏦 ' + c + ': R$ ' + fmt(v) + '\n'); }
    await sendMessage(chatId, msg);
  } catch(e) { await sendMessage(chatId,'❌ Erro ao buscar resumo.'); }
}

async function handleCategorias(chatId) {
  await sendMessage(chatId, '🏷️ *Categorias disponíveis*\n\n*💸 Saídas:*\n' + CATEGORIAS_SAIDA.map(c=>'• '+c).join('\n') + '\n\n*💰 Entradas:*\n' + CATEGORIAS_ENTRADA.map(c=>'• '+c).join('\n'));
}

// ============================================================
//  LOJA — detectar se lançamento é da loja
// ============================================================
function isLancamentoLoja(text) {
  return /loja/i.test(text);
}

function parsearLancamentoLoja(text, tipo, username) {
  // Remove a palavra "loja" e o comando do texto
  const raw = text.replace(/^\/?(?:gasto|entrada|saida|saída)\s*/i,'').replace(/loja/gi,'').trim();
  const tokens = raw.split(/\s+/).filter(t => t.length > 0);
  let valor = null, categoria = null, formaPgto = '', dataGasto = null;
  const usados = new Set();

  // Valor
  for (let i = 0; i < tokens.length; i++) {
    const n = parseFloat(tokens[i].replace(',','.'));
    if (!isNaN(n) && tokens[i].match(/[\d,\.]+/)) { valor = n; usados.add(i); break; }
  }
  // Forma de pagamento
  for (let i = 0; i < tokens.length; i++) {
    if (usados.has(i)) continue;
    if (FORMAS_PAGAMENTO.includes(tokens[i].toLowerCase())) { formaPgto = capitalizar(tokens[i]); usados.add(i); break; }
  }
  // Data
  for (let i = 0; i < tokens.length; i++) {
    if (usados.has(i)) continue;
    const d = parsearData(tokens[i], tokens[i+1]);
    if (d) { dataGasto = d.data; usados.add(i); if (d.consumiu2) usados.add(i+1); }
  }
  // Categoria da loja
  for (let i = 0; i < tokens.length; i++) {
    if (usados.has(i)) continue;
    const t = tokens[i].toLowerCase();
    const cat = CATEGORIAS_LOJA.find(c => c.toLowerCase().startsWith(t) || t.startsWith(c.toLowerCase().split(' ')[0]));
    if (cat) { categoria = cat; usados.add(i); break; }
  }
  const conta = detectarConta(tokens, usados, formaPgto, username);
  const descricao = capitalizar(tokens.filter((_,i) => !usados.has(i)).join(' ') || 'Sem descrição');
  if (!dataGasto) dataGasto = new Date().toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'});
  if (!categoria) categoria = tipo === 'Saída' ? 'Outros loja' : 'Outras entradas';
  if (!formaPgto && tipo === 'Saída') formaPgto = 'Pix';
  return { valor, descricao, categoria, formaPgto, dataGasto, conta };
}

async function handleLancamentoLoja(chatId, text, username, tipo) {
  const p = parsearLancamentoLoja(text, tipo, username);
  if (!p.valor || isNaN(p.valor)) {
    await sendMessage(chatId, '⚠️ Não encontrei o valor.\nEx: gasto 150 embalagens loja');
    return;
  }
  const registradoEm = new Date().toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'});
  const mesAno = calcularMesAno(p.dataGasto);
  const linha = await appendToSheetLoja(p.dataGasto, p.descricao, p.valor, p.categoria, username, tipo, p.formaPgto, '', '', mesAno, registradoEm, p.conta);
  const emoji = tipo === 'Saída' ? '💸' : '💰';
  let msg = emoji + ' *[LOJA] Lançado!* ' + p.descricao + ' — R$ ' + fmt(p.valor) + '\n📅 ' + p.dataGasto + ' | 🏷️ ' + p.categoria + '\n💳 ' + (p.formaPgto||'Não informada') + ' | 🏦 ' + p.conta + '\n👤 ' + username + ' | 📌 Linha #' + linha;
  const msgMeta = await getMensagemMetaLoja(p.categoria, mesAno);
  if (msgMeta) msg += '\n' + msgMeta;
  msg += '\n\n_excluir loja ' + linha + '_';
  await sendMessage(chatId, msg);
}

async function handleResumoLoja(chatId) {
  try {
    const rows = await getSheetRowsLoja();
    const mes  = mesAnoAtual();
    let totEnt = 0, totSai = 0;
    const porCat = {};
    for (const row of rows.slice(1)) {
      if (!row[0] || row[9] !== mes) continue;
      const valor = parseFloat(row[2])||0, tipo = row[5]||'Saída', cat = row[3]||'Outros loja';
      if (tipo === 'Entrada') totEnt += valor;
      else { totSai += valor; porCat[cat] = (porCat[cat]||0) + valor; }
    }
    const nomeMes = new Date().toLocaleDateString('pt-BR',{month:'long',year:'numeric',timeZone:'America/Sao_Paulo'});
    let msg = '🏪 *Resumo Loja — ' + nomeMes + '*\n\n💰 Entradas: R$ ' + fmt(totEnt) + '\n💸 Saídas: R$ ' + fmt(totSai) + '\n📈 *Saldo: R$ ' + fmt(totEnt-totSai) + '*\n';
    if (Object.keys(porCat).length) {
      msg += '\n*Por categoria:*\n';
      Object.entries(porCat).sort((a,b)=>b[1]-a[1]).forEach(([c,v]) => msg += '🏷️ ' + c + ': R$ ' + fmt(v) + '\n');
    }
    await sendMessage(chatId, msg);
  } catch(e) { await sendMessage(chatId,'❌ Erro ao buscar resumo da loja.'); }
}

async function handleMetasLoja(chatId) {
  try {
    const mes   = mesAnoAtual();
    const metas = await getMetasLoja(mes);
    if (Object.keys(metas).length === 0) { await sendMessage(chatId, '📋 Nenhuma meta cadastrada na aba *MetasLoja* da planilha.'); return; }
    const rows = await getSheetRowsLoja();
    const gastos = {};
    for (const row of rows.slice(1)) {
      if (!row[0] || row[9] !== mes) continue;
      const cat = (row[3]||'').trim();
      if (row[5] !== 'Entrada') gastos[cat] = (gastos[cat]||0) + (parseFloat(row[2])||0);
    }
    const nomeMes = new Date().toLocaleDateString('pt-BR',{month:'long',year:'numeric',timeZone:'America/Sao_Paulo'});
    let msg = '🎯 *Metas Loja — ' + nomeMes + '*\n\n';
    for (const [cat, { meta }] of Object.entries(metas)) {
      const gasto = gastos[cat]||0, restante = meta - gasto;
      const pct   = Math.min(100,(gasto/meta*100)).toFixed(0);
      const barra = '█'.repeat(Math.round(Math.min(1,gasto/meta)*8)) + '░'.repeat(8-Math.round(Math.min(1,gasto/meta)*8));
      const emoji = restante<0?'🔴':restante<meta*0.2?'🟡':'🟢';
      msg += emoji + ' *' + cat + '*\n' + barra + ' ' + pct + '%\n';
      msg += 'R$ ' + fmt(gasto) + ' de R$ ' + fmt(meta) + (restante<0?' ⚠️ Passou R$ '+fmt(Math.abs(restante)):' — saldo R$ '+fmt(restante)) + '\n\n';
    }
    msg += '_Edite as metas na aba MetasLoja da planilha_';
    await sendMessage(chatId, msg);
  } catch(e) { await sendMessage(chatId,'❌ Erro ao buscar metas da loja.'); }
}

async function getMensagemMetaLoja(categoria, mesAno) {
  const metas = await getMetasLoja(mesAno);
  if (!metas[categoria]) return null;
  const { meta } = metas[categoria];
  const rows = await getSheetRowsLoja();
  const mes = mesAno || mesAnoAtual();
  let gasto = 0;
  for (const row of rows.slice(1)) {
    if (!row[0] || row[9] !== mes) continue;
    if ((row[3]||'').trim() === categoria && row[5] !== 'Entrada') gasto += parseFloat(row[2])||0;
  }
  const restante = meta - gasto;
  if (restante < 0) return '⚠️ *Meta de ' + categoria + ' ultrapassada!* R$ ' + fmt(gasto) + ' de R$ ' + fmt(meta);
  return '🎯 *' + categoria + ':* R$ ' + fmt(gasto) + ' de R$ ' + fmt(meta) + ' — saldo R$ ' + fmt(restante);
}

async function getMetasLoja(mesAno) {
  try {
    const { sheets } = await getSheetsClient();
    const res = await sheets.spreadsheets.values.get({ spreadsheetId:SHEET_ID, range:'MetasLoja!A:D' });
    const rows = res.data.values || [];
    const mes = mesAno || mesAnoAtual();
    const metas = {};
    for (const row of rows.slice(1)) {
      const cat = (row[0]||'').trim(), val = parseFloat((row[1]||'0').toString().replace(',','.')) || 0;
      const rm  = (row[3]||'').trim();
      if (!cat || !val) continue;
      if (rm === mes || rm === '') metas[cat] = { meta:val, tipo:'Gasto' };
    }
    return metas;
  } catch(e) { return {}; }
}

async function appendToSheetLoja(dataGasto, descricao, valor, categoria, quemPagou, tipo, formaPgto, parcelas, observacao, mesAno, registradoEm, conta) {
  const { sheets } = await getSheetsClient();
  const res = await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID, range: 'Loja!A:M', valueInputOption:'USER_ENTERED',
    resource: { values: [[dataGasto, descricao, valor, categoria, quemPagou, tipo, formaPgto, parcelas, observacao, mesAno, registradoEm, conta||'', '']] }
  });
  const match = res.data.updates.updatedRange.match(/(\d+)$/);
  return match ? parseInt(match[1]) : '?';
}

async function getSheetRowsLoja() {
  const { sheets } = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId:SHEET_ID, range:'Loja!A:M' });
  return res.data.values||[];
}

async function handleSemIA(chatId, caption, username) {
  if (caption) await handleLancamento(chatId, 'gasto '+caption, username, 'Saída');
  else await sendMessage(chatId,'📸 Foto recebida!\nMande com legenda: 45,90 mercado pix');
}

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
  return p[1].padStart(2,'0') + '/' + (p[2]||new Date().getFullYear());
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
  const dia = p[0].padStart(2,'0'), mes = p[1].padStart(2,'0');
  const ano = p[2] ? parseInt(p[2]) : new Date().getFullYear();
  return { dataFormatada: dia+'/'+mes+'/'+ano, toISOString: () => ano+'-'+mes+'-'+dia+'T12:00:00.000Z', toLocaleDateString: () => dia+'/'+mes+'/'+ano };
}

async function verificarEQuitarAPagar(valor, descricao) {
  try {
    const rows = await getSheetRows();
    const hoje = new Date();
    const mesAtual  = String(hoje.getMonth()+1).padStart(2,'0') + '/' + hoje.getFullYear();
    const d2 = new Date(hoje); d2.setMonth(d2.getMonth()-1);
    const mesAnterior = String(d2.getMonth()+1).padStart(2,'0') + '/' + d2.getFullYear();
    const descLower = descricao.toLowerCase();
    const palavraChave = descLower.split(' ').find(p => p.length > 2) || descLower;
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row[0]) continue;
      if ((row[5]||'').trim() !== 'A Pagar') continue;
      const mesRow = (row[9]||'').trim();
      if (mesRow !== mesAtual && mesRow !== mesAnterior) continue;
      const valorRow = parseFloat((row[2]||'0').toString().replace(',','.')) || 0;
      const descRow  = (row[1]||'').toLowerCase();
      if (Math.abs(valorRow - valor) < 0.01 && descRow.includes(palavraChave)) {
        const dataHoje     = new Date().toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'});
        const registradoEm = new Date().toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'});
        const obsAtual     = (row[8]||'').trim();
        const obsFinal     = 'Quitado em ' + dataHoje + (obsAtual ? ' | '+obsAtual : '');
        await editarLinha(i+1, row[0], row[1], valorRow, row[3]||'Casa', row[4]||'', 'A Pagar', row[6]||'', row[7]||'', obsFinal, row[9]||'', registradoEm, row[11]||'');
        const eventId = row[12] ? row[12].trim() : null;
        if (eventId) { try { await atualizarEventoCalendar(eventId, row[1], valorRow, dataHoje, row[0]); } catch(e) {} }
        return { encontrado: true, linha: i+1, descricao: row[1], vencimento: row[0] };
      }
    }
    return { encontrado: false };
  } catch(err) { console.error('Erro varredura A Pagar:', err); return { encontrado: false }; }
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

async function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({ credentials: GOOGLE_CREDENTIALS, scopes:['https://www.googleapis.com/auth/spreadsheets','https://www.googleapis.com/auth/calendar'] });
  return { sheets: google.sheets({version:'v4',auth}), auth };
}

async function appendToSheet(dataGasto, descricao, valor, categoria, quemPagou, tipo, formaPgto, parcelas, observacao, mesAno, registradoEm, conta) {
  const { sheets } = await getSheetsClient();
  const res = await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID, range: 'Página1!A:M', valueInputOption:'USER_ENTERED',
    resource: { values: [[dataGasto, descricao, valor, categoria, quemPagou, tipo, formaPgto, parcelas, observacao, mesAno, registradoEm, conta||'', '']] }
  });
  const match = res.data.updates.updatedRange.match(/(\d+)$/);
  return match ? parseInt(match[1]) : '?';
}

async function editarLinha(linha, dataGasto, descricao, valor, categoria, quemPagou, tipo, formaPgto, parcelas, observacao, mesAno, registradoEm, conta) {
  const { sheets } = await getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID, range: 'Página1!A'+linha+':L'+linha, valueInputOption:'USER_ENTERED',
    resource: { values: [[dataGasto, descricao, valor, categoria, quemPagou, tipo, formaPgto, parcelas, observacao, mesAno, registradoEm, conta||'']] }
  });
}

async function excluirLinha(linha) {
  const { sheets } = await getSheetsClient();
  await sheets.spreadsheets.batchUpdate({ spreadsheetId: SHEET_ID, resource: { requests:[{ deleteDimension:{ range:{ sheetId:0, dimension:'ROWS', startIndex:linha-1, endIndex:linha } } }] } });
}

async function getSheetRows() {
  const { sheets } = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId:SHEET_ID, range:'Página1!A:M' });
  return res.data.values||[];
}

async function salvarCalendarId(linha, eventId) {
  const { sheets } = await getSheetsClient();
  await sheets.spreadsheets.values.update({ spreadsheetId: SHEET_ID, range: 'Página1!M'+linha, valueInputOption: 'USER_ENTERED', resource: { values: [[eventId]] } });
}

async function criarEventoCalendar(descricao, valor, dataVenc, dataStr) {
  const auth = new google.auth.GoogleAuth({ credentials:GOOGLE_CREDENTIALS, scopes:['https://www.googleapis.com/auth/calendar'] });
  const calendar = google.calendar({version:'v3',auth});
  const res = await calendar.events.insert({
    calendarId: CALENDAR_ID,
    resource: {
      summary: 'Vence: ' + descricao + ' - R$ ' + valor.toFixed(2),
      description: 'Conta a pagar — R$ ' + valor.toFixed(2) + ' — vence em ' + dataStr,
      start:{ date: dataVenc.toISOString().split('T')[0] },
      end:  { date: dataVenc.toISOString().split('T')[0] },
      reminders:{ useDefault:false, overrides:[{method:'popup',minutes:3*24*60},{method:'popup',minutes:24*60},{method:'popup',minutes:0}]}
    }
  });
  return res.data.id;
}

async function excluirEventoCalendar(eventId) {
  try {
    const auth = new google.auth.GoogleAuth({ credentials:GOOGLE_CREDENTIALS, scopes:['https://www.googleapis.com/auth/calendar'] });
    const calendar = google.calendar({version:'v3',auth});
    await calendar.events.delete({ calendarId: CALENDAR_ID, eventId });
  } catch(e) { console.error('Erro ao excluir evento Calendar:', e.message); }
}

async function atualizarEventoCalendar(eventId, descricao, valor, dataPagamento, dataVencimento) {
  const auth = new google.auth.GoogleAuth({ credentials:GOOGLE_CREDENTIALS, scopes:['https://www.googleapis.com/auth/calendar'] });
  const calendar = google.calendar({version:'v3',auth});
  await calendar.events.patch({
    calendarId: CALENDAR_ID, eventId,
    resource: { summary: 'Pago: ' + descricao + ' - R$ ' + valor.toFixed(2), description: 'Conta paga em ' + dataPagamento + '\nVencimento original: ' + dataVencimento + '\nValor: R$ ' + valor.toFixed(2) }
  });
}

async function sendMessage(chatId, text) {
  await fetch('https://api.telegram.org/bot' + TELEGRAM_TOKEN + '/sendMessage', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ chat_id:chatId, text, parse_mode:'Markdown' })
  });
}

async function sendMessageWithButtons(chatId, text, buttons) {
  await fetch('https://api.telegram.org/bot' + TELEGRAM_TOKEN + '/sendMessage', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ chat_id:chatId, text, parse_mode:'Markdown', reply_markup:{ inline_keyboard:buttons } })
  });
}

const PORT = process.env.PORT||3000;
app.listen(PORT, () => console.log('Bot rodando na porta ' + PORT));
