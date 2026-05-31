const express = require('express');
const fetch = require('node-fetch');
const { google } = require('googleapis');

const app = express();
app.use(express.json());

// ============================================================
//  CONFIGURAÇÕES
// ============================================================
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const SHEET_ID       = process.env.SHEET_ID;
const ANTHROPIC_KEY  = process.env.ANTHROPIC_KEY || '';

// Google Sheets auth via Service Account
const GOOGLE_CREDENTIALS = process.env.GOOGLE_CREDENTIALS
  ? JSON.parse(process.env.GOOGLE_CREDENTIALS)
  : null;

// ============================================================
//  WEBHOOK
// ============================================================
app.post('/webhook', async (req, res) => {
  res.sendStatus(200); // responde imediatamente ao Telegram
  try {
    const update = req.body;
    await handleUpdate(update);
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

  const chatId   = message.chat.id;
  const username = (message.from.username || message.from.first_name || 'desconhecido').toLowerCase();
  const text     = message.text || '';

  // Foto (comprovante)
  if (message.photo && message.photo.length > 0) {
    await handlePhoto(chatId, message.photo, message.caption || '', username);
    return;
  }

  // Comandos de texto
  if (text.startsWith('/gasto'))        { await handleGastoTexto(chatId, text, username); return; }
  if (text.startsWith('/resumo'))       { await handleResumo(chatId); return; }
  if (text.startsWith('/ajuda') || text === '/start') { await handleAjuda(chatId); return; }
}

// ============================================================
//  GASTO POR TEXTO — /gasto 45,90 mercado alimentação
// ============================================================
async function handleGastoTexto(chatId, text, username) {
  const partes = text.replace('/gasto', '').trim().split(' ');

  if (partes.length < 2) {
    await sendMessage(chatId, '⚠️ Formato incorreto.\nUse: /gasto 45,90 descrição categoria\nExemplo: /gasto 45,90 mercado alimentação');
    return;
  }

  const valor     = parseFloat(partes[0].replace(',', '.'));
  const descricao = partes[1] || 'Sem descrição';
  const categoria = partes[2] || 'Outros';
  const data      = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });

  if (isNaN(valor)) {
    await sendMessage(chatId, '⚠️ Valor inválido. Ex: 45,90 ou 45.90');
    return;
  }

  await appendToSheet(data, descricao, valor, categoria, username, 'texto');
  await sendMessage(chatId,
    `✅ *Gasto registrado!*\n📅 Data: ${data}\n📝 Descrição: ${descricao}\n💰 Valor: R$ ${valor.toFixed(2)}\n🏷️ Categoria: ${categoria}\n👤 Por: ${username}`
  );
}

// ============================================================
//  GASTO POR FOTO
// ============================================================
async function handlePhoto(chatId, photos, caption, username) {
  await sendMessage(chatId, '🔍 Analisando comprovante...');

  const fileId  = photos[photos.length - 1].file_id;
  const fileUrl = await getFileUrl(fileId);
  if (!fileUrl) { await sendMessage(chatId, '❌ Não consegui baixar a imagem.'); return; }

  if (!ANTHROPIC_KEY) {
    await handleSemIA(chatId, caption, username);
    return;
  }

  // Baixa imagem como base64
  const imgRes  = await fetch(fileUrl);
  const buffer  = await imgRes.buffer();
  const base64  = buffer.toString('base64');
  const mime    = imgRes.headers.get('content-type') || 'image/jpeg';

  const hoje = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const prompt = `Analise este comprovante fiscal ou recibo e extraia as informações no formato JSON abaixo.
Retorne APENAS o JSON, sem explicações ou markdown.
{
  "data": "dd/MM/yyyy",
  "descricao": "nome do estabelecimento ou descrição",
  "valor": 0.00,
  "categoria": "uma das opções: Alimentação, Transporte, Saúde, Educação, Lazer, Casa, Vestuário, Outros"
}
Se não identificar algum campo use: data="${hoje}", descricao="Comprovante", valor=0, categoria="Outros".`;

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: mime, data: base64 } },
          { type: 'text', text: prompt }
        ]}]
      })
    });
    const result = await resp.json();
    const dados  = JSON.parse(result.content[0].text.trim());
    if (caption) dados.descricao = caption;

    await appendToSheet(dados.data, dados.descricao, dados.valor, dados.categoria, username, 'comprovante');
    await sendMessage(chatId,
      `✅ *Comprovante registrado!*\n📅 Data: ${dados.data}\n📝 Descrição: ${dados.descricao}\n💰 Valor: R$ ${parseFloat(dados.valor).toFixed(2)}\n🏷️ Categoria: ${dados.categoria}\n👤 Por: ${username}`
    );
  } catch (err) {
    console.error('Erro IA:', err);
    await handleSemIA(chatId, caption, username);
  }
}

