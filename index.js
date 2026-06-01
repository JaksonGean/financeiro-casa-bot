const express = require('express');
const fetch = require('node-fetch');
const { google } = require('googleapis');

const app = express();
app.use(express.json());

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const SHEET_ID       = process.env.SHEET_ID;
const CALENDAR_ID    = process.env.CALENDAR_ID;
const GOOGLE_CREDENTIALS = process.env.GOOGLE_CREDENTIALS
  ? JSON.parse(process.env.GOOGLE_CREDENTIALS)
  : null;

const CATEGORIAS_SAIDA = [
  'Alimentação', 'Casa', 'Transporte', 'Saúde', 'Educação',
  'Lazer', 'Vestuário', 'Assinaturas', 'Pet', 'Investimento', 'Outros'
];
const CATEGORIAS_ENTRADA = [
  'Salário Jakson', 'Salário Dany', 'Freelance Jakson',
  'Freelance Dany', 'Rendimento', 'Presente', 'Outras entradas'
];
const FORMAS_PAGAMENTO = ['pix', 'debito', 'crédito', 'credito', 'dinheiro', 'ted', 'doc'];
const MESES = {
  'janeiro':1,'fevereiro':2,'março':3,'abril':4,'maio':5,'junho':6,
  'julho':7,'agosto':8,'setembro':9,'outubro':10,'novembro':11,'dezembro':12
};

// Confirmações pendentes
const pendentes = {};

// ============================================================
//  WEBHOOK
// ============================================================
app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  try { await handleUpdate(req.body); }
  catch (err) { console.error('Erro webhook:', err); }
});

app.get('/', (req, res) => res.send('Bot Financeiro Casa rodando!'));

// ============================================================
//  HANDLER PRINCIPAL
// ============================================================
async function handleUpdate(update) {
  // Callback de botões inline — deve ser verificado ANTES de ler update.message
  if (update.callback_query) {
    await handleCallback(update.callback_query);
    return;
  }

  const message = update.message || update.edited_message;
  if (!message) return;

  const chatId    = message.chat.id;
  const username  = message.from.username || message.from.first_name || 'desconhecido';
  const text      = message.text || '';
  const textLower = text.toLowerCase().trim();

  // Foto
  if (message.photo && message.photo.length > 0) {
    await handleSemIA(chatId, message.caption || '', username);
    return;
  }

  // Confirmação de duplicata pendente
  if (pendentes[chatId]) {
    await handleConfirmacao(chatId, textLower);
    return;
  }

  if (textLower.startsWith('/gasto')     || textLower.startsWith('gasto'))      { await handleLancamento(chatId, text, username, 'Saída'); return; }
  if (textLower.startsWith('/entrada')   || textLower.startsWith('entrada'))    { await handleLancamento(chatId, text, username, 'Entrada'); return; }
  if (textLower.startsWith('/apagar')    || textLower.startsWith('apagar'))     { await handleApagar(chatId, text, username); return; }
  if (textLower.startsWith('/editar')    || textLower.startsWith('editar'))     { await handleEditar(chatId, text, username); return; }
  if (textLower.startsWith('/excluir')   || textLower.startsWith('excluir'))    { await handleExcluir(chatId, text); return; }
  if (textLower.startsWith('/resumo')    || textLower.startsWith('resumo') ||
      textLower.startsWith('/saldo')     || textLower.startsWith('saldo'))      { await handleResumo(chatId); return; }
  if (textLower.startsWith('/ultimos')   || textLower.startsWith('ultimos'))    { await handleUltimos(chatId); return; }
  if (textLower.startsWith('/categorias')|| textLower.startsWith('categorias')) { await handleCategorias(chatId); return; }
  if (textLower.startsWith('/menu')      || textLower.startsWith('menu') ||
      textLower.startsWith('/ajuda')     || textLower.startsWith('ajuda') ||
      textLower === '/start')                                                    { await handleMenu(chatId); return; }
}

