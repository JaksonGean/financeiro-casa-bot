const express = require('express');
const fetch = require('node-fetch');
const { google } = require('googleapis');

const app = express();
app.use(express.json());

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const SHEET_ID       = process.env.SHEET_ID;
const ANTHROPIC_KEY  = process.env.ANTHROPIC_KEY || '';

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

// Armazena confirmações pendentes de duplicata
// { chatId: { dados, tipo, resolve } }
const pendentes = {};

// ============================================================
//  WEBHOOK
// ============================================================
app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  try {
    await handleUpdate(req.body);
  } catch (err) {
    console.error('Erro no webhook:', err);
  }
});

app.get('/', (req, res) => res.send('Bot Financeiro Casa rodando!'));

// ============================================================
//  HANDLER PRINCIPAL
// ============================================================
async function handleUpdate(update) {
  const message = update.message || update.edited_message;
  if (!message) return;

  const chatId    = message.chat.id;
  const username  = message.from.username || message.from.first_name || 'desconhecido';
  const text      = message.text || '';
  const textLower = text.toLowerCase().trim();

  // Foto
  if (message.photo && message.photo.length > 0) {
    await handlePhoto(chatId, message.photo, message.caption || '', username);
    return;
  }

  // Verifica se há confirmação de duplicata pendente
  if (pendentes[chatId]) {
    await handleConfirmacaoDuplicata(chatId, textLower);
    return;
  }

  if (textLower.startsWith('/gasto')    || textLower.startsWith('gasto'))      { await handleLancamento(chatId, text, username, 'Saída'); return; }
  if (textLower.startsWith('/entrada')  || textLower.startsWith('entrada'))    { await handleLancamento(chatId, text, username, 'Entrada'); return; }
  if (textLower.startsWith('/apagar')   || textLower.startsWith('apagar'))     { await handleApagar(chatId, text, username); return; }
  if (textLower.startsWith('/editar')   || textLower.startsWith('editar'))     { await handleEditar(chatId, text, username); return; }
  if (textLower.startsWith('/excluir')  || textLower.startsWith('excluir'))    { await handleExcluir(chatId, text); return; }
  if (textLower.startsWith('/resumo')   || textLower.startsWith('resumo'))     { await handleResumo(chatId); return; }
  if (textLower.startsWith('/ultimos')  || textLower.startsWith('ultimos'))    { await handleUltimos(chatId); return; }
  if (textLower.startsWith('/categorias') || textLower.startsWith('categorias')) { await handleCategorias(chatId); return; }
  if (textLower.startsWith('/ajuda')    || textLower.startsWith('ajuda') || textLower === '/start') { await handleAjuda(chatId); return; }
}

// ============================================================
//  HANDLER — lançamento (gasto ou entrada)
// ============================================================
async function handleLancamento(chatId, text, username, tipo) {
  const semComando = text.replace(/^\/?(?:gasto|entrada)\s*/i, '').trim();
  const partes     = semComando.split(' ');

  if (partes.length < 2 || !partes[0]) {
    const cmd = tipo === 'Saída' ? 'gasto' : 'entrada';
    await sendMessage(chatId,
      `⚠️ Formato incorreto.\nUse: ${cmd} valor descrição categoria\n` +
      `Ex: ${cmd} 45,90 mercado Alimentação\n\nDigite _categorias_ para ver as opções.`
    );
    return;
  }

  const valor      = parseFloat(partes[0].replace(',', '.'));
  const descricao  = capitalizar(partes[1] || 'Sem descrição');
  const catDigitada = partes[2] || '';
  const data       = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const registradoEm = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

  if (isNaN(valor)) {
    await sendMessage(chatId, '⚠️ Valor inválido. Ex: 45,90 ou 45.90');
    return;
  }

  const categoria = encontrarCategoria(catDigitada, tipo) || (tipo === 'Saída' ? 'Outros' : 'Outras entradas');
  const dadosLancamento = { data, descricao, valor, categoria, username, tipo, registradoEm };

  // Verifica duplicata nos últimos 7 dias
  const duplicata = await verificarDuplicata(valor, descricao);
  if (duplicata) {
    pendentes[chatId] = { dados: dadosLancamento };
    await sendMessage(chatId,
      `⚠️ *Lançamento similar encontrado!*\n` +
      `📌 Linha #${duplicata.linha} | ${duplicata.descricao} | R$ ${parseFloat(duplicata.valor).toFixed(2)} | ${duplicata.data}\n\n` +
      `Pode ser um gasto recorrente (pedágio, estacionamento...).\n` +
      `Confirma o novo lançamento?\n\n✅ *sim*  ou  ❌ *não*`
    );
    return;
  }

  await salvarLancamento(chatId, dadosLancamento);
}