async function handleSemIA(chatId, caption, username) {
  if (caption) {
    await handleGastoTexto(chatId, '/gasto ' + caption, username);
  } else {
    await sendMessage(chatId, '📸 Foto recebida!\nMande uma legenda com: valor descrição categoria\nEx: _45,90 mercado alimentação_\n\nOu use:\n/gasto 45,90 mercado alimentação');
  }
}

// ============================================================
//  RESUMO DO MÊS
// ============================================================
async function handleResumo(chatId) {
  try {
    const rows = await getSheetRows();
    const hoje = new Date();
    const mes  = hoje.getMonth();
    const ano  = hoje.getFullYear();

    let total = 0;
    const porCategoria = {};

    for (const row of rows.slice(1)) {
      if (!row[0]) continue;
      const partes = row[0].split('/');
      const data   = new Date(partes[2], partes[1] - 1, partes[0]);
      if (data.getMonth() !== mes || data.getFullYear() !== ano) continue;

      const valor     = parseFloat(row[2]) || 0;
      const categoria = row[3] || 'Outros';
      total += valor;
      porCategoria[categoria] = (porCategoria[categoria] || 0) + valor;
    }

    const nomeMes = hoje.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' });
    let msg = `📊 *Resumo de ${nomeMes}*\n\n`;

    if (Object.keys(porCategoria).length === 0) {
      msg += 'Nenhum gasto registrado este mês.';
    } else {
      Object.entries(porCategoria).sort((a, b) => b[1] - a[1]).forEach(([cat, val]) => {
        msg += `🏷️ ${cat}: R$ ${val.toFixed(2)}\n`;
      });
      msg += `\n💰 *Total: R$ ${total.toFixed(2)}*`;
    }
    await sendMessage(chatId, msg);
  } catch (err) {
    console.error('Erro resumo:', err);
    await sendMessage(chatId, '❌ Erro ao buscar resumo. Tente novamente.');
  }
}

// ============================================================
//  AJUDA
// ============================================================
async function handleAjuda(chatId) {
  await sendMessage(chatId,
    `👋 *Financeiro Casa - Comandos*\n\n` +
    `📝 *Registrar gasto por texto:*\n/gasto valor descrição categoria\nEx: /gasto 45,90 mercado alimentação\n\n` +
    `📸 *Registrar por comprovante:*\nEnvie a foto com legenda: 45,90 mercado alimentação\n\n` +
    `📊 *Ver resumo do mês:*\n/resumo\n\n` +
    `❓ *Ajuda:*\n/ajuda`
  );
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

async function appendToSheet(data, descricao, valor, categoria, quemPagou, origem) {
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: 'Página1!A:F',
    valueInputOption: 'USER_ENTERED',
    resource: { values: [[data, descricao, valor, categoria, quemPagou, origem]] },
  });
}

async function getSheetRows() {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'Página1!A:F',
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

// ============================================================
//  START
// ============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bot rodando na porta ${PORT}`));