// ============================================================
//  CALLBACK DE BOTÕES
// ============================================================
async function handleCallback(query) {
  const chatId = query.message.chat.id;
  const data   = query.data;

  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: query.id })
  });

  switch(data) {
    case 'como_gasto':
      await sendMessage(chatId,
        `💸 *Como lançar uma saída:*\n\n` +
        `*Formato:* gasto [valor] [descrição] [categoria] [forma pgto] [parcelas] [data] [-- observação]\n\n` +
        `*Exemplos:*\n` +
        `• gasto 45,90 mercado Alimentação\n` +
        `• gasto 45,90 mercado Alimentação pix\n` +
        `• gasto 1200 geladeira Casa credito 3x\n` +
        `• gasto 250 farmacia Saúde debito 30/05\n` +
        `• gasto 80 cinema Lazer dinheiro -- aniversário da Dany\n\n` +
        `_Apenas valor e descrição são obrigatórios!_`
      ); break;
    case 'como_entrada':
      await sendMessage(chatId,
        `💰 *Como lançar uma entrada:*\n\n` +
        `*Formato:* entrada [valor] [descrição] [categoria] [forma] [data]\n\n` +
        `*Exemplos:*\n` +
        `• entrada 5000 salario\n` +
        `• entrada 5000 salario "Salário Jakson" pix 05/06\n` +
        `• entrada 1500 freela "Freelance Jakson"\n\n` +
        `_Apenas valor e descrição são obrigatórios!_`
      ); break;
    case 'como_apagar':
      await sendMessage(chatId,
        `📋 *Como lançar conta a pagar:*\n\n` +
        `*Formato:* apagar [valor] [descrição] [dd/mm]\n\n` +
        `*Exemplos:*\n` +
        `• apagar 150,00 conta-luz 15/06\n` +
        `• apagar 89,90 netflix 10/06\n\n` +
        `_Um lembrete será criado no Google Calendar!_`
      ); break;
    case 'como_editar':
      await sendMessage(chatId,
        `✏️ *Como editar um lançamento:*\n\n` +
        `*Formato:* editar [linha] [valor] [descrição] [categoria]\n\n` +
        `*Exemplos:*\n` +
        `• editar 5 65,00 mercado Alimentação\n\n` +
        `_O número da linha aparece em cada confirmação de lançamento._\n` +
        `_Use_ ultimos _para ver os últimos lançamentos com as linhas._`
      ); break;
    case 'como_excluir':
      await sendMessage(chatId,
        `🗑️ *Como excluir um lançamento:*\n\n` +
        `*Formato:* excluir [linha]\n\n` +
        `*Exemplo:*\n` +
        `• excluir 5\n\n` +
        `_O número da linha aparece em cada confirmação de lançamento._`
      ); break;
    case 'ver_categorias':
      await handleCategorias(chatId); break;
    case 'ver_formas':
      await sendMessage(chatId,
        `💳 *Formas de pagamento aceitas:*\n\n` +
        `• pix\n• debito\n• credito\n• dinheiro\n• ted\n• doc\n\n` +
        `_Para parcelamento no crédito adicione ex:_ 3x _após_ credito`
      ); break;
    case 'ver_resumo':
      await handleResumo(chatId); break;
    case 'ver_ultimos':
      await handleUltimos(chatId); break;
  }
}

// ============================================================
//  MENU INTERATIVO
// ============================================================
async function handleMenu(chatId) {
  await sendMessageWithButtons(chatId,
    `👋 *Financeiro Casa - Menu*\n\nO que você quer fazer?`,
    [
      [{ text: '💸 Como lançar gasto', callback_data: 'como_gasto' },
       { text: '💰 Como lançar entrada', callback_data: 'como_entrada' }],
      [{ text: '📋 Como lançar conta a pagar', callback_data: 'como_apagar' }],
      [{ text: '✏️ Como editar', callback_data: 'como_editar' },
       { text: '🗑️ Como excluir', callback_data: 'como_excluir' }],
      [{ text: '📊 Ver resumo do mês', callback_data: 'ver_resumo' },
       { text: '📋 Últimos lançamentos', callback_data: 'ver_ultimos' }],
      [{ text: '🏷️ Ver categorias', callback_data: 'ver_categorias' },
       { text: '💳 Formas de pagamento', callback_data: 'ver_formas' }],
    ]
  );
}