// ============================================================
//  CONFIRMAÇÃO DE DUPLICATA
// ============================================================
async function handleConfirmacaoDuplicata(chatId, textLower) {
  const pendente = pendentes[chatId];
  delete pendentes[chatId];

  if (textLower === 'sim' || textLower === 's') {
    await salvarLancamento(chatId, pendente.dados);
  } else {
    await sendMessage(chatId, '❌ Lançamento cancelado!');
  }
}

async function salvarLancamento(chatId, d) {
  const linha = await appendToSheet(d.data, d.descricao, d.valor, d.categoria, d.username, d.tipo, 'texto', d.registradoEm);
  const emoji = d.tipo === 'Saída' ? '💸' : '💰';
  await sendMessage(chatId,
    `${emoji} *${d.tipo} registrada!*\n` +
    `📅 Data: ${d.data}\n` +
    `📝 Descrição: ${d.descricao}\n` +
    `💵 Valor: R$ ${parseFloat(d.valor).toFixed(2)}\n` +
    `🏷️ Categoria: ${d.categoria}\n` +
    `👤 Por: ${d.username}\n` +
    `📌 Linha: #${linha}\n\n` +
    `_Para editar: editar ${linha} novo-valor descrição categoria_\n` +
    `_Para excluir: excluir ${linha}_`
  );
}

// ============================================================
//  HANDLER — contas a pagar
// ============================================================
async function handleApagar(chatId, text, username) {
  const semComando = text.replace(/^\/?apagar\s*/i, '').trim();
  const partes     = semComando.split(' ');

  if (partes.length < 3) {
    await sendMessage(chatId,
      '⚠️ Formato incorreto.\nUse: apagar valor descrição dd/mm\n' +
      'Ex: apagar 150,00 conta-luz 15/06'
    );
    return;
  }

  const valor      = parseFloat(partes[0].replace(',', '.'));
  const descricao  = capitalizar(partes[1] || 'Sem descrição');
  const vencimento = partes[2];
  const data       = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const registradoEm = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

  if (isNaN(valor)) { await sendMessage(chatId, '⚠️ Valor inválido.'); return; }

  const dataVenc = parsearDataVencimento(vencimento);
  if (!dataVenc) { await sendMessage(chatId, '⚠️ Data inválida. Use dd/mm. Ex: 15/06'); return; }

  const linha = await appendToSheet(data, descricao, valor, 'Casa', username, 'A Pagar', `vence:${vencimento}`, registradoEm);

  await sendMessage(chatId,
    `📋 *Conta a pagar registrada!*\n` +
    `📅 Cadastrado em: ${data}\n` +
    `📝 Descrição: ${descricao}\n` +
    `💵 Valor: R$ ${valor.toFixed(2)}\n` +
    `⏰ Vencimento: ${vencimento}\n` +
    `👤 Por: ${username}\n` +
    `📌 Linha: #${linha}\n\n` +
    `_Para excluir: excluir ${linha}_`
  );
}

