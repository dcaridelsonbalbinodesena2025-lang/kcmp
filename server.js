const WebSocket = require('ws');
const fetch = require('node-fetch');
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const TG_TOKEN = "8427077212:AAEiL_3_D_-fukuaR95V3FqoYYyHvdCHmEI"; 
const TG_CHAT_ID = "-1003355965894"; 

let statsGlobal = { winDireto: 0, winGales: 0, loss: 0, analises: 0 };
let motores = {}; // Armazena os 6 motores (card1, card2, etc)

function enviarTelegram(msg) {
    fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: TG_CHAT_ID, text: msg, parse_mode: "Markdown" })
    }).catch(e => console.error("Erro Telegram:", e));
}

function iniciarMotor(cardId, ativoId, nomeAtivo) {
    if (motores[cardId] && motores[cardId].ws) {
        motores[cardId].ws.close();
    }

    if (ativoId === "OFF") {
        motores[cardId] = { status: "DESATIVADO", preco: "---", forca: 50, nome: "DESATIVADO" };
        return;
    }

    let m = {
        ws: new WebSocket('wss://ws.binaryws.com/websockets/v3?app_id=1089'),
        nome: nomeAtivo,
        status: "INICIANDO...",
        preco: "0.00",
        forca: 50,
        aberturaVela: 0,
        tempoOp: 0
    };

    m.ws.on('open', () => m.ws.send(JSON.stringify({ ticks: ativoId })));
    m.ws.on('message', (data) => {
        const res = JSON.parse(data);
        if (!res.tick) return;
        const preco = res.tick.quote;
        const segs = new Date().getSeconds();
        
        m.preco = preco.toFixed(5);
        
        // Lógica de análise simplificada para o servidor
        if (segs === 0) {
            m.aberturaVela = preco;
            if (m.forca >= 70 || m.forca <= 30) {
                enviarTelegram(`🎯 *SINAL DETECTADO*\nAtivo: ${m.nome}\nForça: ${m.forca.toFixed(0)}%`);
            }
        }
        
        if (m.aberturaVela > 0) {
            let diff = preco - m.aberturaVela;
            m.forca = 50 + (diff / (m.aberturaVela * 0.0002) * 20);
            m.forca = Math.min(98, Math.max(2, m.forca));
        }
        m.status = m.forca > 60 ? "ALERTA COMPRA" : m.forca < 40 ? "ALERTA VENDA" : "ANALISANDO";
    });

    motores[cardId] = m;
}

app.get('/status', (req, res) => {
    let ativosStatus = Object.keys(motores).map(id => ({
        cardId: id,
        nome: motores[id].nome,
        preco: motores[id].preco,
        status: motores[id].status,
        forca: motores[id].forca
    }));
    res.json({ global: statsGlobal, ativos: ativosStatus });
});

app.post('/mudar', (req, res) => {
    const { cardId, ativoId, nomeAtivo } = req.body;
    iniciarMotor(cardId, ativoId, nomeAtivo);
    res.json({ success: true });
});

app.listen(PORT, () => console.log("Servidor KCM rodando."));