// ============================================================
//  PARSER INTELIGENTE — extrai dados do texto em qualquer ordem
// ============================================================
function parsearLancamento(text, tipo) {
  // Remove o comando
  let raw = text.replace(/^\/?(?:gasto|entrada)\s*/i, '').trim();

  // Extrai observação (depois de --)
  let observacao = '';
  if (raw.includes('--')) {
    const partes = raw.split('--');
    raw = partes[0].trim();
    observacao = partes[1].trim();
  }

  const tokens = raw.split(/\s+/);
  let valor = null, descricao = null, categoria = null;
  let formaPgto = '', parcelas = '1', dataGasto = null;
  const usados = new Set();

  // Extrai valor (número com vírgula ou ponto)
  for (let i = 0; i < tokens.length; i++) {
    const n = parseFloat(tokens[i].replace(',', '.'));
    if (!isNaN(n) && tokens[i].match(/[\d,\.]+/)) {
      valor = n; usados.add(i); break;
    }
  }

  // Extrai parcelas (ex: 3x, 12x)
  for (let i = 0; i < tokens.length; i++) {
    if (usados.has(i)) continue;
    if (/^\d+x$/i.test(tokens[i])) {
      parcelas = tokens[i].replace(/x/i, '');
      usados.add(i);
    }
  }

  // Extrai forma de pagamento
  for (let i = 0; i < tokens.length; i++) {
    if (usados.has(i)) continue;
    const t = tokens[i].toLowerCase();
    if (FORMAS_PAGAMENTO.includes(t)) {
      formaPgto = capitalizar(tokens[i]);
      usados.add(i);
    }
  }

  // Extrai data
  for (let i = 0; i < tokens.length; i++) {
    if (usados.has(i)) continue;
    const d = parsearData(tokens[i], tokens[i+1]);
    if (d) {
      dataGasto = d.data;
      usados.add(i);
      if (d.consumiu2) usados.add(i+1);
    }
  }

  // Extrai categoria
  const lista = tipo === 'Entrada' ? CATEGORIAS_ENTRADA : CATEGORIAS_SAIDA;
  for (let i = 0; i < tokens.length; i++) {
    if (usados.has(i)) continue;
    const t = tokens[i].toLowerCase();
    const cat = lista.find(c => c.toLowerCase().startsWith(t) || t.startsWith(c.toLowerCase().split(' ')[0]));
    if (cat) { categoria = cat; usados.add(i); break; }
  }

  // O que sobrou é a descrição
  const restantes = tokens.filter((_, i) => !usados.has(i));
  descricao = restantes.join(' ') || 'Sem descrição';
  descricao = capitalizar(descricao);

  if (!dataGasto) {
    dataGasto = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  }
  if (!categoria) {
    categoria = tipo === 'Saída' ? 'Outros' : 'Outras entradas';
  }

  return { valor, descricao, categoria, formaPgto, parcelas, dataGasto, observacao };
}