// ============================================================
//  HANDLER — editar linha
//  editar 5 65,00 mercado Alimentação
// ============================================================
async function handleEditar(chatId, text, username) {
  const semComando = text.replace(/^\/?editar\s*/i, '').trim();
  const partes     = semComando.split(' ');

  if (partes.length < 3) {
    await sendMessage(chatId,
      '⚠️ Formato incorreto.\nUse: editar linha valor descrição categoria\n' +
      'Ex: editar 5 65,00 mercado Alimentação'
    );
    return;
  }

  const linhaNum   = parseInt(partes[0]);
  const valor      = parseFloat(partes[1].replace(',', '.'));
  const descricao  = capitalizar(partes[2] || 'Sem descrição');
  const catDigitada = partes[3] || '';
  const data       = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const registradoEm = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

  if (isNaN(linhaNum) || isNaN(valor)) {
    await sendMessage(chatId, '⚠️ Linha ou valor inválido.');
    return;
  }

  const categoria = encontrarCategoria(catDigitada, 'Saída') || 'Outros';

  await editarLinha(linhaNum, data, descricao, valor, categoria, username, 'Saída', 'editado', registradoEm);

  await sendMessage(chatId,
    `✏️ *Linha #${linhaNum} editada!*\n` +
    `📅 Data: ${data}\n` +
    `📝 Descrição: ${descricao}\n` +
    `💵 Valor: R$ ${valor.toFixed(2)}\n` +
    `🏷️ Categoria: ${categoria}\n` +
    `👤 Por: ${username}`
  );
}

// ============================================================
//  HANDLER — excluir linha
// ============================================================
async function handleExcluir(chatId, text) {
  const semComando = text.replace(/^\/?excluir\s*/i, '').trim();
  const linhaNum   = parseInt(semComando);

  if (isNaN(linhaNum)) {
    await sendMessage(chatId, '⚠️ Informe o número da linha.\nEx: excluir 5');
    return;
  }

  await excluirLinha(linhaNum);
  await sendMessage(chatId, `🗑️ Linha #${linhaNum} excluída com sucesso!`);
}

// ============================================================
//  HANDLER — últimos lançamentos
// ============================================================
async function handleUltimos(chatId) {
  try {
    const rows = await getSheetRows();
    const dados = rows.slice(1).map((row, i) => ({ linha: i + 2, row }))
      .filter(({ row }) => row[0])
      .slice(-10)
      .reverse();

    if (dados.length === 0) {
      await sendMessage(chatId, 'Nenhum lançamento encontrado.');
      return;
    }

    let msg = `📋 *Últimos lançamentos:*\n\n`;
    dados.forEach(({ linha, row }) => {
      const tipo = row[5] === 'Entrada' ? '💰' : row[5] === 'A Pagar' ? '📋' : '💸';
      msg += `${tipo} *#${linha}* | ${row[0]} | ${row[1]} | R$ ${parseFloat(row[2]).toFixed(2)} | ${row[3]}\n`;
    });
    msg += `\n_Para editar: editar linha valor descrição categoria_\n_Para excluir: excluir linha_`;

    await sendMessage(chatId, msg);
  } catch (err) {
    await sendMessage(chatId, '❌ Erro ao buscar lançamentos.');
  }
}

