const WebSocket = require('ws');
const fetch = require('node-fetch');
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// --- CONFIGURAÇÕES ---
const TG_TOKEN = "8427077212:AAEiL_3_D_-fukuaR95V3FqoYYyHvdCHmEI"; 
const TG_CHAT_ID = "-1003355965894"; 
const LINK_CORRETORA = "https://track.deriv.com/_S_W1N_"; 

let statsGlobal = { winDireto: 0, winGales: 0, loss: 0, analises: 0 };
let motores = {}; 

function enviarTelegram(msg, comBotao = true) {
    let payload = { chat_id: TG_CHAT_ID, text: msg, parse_mode: "Markdown" };
    if (comBotao) {
        payload.reply_markup = { inline_keyboard: [[{ text: "📲 ACESSAR CORRETORA", url: LINK_CORRETORA }]] };
    }
    fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    }).catch(e => console.error("Erro Telegram:", e));
}

function iniciarMotor(cardId, ativoId, nomeAtivo) {
    if (motores[cardId] && motores[cardId].ws) {
        motores[cardId].ws.close();
    }

    if (ativoId === "OFF") {
        motores[cardId] = { cardId, status: "DESATIVADO", preco: "---", forca: 50, nome: "OFF", wins: 0, loss: 0 };
        return;
    }

    let m = {
        cardId: cardId,
        ws: new WebSocket('wss://ws.binaryws.com/websockets/v3?app_id=1089'),
        nome: nomeAtivo,
        status: "ANALISANDO...",
        preco: "0.0000",
        forca: 50,
        aberturaVela: 0,
        fechamentoAnterior: 0,
        corVelaAnterior: null, // Nova lógica Raiane
        sinalPendente: null,
        buscandoTaxa: false,
        operacaoAtiva: null,
        precoEntrada: 0,
        tempoOp: 0,
        galeAtual: 0,
        wins: 0,
        loss: 0
    };

    m.ws.on('open', () => m.ws.send(JSON.stringify({ ticks: ativoId })));
    
    m.ws.on('message', (data) => {
        const res = JSON.parse(data);
        if (!res.tick) return;
        
        const preco = res.tick.quote;
        const agora = new Date();
        const segs = agora.getSeconds();
        m.preco = preco.toFixed(5);
        
        if (m.aberturaVela > 0) {
            let diff = preco - m.aberturaVela;
            m.forca = 50 + (diff / (m.aberturaVela * 0.0002) * 20);
            m.forca = Math.min(98, Math.max(2, m.forca));
        }

        // 1. ALERTA (AOS 00 SEGUNDOS - JUNÇÃO REGRA 1)
        if (segs === 0) {
            // Define a cor da vela que acabou de fechar (Lógica Raiane)
            if (m.fechamentoAnterior > 0) {
                m.corVelaAnterior = (m.fechamentoAnterior > m.aberturaVela) ? "CALL" : "PUT";
            }

            m.fechamentoAnterior = preco;
            m.aberturaVela = preco;

            // Filtro de Força 80/20
            if (m.forca >= 80) m.sinalPendente = "CALL"; 
            else if (m.forca <= 20) m.sinalPendente = "PUT"; 
            else m.sinalPendente = null;

            if (m.sinalPendente && !m.operacaoAtiva) {
                m.buscandoTaxa = true;
                let hAlerta = agora.toLocaleTimeString();
                let emoji = m.sinalPendente === "CALL" ? "COMPRA 🟢" : "VENDA 🔴";
                enviarTelegram(`🔍 *ALERTA: POSSÍVEL ENTRADA*\n📊 Ativo: ${m.nome}\n⚡ Direção: ${emoji}\n⏰ Horário: ${hAlerta}`, false);
            }
        }

        // 2. CONFIRMAÇÃO (TAXA DINÂMICA - JUNÇÃO INTELIGENTE)
        if (m.buscandoTaxa && !m.operacaoAtiva) {
            let diffVela = Math.abs(m.fechamentoAnterior - m.aberturaVela) || 0.0001;
            
            // Se a cor bate com a anterior (Fluxo Raiane), entra mais fácil (15%)
            // Se não bate, espera a retração segura (35%)
            let multiplicadorTaxa = (m.sinalPendente === m.corVelaAnterior) ? 0.15 : 0.35;
            let alvo = diffVela * multiplicadorTaxa;

            let confirmou = (m.sinalPendente === "CALL" && preco <= (m.aberturaVela - alvo)) || 
                            (m.sinalPendente === "PUT" && preco >= (m.aberturaVela + alvo));
            
            if (confirmou) {
                m.operacaoAtiva = m.sinalPendente;
                m.precoEntrada = preco;
                m.tempoOp = 60;
                m.buscandoTaxa = false;
                m.status = "ENTRADA CONFIRMADA";
                
                let hI = agora.toLocaleTimeString();
                let hF = new Date(agora.getTime() + 60000).toLocaleTimeString();
                
                enviarTelegram(`🚀 *ENTRADA CONFIRMADA*\n💎 Ativo: ${m.nome}\n📈 Ação: ${m.operacaoAtiva === "CALL" ? "COMPRA 🟢" : "VENDA 🔴"}\n⏰ Início: ${hI}\n🏁 Término: ${hF}`);
            }
        }

        // 3. RESULTADO E PLACAR
        if (m.tempoOp > 0) {
            m.tempoOp--;
            if (m.tempoOp === 0) {
                const win = (m.operacaoAtiva === "CALL" && preco > m.precoEntrada) || 
                            (m.operacaoAtiva === "PUT" && preco < m.precoEntrada);
                
                if (win) {
                    if (m.galeAtual === 0) statsGlobal.winDireto++; else statsGlobal.winGales++;
                    m.wins++;
                    let placar = `✅ *WIN CONFIRMADO*\n🌍 Ativo: ${m.nome}\n🎯 Tipo: ${m.galeAtual === 0 ? 'DIRETO' : 'GALE ' + m.galeAtual}\n\n📊 *PLACAR ACUMULADO:*\n🟢 VITORIAS: ${statsGlobal.winDireto + statsGlobal.winGales}\n🔴 DERROTAS: ${statsGlobal.loss}`;
                    enviarTelegram(placar);
                    m.operacaoAtiva = null; m.galeAtual = 0; m.status = "ANALISANDO...";
                } else if (m.galeAtual < 2) {
                    m.galeAtual++;
                    m.tempoOp = 60;
                    m.precoEntrada = preco;
                    let hI = agora.toLocaleTimeString();
                    let hF = new Date(agora.getTime() + 60000).toLocaleTimeString();
                    enviarTelegram(`🔄 *RECUPERAÇÃO (GALE ${m.galeAtual})*\nAtivo: ${m.nome}\n⏰ Início: ${hI}\n🏁 Término: ${hF}`);
                } else {
                    statsGlobal.loss++;
                    m.loss++;
                    let placarLoss = `❌ *LOSS NO G2*\n💎 Ativo: ${m.nome}\n\n📊 *PLACAR ACUMULADO:*\n🟢 VITORIAS: ${statsGlobal.winDireto + statsGlobal.winGales}\n🔴 DERROTAS: ${statsGlobal.loss}`;
                    enviarTelegram(placarLoss);
                    m.operacaoAtiva = null; m.galeAtual = 0; m.status = "ANALISANDO...";
                }
                statsGlobal.analises++;
            }
        }
    });

    motores[cardId] = m;
}