// ============================================================
//  PARSER DE DATA — aceita vários formatos
// ============================================================
function parsearData(token, tokenNext) {
  if (!token) return null;
  const t = token.toLowerCase();

  // "ontem"
  if (t === 'ontem') {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return { data: d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }), consumiu2: false };
  }
  // "hoje"
  if (t === 'hoje') {
    return { data: new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }), consumiu2: false };
  }

  // dd/mm ou dd/mm/yyyy
  const regDiaMes = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/;
  const m1 = token.match(regDiaMes);
  if (m1) {
    const dia = m1[1].padStart(2, '0');
    const mes = m1[2].padStart(2, '0');
    const ano = m1[3] ? (m1[3].length === 2 ? '20' + m1[3] : m1[3]) : new Date().getFullYear();
    return { data: `${dia}/${mes}/${ano}`, consumiu2: false };
  }

  // "30 de maio" ou "30 do 05"
  const regDiaMesExt = /^(\d{1,2})$/;
  if (regDiaMesExt.test(token) && tokenNext) {
    const tn = tokenNext.toLowerCase().replace(/^de\s+|^do\s+/, '');
    const mesNum = MESES[tn] || parseInt(tn);
    if (mesNum >= 1 && mesNum <= 12) {
      const dia = token.padStart(2, '0');
      const mes = String(mesNum).padStart(2, '0');
      const ano = new Date().getFullYear();
      return { data: `${dia}/${mes}/${ano}`, consumiu2: true };
    }
  }

  return null;
}

// ============================================================
//  HANDLER — lançamento
// ============================================================
async function handleLancamento(chatId, text, username, tipo) {
  const p = parsearLancamento(text, tipo);

  if (!p.valor || isNaN(p.valor)) {
    const cmd = tipo === 'Saída' ? 'gasto' : 'entrada';
    await sendMessage(chatId,
      `⚠️ Não encontrei o valor.\nUse: ${cmd} 45,90 descrição\nDigite _menu_ para ver exemplos.`
    );
    return;
  }

  const registradoEm = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const mesAno = calcularMesAno(p.dataGasto);
  const dadosBase = { ...p, username, tipo, registradoEm, mesAno };

  // Verifica duplicata
  const duplicata = await verificarDuplicata(p.valor, p.descricao);
  if (duplicata) {
    pendentes[chatId] = { dados: dadosBase };
    await sendMessage(chatId,
      `⚠️ *Lançamento similar encontrado!*\n` +
      `📌 Linha #${duplicata.linha} | ${duplicata.descricao} | R$ ${parseFloat(duplicata.valor).toFixed(2)} | ${duplicata.data}\n\n` +
      `Pode ser um gasto recorrente.\nConfirma o novo lançamento?\n\n✅ *sim*  ou  ❌ *não*`
    );
    return;
  }

  await salvarLancamento(chatId, dadosBase);
}

async function handleConfirmacao(chatId, textLower) {
  const pendente = pendentes[chatId];
  delete pendentes[chatId];
  if (textLower === 'sim' || textLower === 's') {
    await salvarLancamento(chatId, pendente.dados);
  } else {
    await sendMessage(chatId, '❌ Lançamento cancelado!');
  }
}

async function salvarLancamento(chatId, d) {
  const numParcelas = parseInt(d.parcelas) || 1;

  if (numParcelas > 1) {
    // Lança cada parcela
    let linhas = [];
    for (let i = 0; i < numParcelas; i++) {
      const dataParc = somarMeses(d.dataGasto, i);
      const mesAno   = calcularMesAno(dataParc);
      const desc     = `${d.descricao} (${i+1}/${numParcelas})`;
      const linha    = await appendToSheet(dataParc, desc, d.valor / numParcelas, d.categoria, d.username, d.tipo, d.formaPgto, `${i+1}/${numParcelas}`, d.observacao, mesAno, d.registradoEm);
      linhas.push(linha);
    }
    const emoji = d.tipo === 'Saída' ? '💸' : '💰';
    await sendMessage(chatId,
      `${emoji} *${numParcelas}x registradas!*\n` +
      `📝 Descrição: ${d.descricao}\n` +
      `💵 Valor total: R$ ${parseFloat(d.valor).toFixed(2)}\n` +
      `💵 Por parcela: R$ ${(d.valor / numParcelas).toFixed(2)}\n` +
      `🏷️ Categoria: ${d.categoria}\n` +
      `💳 Forma: ${d.formaPgto || 'Não informada'}\n` +
      `👤 Por: ${d.username}\n` +
      `📌 Linhas: #${linhas.join(', #')}`
    );
  } else {
    const linha = await appendToSheet(d.dataGasto, d.descricao, d.valor, d.categoria, d.username, d.tipo, d.formaPgto, '', d.observacao, d.mesAno, d.registradoEm);
    const emoji = d.tipo === 'Saída' ? '💸' : '💰';
    await sendMessage(chatId,
      `${emoji} *${d.tipo} registrada!*\n` +
      `📅 Data: ${d.dataGasto}\n` +
      `📝 Descrição: ${d.descricao}\n` +
      `💵 Valor: R$ ${parseFloat(d.valor).toFixed(2)}\n` +
      `🏷️ Categoria: ${d.categoria}\n` +
      `💳 Forma: ${d.formaPgto || 'Não informada'}\n` +
      (d.observacao ? `📌 Obs: ${d.observacao}\n` : '') +
      `👤 Por: ${d.username}\n` +
      `📌 Linha: #${linha}\n\n` +
      `_editar ${linha} novo-valor descrição categoria_\n` +
      `_excluir ${linha}_`
    );
  }
}

