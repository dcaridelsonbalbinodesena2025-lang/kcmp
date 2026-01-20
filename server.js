const WebSocket = require('ws');
const fetch = require('node-fetch');
const express = require('express');
const cors = require('cors'); // Importante para o site conversar com o servidor

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// CONFIGURAÇÕES
const TG_TOKEN = "8427077212:AAEiL_3_D_-fukuaR95V3FqoYYyHvdCHmEI"; 
const TG_CHAT_ID = "-1003355965894"; 

let motores = {}; 

// Rota para o Painel HTML ler os dados do servidor
app.get('/status', (req, res) => {
    const resumo = Object.keys(motores).map(id => ({
        id,
        nome: motores[id].nome,
        forca: motores[id].forca,
        preco: motores[id].ultimoPreco,
        status: motores[id].statusTexto
    }));
    res.json(resumo);
});

// Lógica de monitoramento (Simplificada para rodar 24h)
function iniciarMonitoramento(idAtivo, nomeAtivo) {
    if (motores[idAtivo]) motores[idAtivo].ws.close();
    
    let m = {
        ws: new WebSocket('wss://ws.binaryws.com/websockets/v3?app_id=1089'),
        nome: nomeAtivo,
        forca: 50,
        ultimoPreco: 0,
        statusTexto: "ANALISANDO..."
    };

    m.ws.on('open', () => m.ws.send(JSON.stringify({ ticks: idAtivo })));
    m.ws.on('message', (data) => {
        const res = JSON.parse(data);
        if (res.tick) {
            m.ultimoPreco = res.tick.quote;
            // Aqui entra toda aquela lógica de cálculo que já fizemos...
        }
    });
    motores[idAtivo] = m;
}

// Inicia com ativos padrão
iniciarMonitoramento("1HZ100V", "Volatility 100 (1s)");

app.listen(PORT, () => console.log(`Servidor KCM rodando na porta ${PORT}`));