// RELATÓRIO DE PERFORMANCE (A CADA 4 MINUTOS)
function enviarRelatorioPerformance() {
    let listaRanking = Object.values(motores)
        .filter(m => m.nome !== "OFF" && m.nome !== "DESATIVADO")
        .map(m => {
            let totalAtivo = (m.wins || 0) + (m.loss || 0);
            let efiv = totalAtivo > 0 ? ((m.wins / totalAtivo) * 100).toFixed(0) : "100";
            return { nome: m.nome, ef: parseInt(efiv) };
        })
        .sort((a, b) => b.ef - a.ef)
        .slice(0, 4);

    let rankingTexto = "";
    listaRanking.forEach((item, index) => {
        rankingTexto += `${index + 1}º ${item.nome}: ${item.ef}%\n`;
    });

    let eficienciaGeral = statsGlobal.analises > 0 
        ? (((statsGlobal.winDireto + statsGlobal.winGales) / statsGlobal.analises) * 100).toFixed(1) 
        : "100.0";

    const mensagemRelatorio = 
`📊 *RELATÓRIO DE PERFORMANCE (REGRA 1)*

📈 *DADOS GERAIS:*
• Análises: ${statsGlobal.analises}
• Wins Diretos: ${statsGlobal.winDireto}
• Wins Recu./Gale: ${statsGlobal.winGales}
• Reds (Loss G2): ${statsGlobal.loss}

🏆 *RANKING DOS ATIVOS:*
${rankingTexto || "Sem dados suficientes"}

🔥 *EFICIÊNCIA ATUAL: ${eficienciaGeral}%*`;

    enviarTelegram(mensagemRelatorio, false);
}

setInterval(enviarRelatorioPerformance, 240000);

// API E ROTAS
app.get('/status', (req, res) => {
    let ativosStatus = Object.keys(motores).map(id => ({
        cardId: id,
        nome: motores[id].nome,
        preco: motores[id].preco,
        status: motores[id].status,
        forca: motores[id].forca
    }));
    let precisao = statsGlobal.analises > 0 ? ((statsGlobal.winDireto + statsGlobal.winGales) / statsGlobal.analises * 100).toFixed(1) : 0;
    res.json({ global: {...statsGlobal, precisao}, ativos: ativosStatus });
});

app.post('/mudar', (req, res) => {
    const { cardId, ativoId, nomeAtivo } = req.body;
    iniciarMotor(cardId, ativoId, nomeAtivo);
    res.json({ success: true });
});

app.get('/', (req, res) => res.send("Servidor KCM Online - Regra 1 Junção Ativa"));

app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