// ============================================================
//  HANDLER — foto
// ============================================================
async function handlePhoto(chatId, photos, caption, username) {
  await sendMessage(chatId, '🔍 Analisando comprovante...');

  const fileId  = photos[photos.length - 1].file_id;
  const fileUrl = await getFileUrl(fileId);
  if (!fileUrl) { await sendMessage(chatId, '❌ Não consegui baixar a imagem.'); return; }

  if (!ANTHROPIC_KEY) { await handleSemIA(chatId, caption, username); return; }

  const imgRes = await fetch(fileUrl);
  const buffer = await imgRes.buffer();
  const base64 = buffer.toString('base64');
  const mime   = imgRes.headers.get('content-type') || 'image/jpeg';
  const hoje   = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const registradoEm = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

  const prompt = `Analise este comprovante fiscal ou recibo e extraia as informações no formato JSON abaixo.
Retorne APENAS o JSON, sem explicações ou markdown.
{
  "data": "dd/MM/yyyy",
  "descricao": "nome do estabelecimento",
  "valor": 0.00,
  "categoria": "uma de: Alimentação, Casa, Transporte, Saúde, Educação, Lazer, Vestuário, Assinaturas, Pet, Investimento, Outros"
}
Se não identificar algum campo use: data="${hoje}", descricao="Comprovante", valor=0, categoria="Outros".`;

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514', max_tokens: 500,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: mime, data: base64 } },
          { type: 'text', text: prompt }
        ]}]
      })
    });
    const result = await resp.json();
    const dados  = JSON.parse(result.content[0].text.trim());
    if (caption) dados.descricao = caption;

    const linha = await appendToSheet(dados.data, dados.descricao, dados.valor, dados.categoria, username, 'Saída', 'comprovante', registradoEm);
    await sendMessage(chatId,
      `✅ *Comprovante registrado!*\n` +
      `📅 Data: ${dados.data}\n` +
      `📝 Descrição: ${dados.descricao}\n` +
      `💵 Valor: R$ ${parseFloat(dados.valor).toFixed(2)}\n` +
      `🏷️ Categoria: ${dados.categoria}\n` +
      `👤 Por: ${username}\n` +
      `📌 Linha: #${linha}`
    );
  } catch (err) {
    console.error('Erro IA:', err);
    await handleSemIA(chatId, caption, username);
  }
}

async function handleSemIA(chatId, caption, username) {
  if (caption) {
    await handleLancamento(chatId, 'gasto ' + caption, username, 'Saída');
  } else {
    await sendMessage(chatId, '📸 Foto recebida!\nMande com legenda: valor descrição categoria\nEx: 45,90 mercado Alimentação');
  }
}

// ============================================================
//  HANDLER — resumo
// ============================================================
async function handleResumo(chatId) {
  try {
    const rows = await getSheetRows();
    const hoje = new Date();
    const mes  = hoje.getMonth();
    const ano  = hoje.getFullYear();

    let totalEntradas = 0, totalSaidas = 0, totalAPagar = 0;
    const porCategoria = {};

    for (const row of rows.slice(1)) {
      if (!row[0]) continue;
      const partes = row[0].toString().split('/');
      if (partes.length < 3) continue;
      const data = new Date(partes[2], partes[1] - 1, partes[0]);
      if (data.getMonth() !== mes || data.getFullYear() !== ano) continue;

      const valor = parseFloat(row[2]) || 0;
      const tipo  = row[5] || 'Saída';
      const cat   = row[3] || 'Outros';

      if (tipo === 'Entrada')      totalEntradas += valor;
      else if (tipo === 'A Pagar') totalAPagar   += valor;
      else { totalSaidas += valor; porCategoria[cat] = (porCategoria[cat] || 0) + valor; }
    }

    const nomeMes = hoje.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' });
    let msg = `📊 *Resumo de ${nomeMes}*\n\n`;
    msg += `💰 Entradas: R$ ${totalEntradas.toFixed(2)}\n`;
    msg += `💸 Saídas: R$ ${totalSaidas.toFixed(2)}\n`;
    if (totalAPagar > 0) msg += `📋 A Pagar: R$ ${totalAPagar.toFixed(2)}\n`;
    msg += `📈 *Saldo: R$ ${(totalEntradas - totalSaidas).toFixed(2)}*\n`;

    if (Object.keys(porCategoria).length > 0) {
      msg += `\n*Por categoria:*\n`;
      Object.entries(porCategoria).sort((a, b) => b[1] - a[1]).forEach(([cat, val]) => {
        msg += `🏷️ ${cat}: R$ ${val.toFixed(2)}\n`;
      });
    }
    await sendMessage(chatId, msg);
  } catch (err) {
    await sendMessage(chatId, '❌ Erro ao buscar resumo.');
  }
}