// ============================================================
//  HANDLER — contas a pagar com Calendar
// ============================================================
async function handleApagar(chatId, text, username) {
  const semComando = text.replace(/^\/?apagar\s*/i, '').trim();
  const partes     = semComando.split(' ');

  if (partes.length < 3) {
    await sendMessage(chatId, '⚠️ Use: apagar 150,00 descrição dd/mm\nEx: apagar 150,00 conta-luz 15/06');
    return;
  }

  const valor      = parseFloat(partes[0].replace(',', '.'));
  const descricao  = capitalizar(partes[1]);
  const vencStr    = partes[2];
  const registradoEm = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const dataHoje   = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const mesAno     = calcularMesAno(dataHoje);

  if (isNaN(valor)) { await sendMessage(chatId, '⚠️ Valor inválido.'); return; }

  const dataVenc = parsearDataCompleta(vencStr);
  if (!dataVenc) { await sendMessage(chatId, '⚠️ Data inválida. Use dd/mm. Ex: 15/06'); return; }

  const linha = await appendToSheet(dataHoje, descricao, valor, 'Casa', username, 'A Pagar', '', '', '', mesAno, registradoEm);

  // Cria evento no Google Calendar
  let calendarMsg = '';
  try {
    await criarEventoCalendar(descricao, valor, dataVenc, vencStr);
    calendarMsg = `📅 Lembrete criado no Google Calendar!`;
  } catch(err) {
    console.error('Erro Calendar:', err);
    calendarMsg = `⚠️ Não consegui criar o lembrete no Calendar.`;
  }

  await sendMessage(chatId,
    `📋 *Conta a pagar registrada!*\n` +
    `📅 Cadastrado: ${dataHoje}\n` +
    `📝 Descrição: ${descricao}\n` +
    `💵 Valor: R$ ${valor.toFixed(2)}\n` +
    `⏰ Vencimento: ${vencStr}\n` +
    `👤 Por: ${username}\n` +
    `📌 Linha: #${linha}\n` +
    calendarMsg
  );
}

