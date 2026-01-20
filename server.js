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

        // --- 1. ETAPA: ALERTA DE POSSÍVEL ENTRADA (Aos 00 segundos) ---
        if (segs === 0) {
            m.fechamentoAnterior = preco;
            m.aberturaVela = preco;
            
            if (m.forca >= 70) m.sinalPendente = "CALL"; 
            else if (m.forca <= 30) m.sinalPendente = "PUT"; 
            else m.sinalPendente = null;

            if (m.sinalPendente && !m.operacaoAtiva) {
                m.buscandoTaxa = true;
                let hAlerta = agora.toLocaleTimeString();
                let hPrevFim = new Date(agora.getTime() + 60000).toLocaleTimeString();
                m.status = `ALERTA: ${m.sinalPendente}`;
                
                enviarTelegram(`🔍 *ALERTA: POSSÍVEL ENTRADA*\n📊 Ativo: ${m.nome}\n⚡ Direção: ${m.sinalPendente === "CALL" ? "COMPRA 🟢" : "VENDA 🔴"}\n⏰ Início: ${hAlerta}\n🏁 Término: ${hPrevFim}`, false);
            }
        }

        // --- 2. ETAPA: ENTRADA CONFIRMADA (Busca de Taxa) ---
        if (m.buscandoTaxa && !m.operacaoAtiva) {
            let diffVela = Math.abs(m.fechamentoAnterior - m.aberturaVela) || 0.0001;
            let alvo = diffVela * 0.30;
            let confirmou = (m.sinalPendente === "CALL" && preco <= (m.aberturaVela - alvo)) || 
                            (m.sinalPendente === "PUT" && preco >= (m.aberturaVela + alvo));
            
            if (confirmou) {
                m.operacaoAtiva = m.sinalPendente;
                m.precoEntrada = preco;
                m.tempoOp = 60;
                m.buscandoTaxa = false;
                m.status = "ENTRADA CONFIRMADA";
                
                let hConfirm = agora.toLocaleTimeString();
                let hFimConfirm = new Date(agora.getTime() + (m.tempoOp * 1000)).toLocaleTimeString();
                
                enviarTelegram(`🚀 *ENTRADA CONFIRMADA*\n💎 Ativo: ${m.nome}\n📈 Ação: ${m.operacaoAtiva === "CALL" ? "COMPRA 🟢" : "VENDA 🔴"}\n⏰ Início: ${hConfirm}\n🏁 Término: ${hFimConfirm}`);
            }
        }

        // --- 3. ETAPA: RESULTADO E GALE ---
        if (m.tempoOp > 0) {
            m.tempoOp--;
            if (m.tempoOp === 0) {
                const win = (m.operacaoAtiva === "CALL" && preco > m.precoEntrada) || 
                            (m.operacaoAtiva === "PUT" && preco < m.precoEntrada);
                
                if (win) {
                    if (m.galeAtual === 0) statsGlobal.winDireto++; else statsGlobal.winGales++;
                    m.wins++;
                    enviarTelegram(`✅ *GREEN NO ${m.galeAtual === 0 ? 'DIRETO' : 'GALE ' + m.galeAtual}!*\n💎 Ativo: ${m.nome}\n💰 Resultado: VITÓRIA`);
                    m.operacaoAtiva = null; m.galeAtual = 0; m.status = "ANALISANDO...";
                } else if (m.galeAtual < 2) {
                    m.galeAtual++;
                    m.tempoOp = 60;
                    m.precoEntrada = preco;
                    
                    let hGaleI = agora.toLocaleTimeString();
                    let hGaleF = new Date(agora.getTime() + 60000).toLocaleTimeString();
                    
                    enviarTelegram(`🔄 *ENTRANDO NO GALE ${m.galeAtual}*\n🌍 Ativo: ${m.nome}\n📈 Direção: ${m.operacaoAtiva === "CALL" ? "COMPRA 🟢" : "VENDA 🔴"}\n⏰ Início: ${hGaleI}\n🏁 Término: ${hGaleF}`);
                } else {
                    statsGlobal.loss++;
                    m.loss++;
                    enviarTelegram(`❌ *LOSS NO G2*\n💎 Ativo: ${m.nome}\n📉 Resultado: DERROTA`);
                    m.operacaoAtiva = null; m.galeAtual = 0; m.status = "ANALISANDO...";
                }
                statsGlobal.analises++;
            }
        }
    });

    motores[cardId] = m;
}

// RELATÓRIO DE PERFORMANCE (4 MINUTOS)
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
`📊 *RELATÓRIO DE PERFORMANCE*

📈 *GERAL:*
• Análises: ${statsGlobal.analises}
• Wins Diretos: ${statsGlobal.winDireto}
• Losses Diretos: 0
• Wins c/ Gale: ${statsGlobal.winGales}
• Reds c/ Gale: ${statsGlobal.loss}

🏆 *RANKING ATIVOS:*
${rankingTexto || "Sem dados suficientes"}

🔥 *EFICIÊNCIA ROBO: ${eficienciaGeral}%*`;

    enviarTelegram(mensagemRelatorio, false);
}

setInterval(enviarRelatorioPerformance, 240000);

// ROTAS DA API
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

app.get('/', (req, res) => res.send("Servidor KCM Online 24h"));

app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