// ============================================================
//  HANDLER — categorias e ajuda
// ============================================================
async function handleCategorias(chatId) {
  let msg = `🏷️ *Categorias disponíveis*\n\n`;
  msg += `*💸 Saídas:*\n${CATEGORIAS_SAIDA.map(c => `• ${c}`).join('\n')}\n\n`;
  msg += `*💰 Entradas:*\n${CATEGORIAS_ENTRADA.map(c => `• ${c}`).join('\n')}`;
  await sendMessage(chatId, msg);
}

async function handleAjuda(chatId) {
  await sendMessage(chatId,
    `👋 *Financeiro Casa - Comandos*\n\n` +
    `💸 *Saída:* gasto 45,90 mercado Alimentação\n` +
    `💰 *Entrada:* entrada 5000 salario\n` +
    `📋 *A pagar:* apagar 150,00 conta-luz 15/06\n` +
    `✏️ *Editar:* editar 5 65,00 mercado Alimentação\n` +
    `🗑️ *Excluir:* excluir 5\n` +
    `📋 *Últimos:* ultimos\n` +
    `📊 *Resumo:* resumo\n` +
    `🏷️ *Categorias:* categorias\n\n` +
    `_Funciona com ou sem / e maiúsculo ou minúsculo_`
  );
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

function parsearDataVencimento(str) {
  if (!str) return null;
  const partes = str.split('/');
  if (partes.length < 2) return null;
  const data = new Date(new Date().getFullYear(), parseInt(partes[1]) - 1, parseInt(partes[0]));
  return isNaN(data.getTime()) ? null : data;
}

async function verificarDuplicata(valor, descricao) {
  try {
    const rows  = await getSheetRows();
    const agora = new Date();
    const limite = new Date(agora.getTime() - 7 * 24 * 60 * 60 * 1000); // 7 dias atrás

    for (let i = rows.length - 1; i >= 1; i--) {
      const row = rows[i];
      if (!row[0]) continue;

      const partes = row[0].toString().split('/');
      if (partes.length < 3) continue;
      const dataRow = new Date(partes[2], partes[1] - 1, partes[0]);
      if (dataRow < limite) break;

      const valorRow = parseFloat(row[2]);
      const descRow  = (row[1] || '').toLowerCase();
      const descBusca = descricao.toLowerCase();

      if (valorRow === valor && (descRow.includes(descBusca) || descBusca.includes(descRow))) {
        return { linha: i + 1, descricao: row[1], valor: row[2], data: row[0] };
      }
    }
    return null;
  } catch (err) {
    return null;
  }
}

// ============================================================
//  GOOGLE SHEETS
// ============================================================
async function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: GOOGLE_CREDENTIALS,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

async function appendToSheet(data, descricao, valor, categoria, quemPagou, tipo, origem, registradoEm) {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: 'Página1!A:H',
    valueInputOption: 'USER_ENTERED',
    resource: { values: [[data, descricao, valor, categoria, quemPagou, tipo, origem, registradoEm]] },
  });
  // Retorna o número da linha inserida
  const range = res.data.updates.updatedRange;
  const match = range.match(/(\d+)$/);
  return match ? parseInt(match[1]) : '?';
}

async function editarLinha(linha, data, descricao, valor, categoria, quemPagou, tipo, origem, registradoEm) {
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `Página1!A${linha}:H${linha}`,
    valueInputOption: 'USER_ENTERED',
    resource: { values: [[data, descricao, valor, categoria, quemPagou, tipo, origem, registradoEm]] },
  });
}

async function excluirLinha(linha) {
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    resource: {
      requests: [{
        deleteDimension: {
          range: {
            sheetId: 0,
            dimension: 'ROWS',
            startIndex: linha - 1,
            endIndex: linha,
          }
        }
      }]
    }
  });
}

async function getSheetRows() {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'Página1!A:H',
  });
  return res.data.values || [];
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

async function getFileUrl(fileId) {
  const res  = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getFile?file_id=${fileId}`);
  const data = await res.json();
  if (!data.ok) return null;
  return `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${data.result.file_path}`;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bot rodando na porta ${PORT}`));