// ============================================================
//  HANDLER — editar
// ============================================================
async function handleEditar(chatId, text, username) {
  const semComando = text.replace(/^\/?editar\s*/i, '').trim();
  const partes     = semComando.split(' ');

  if (partes.length < 2) {
    await sendMessage(chatId, '⚠️ Use: editar linha valor descrição categoria\nEx: editar 5 65,00 mercado Alimentação');
    return;
  }

  const linhaNum = parseInt(partes[0]);
  if (isNaN(linhaNum)) {
    await sendMessage(chatId, '⚠️ Número de linha inválido.\nEx: editar 5 65,00 mercado Alimentação');
    return;
  }

  // Bug 4 fix: verifica se o segundo argumento é realmente um número (valor)
  const valorTentativa = parseFloat((partes[1] || '').replace(',', '.'));
  if (isNaN(valorTentativa)) {
    await sendMessage(chatId,
      `⚠️ Valor não encontrado ou inválido.\n` +
      `Use: editar ${linhaNum} *valor* descrição categoria\n` +
      `Ex: editar ${linhaNum} 65,00 mercado Alimentação`
    );
    return;
  }

  const valor      = valorTentativa;
  const descricao  = capitalizar(partes[2] || 'Sem descrição');
  const catDigitada = partes.slice(3).join(' ') || '';
  const dataHoje   = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const registradoEm = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

  // Bug 3 fix: lê a linha existente para descobrir o tipo (Entrada ou Saída)
  let tipoExistente = 'Saída';
  try {
    const rows = await getSheetRows();
    const linhaIdx = linhaNum - 1; // planilha é 1-based, array é 0-based
    if (rows[linhaIdx] && rows[linhaIdx][5]) {
      tipoExistente = rows[linhaIdx][5];
    }
  } catch(e) { /* mantém 'Saída' como fallback */ }

  const categoria = encontrarCategoria(catDigitada, tipoExistente) ||
    (tipoExistente === 'Entrada' ? 'Outras entradas' : 'Outros');
  const mesAno    = calcularMesAno(dataHoje);

  await editarLinha(linhaNum, dataHoje, descricao, valor, categoria, username, tipoExistente, '', '', '', mesAno, registradoEm);

  await sendMessage(chatId,
    `✏️ *Linha #${linhaNum} editada!*\n` +
    `📝 ${descricao} | R$ ${valor.toFixed(2)} | ${categoria}`
  );
}

// ============================================================
//  HANDLER — excluir
// ============================================================
async function handleExcluir(chatId, text) {
  const linhaNum = parseInt(text.replace(/^\/?excluir\s*/i, '').trim());
  if (isNaN(linhaNum)) { await sendMessage(chatId, '⚠️ Use: excluir 5'); return; }
  await excluirLinha(linhaNum);
  await sendMessage(chatId, `🗑️ Linha #${linhaNum} excluída!`);
}

// ============================================================
//  HANDLER — últimos lançamentos
// ============================================================
async function handleUltimos(chatId) {
  try {
    const rows = await getSheetRows();
    const dados = rows.slice(1).map((row, i) => ({ linha: i + 2, row }))
      .filter(({ row }) => row[0]).slice(-10).reverse();

    if (dados.length === 0) { await sendMessage(chatId, 'Nenhum lançamento encontrado.'); return; }

    let msg = `📋 *Últimos lançamentos:*\n\n`;
    dados.forEach(({ linha, row }) => {
      const tipo  = row[5] === 'Entrada' ? '💰' : row[5] === 'A Pagar' ? '📋' : '💸';
      const forma = row[6] ? ` | ${row[6]}` : '';
      msg += `${tipo} *#${linha}* | ${row[0]} | ${row[1]} | R$ ${parseFloat(row[2]).toFixed(2)}${forma}\n`;
    });
    msg += `\n_editar linha valor descrição_\n_excluir linha_`;
    await sendMessage(chatId, msg);
  } catch(err) {
    await sendMessage(chatId, '❌ Erro ao buscar lançamentos.');
  }
}

// ============================================================
//  HANDLER — resumo
// ============================================================
async function handleResumo(chatId) {
  try {
    const rows = await getSheetRows();
    const hoje = new Date();
    const mesAnoAtual = `${String(hoje.getMonth()+1).padStart(2,'0')}/${hoje.getFullYear()}`;

    let totalEntradas = 0, totalSaidas = 0, totalAPagar = 0;
    const porCategoria = {};
    const porForma = {};

    for (const row of rows.slice(1)) {
      if (!row[0] || row[9] !== mesAnoAtual) continue;
      const valor = parseFloat(row[2]) || 0;
      const tipo  = row[5] || 'Saída';
      const cat   = row[3] || 'Outros';
      const forma = row[6] || 'Não informada';

      if (tipo === 'Entrada')      totalEntradas += valor;
      else if (tipo === 'A Pagar') totalAPagar   += valor;
      else {
        totalSaidas += valor;
        porCategoria[cat]  = (porCategoria[cat]  || 0) + valor;
        porForma[forma]    = (porForma[forma]    || 0) + valor;
      }
    }

    const nomeMes = hoje.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' });
    let msg = `📊 *Resumo de ${nomeMes}*\n\n`;
    msg += `💰 Entradas: R$ ${totalEntradas.toFixed(2)}\n`;
    msg += `💸 Saídas: R$ ${totalSaidas.toFixed(2)}\n`;
    if (totalAPagar > 0) msg += `📋 A Pagar: R$ ${totalAPagar.toFixed(2)}\n`;
    msg += `📈 *Saldo: R$ ${(totalEntradas - totalSaidas).toFixed(2)}*\n`;

    if (Object.keys(porCategoria).length > 0) {
      msg += `\n*Por categoria:*\n`;
      Object.entries(porCategoria).sort((a,b) => b[1]-a[1]).forEach(([cat,val]) => {
        msg += `🏷️ ${cat}: R$ ${val.toFixed(2)}\n`;
      });
    }

    if (Object.keys(porForma).length > 0) {
      msg += `\n*Por forma de pagamento:*\n`;
      Object.entries(porForma).sort((a,b) => b[1]-a[1]).forEach(([f,val]) => {
        msg += `💳 ${f}: R$ ${val.toFixed(2)}\n`;
      });
    }

    await sendMessage(chatId, msg);
  } catch(err) {
    await sendMessage(chatId, '❌ Erro ao buscar resumo.');
  }
}

// ============================================================
//  HANDLER — categorias
// ============================================================
async function handleCategorias(chatId) {
  let msg = `🏷️ *Categorias disponíveis*\n\n`;
  msg += `*💸 Saídas:*\n${CATEGORIAS_SAIDA.map(c=>`• ${c}`).join('\n')}\n\n`;
  msg += `*💰 Entradas:*\n${CATEGORIAS_ENTRADA.map(c=>`• ${c}`).join('\n')}`;
  await sendMessage(chatId, msg);
}

// ============================================================
//  HANDLER — sem IA (foto sem chave)
// ============================================================
async function handleSemIA(chatId, caption, username) {
  if (caption) {
    await handleLancamento(chatId, 'gasto ' + caption, username, 'Saída');
  } else {
    await sendMessage(chatId, '📸 Foto recebida!\nMande com legenda: 45,90 mercado Alimentação pix\n\nDigite _menu_ para ver os comandos.');
  }
}

// ============================================================
//  UTILITÁRIOS
// ============================================================
function capitalizar(texto) {
  if (!texto) return texto;
  return texto.charAt(0).toUpperCase() + texto.slice(1).toLowerCase();
}

function encontrarCategoria(texto, tipo) {
  if (!texto) return null;
  const lista = tipo === 'Entrada' ? CATEGORIAS_ENTRADA : CATEGORIAS_SAIDA;
  const lower = texto.toLowerCase();
  return lista.find(c => c.toLowerCase().includes(lower) || lower.includes(c.toLowerCase().split(' ')[0]));
}

function calcularMesAno(dataStr) {
  if (!dataStr) return '';
  const partes = dataStr.split('/');
  if (partes.length < 2) return '';
  return `${partes[1].padStart(2,'0')}/${partes[2] || new Date().getFullYear()}`;
}

function somarMeses(dataStr, meses) {
  const partes = dataStr.split('/');
  const d = new Date(partes[2] || new Date().getFullYear(), parseInt(partes[1])-1+meses, parseInt(partes[0]));
  return d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function parsearDataCompleta(str) {
  if (!str) return null;
  const partes = str.split('/');
  if (partes.length < 2) return null;
  const ano = partes[2] ? parseInt(partes[2]) : new Date().getFullYear();
  return new Date(ano, parseInt(partes[1])-1, parseInt(partes[0]));
}

async function verificarDuplicata(valor, descricao) {
  try {
    const rows   = await getSheetRows();
    const limite = new Date(Date.now() - 7*24*60*60*1000);
    for (let i = rows.length-1; i >= 1; i--) {
      const row = rows[i];
      if (!row[0]) continue;
      const partes  = row[0].toString().split('/');
      if (partes.length < 3) continue;
      const dataRow = new Date(partes[2], partes[1]-1, partes[0]);
      if (dataRow < limite) break;
      if (parseFloat(row[2]) === valor && (row[1]||'').toLowerCase().includes(descricao.toLowerCase().split(' ')[0])) {
        return { linha: i+1, descricao: row[1], valor: row[2], data: row[0] };
      }
    }
    return null;
  } catch(err) { return null; }
}

// ============================================================
//  GOOGLE SHEETS
// ============================================================
async function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: GOOGLE_CREDENTIALS,
    scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/calendar'],
  });
  return { sheets: google.sheets({ version: 'v4', auth }), auth };
}

async function appendToSheet(dataGasto, descricao, valor, categoria, quemPagou, tipo, formaPgto, parcelas, observacao, mesAno, registradoEm) {
  const { sheets } = await getSheetsClient();
  const res = await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: 'Página1!A:K',
    valueInputOption: 'USER_ENTERED',
    resource: { values: [[dataGasto, descricao, valor, categoria, quemPagou, tipo, formaPgto, parcelas, observacao, mesAno, registradoEm]] },
  });
  const range = res.data.updates.updatedRange;
  const match = range.match(/(\d+)$/);
  return match ? parseInt(match[1]) : '?';
}

async function editarLinha(linha, dataGasto, descricao, valor, categoria, quemPagou, tipo, formaPgto, parcelas, observacao, mesAno, registradoEm) {
  const { sheets } = await getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `Página1!A${linha}:K${linha}`,
    valueInputOption: 'USER_ENTERED',
    resource: { values: [[dataGasto, descricao, valor, categoria, quemPagou, tipo, formaPgto, parcelas, observacao, mesAno, registradoEm]] },
  });
}

async function excluirLinha(linha) {
  const { sheets } = await getSheetsClient();
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    resource: { requests: [{ deleteDimension: { range: { sheetId: 0, dimension: 'ROWS', startIndex: linha-1, endIndex: linha } } }] }
  });
}

async function getSheetRows() {
  const { sheets } = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: 'Página1!A:K' });
  return res.data.values || [];
}

// ============================================================
//  GOOGLE CALENDAR
// ============================================================
async function criarEventoCalendar(descricao, valor, dataVenc, dataStr) {
  const auth = new google.auth.GoogleAuth({
    credentials: GOOGLE_CREDENTIALS,
    scopes: ['https://www.googleapis.com/auth/calendar'],
  });
  const calendar = google.calendar({ version: 'v3', auth });

  const dataInicio = dataVenc.toISOString().split('T')[0];

  await calendar.events.insert({
    calendarId: CALENDAR_ID,
    resource: {
      summary: `💸 Vence: ${descricao} - R$ ${valor.toFixed(2)}`,
      description: `Conta a pagar lançada pelo bot Financeiro Casa.\nValor: R$ ${valor.toFixed(2)}\nVencimento: ${dataStr}`,
      start: { date: dataInicio },
      end:   { date: dataInicio },
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'popup', minutes: 3 * 24 * 60 },  // 3 dias antes
          { method: 'popup', minutes: 24 * 60 },       // 1 dia antes
          { method: 'popup', minutes: 0 },             // no dia
        ]
      }
    }
  });
}

// ============================================================
//  TELEGRAM
// ============================================================
async function sendMessage(chatId, text) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
  });
}

async function sendMessageWithButtons(chatId, text, buttons) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId, text, parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    }),
  });
}

async function getFileUrl(fileId) {
  const res  = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getFile?file_id=${fileId}`);
  const data = await res.json();
  if (!data.ok) return null;
  return `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${data.result.file_path}`;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bot rodando na porta ${PORT}`));
