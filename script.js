// ==========================================================
// CONFIGURAÇÃO — troque pela URL do seu Apps Script (/exec)
// ==========================================================
const SHEETS_ENDPOINT = "https://script.google.com/macros/s/SEU_ID_AQUI/exec";

// ==========================================================
// TOKEN DE SEGURANÇA — precisa ser IDÊNTICO ao TOKEN_SECRETO
// definido no Apps Script (Código.gs) e ao API_TOKEN do admin.html.
// Sem isso, qualquer pessoa com a URL do /exec poderia mandar
// requisições falsas e sujar seus dados de inventário.
// ==========================================================
const API_TOKEN = "TROQUE_ESTE_TOKEN";

const canvas = document.getElementById("wheelCanvas");
const ctx = canvas.getContext("2d");

// Paleta alternada: azul da marca, azul claro e mostarda se intercalam
// para dar ritmo visual. A Airfryer usa vermelho vivo + brilho porque é
// o prêmio máximo e precisa puxar o olho na hora.
// `textColor` existe porque texto branco some sobre a mostarda.
//
// ESTOQUE E PESO: o `weight` de cada item é igual ao seu `estoque`. Isso
// faz a probabilidade ser proporcional ao que existe de verdade, então
// todos os prêmios tendem a acabar por volta do mesmo giro (~446) em vez
// de um sumir na primeira meia hora e outro sobrar no fim. Quando um item
// esgota, o peso dele é transferido pro item de reposição (ITEM_REPOSICAO).
//
// `voucher: true` = prêmio resgatado depois, fora do estande: gera um
// código único que a pessoa fotografa e que fica gravado na planilha.
// ESTOQUE COMPLETO — 10 prêmios, 320 unidades.
// Versão para um evento novo, com tudo disponível.
//
// O `weight` de cada item é igual ao `estoque`, então a probabilidade
// é proporcional ao que existe de verdade e todos os prêmios tendem a
// acabar por volta do mesmo giro (~320). Quando um item esgota, o peso
// dele é transferido pro item de reposição (ITEM_REPOSICAO).
//
// `textColor` existe porque texto branco some sobre a mostarda.
// A Airfryer usa vermelho + brilho por ser o prêmio máximo.
const items = [
    { id: 'sonho_valsa', text: "Sonho de Valsa",  estoque: 200, color1: "#0072bb", color2: "#005e9c", textColor: "#FFFFFF" },
    { id: 'cabo',        text: "Cabo Carregador", estoque: 10,  color1: "#E8A020", color2: "#c9860f", textColor: "#1a1206" },
    { id: 'caneta',      text: "Caneta",          estoque: 49,  color1: "#2f9ade", color2: "#1c81c2", textColor: "#FFFFFF" },
    { id: 'fone',        text: "Fone de Ouvido",  estoque: 10,  color1: "#E8A020", color2: "#c9860f", textColor: "#1a1206" },
    { id: 'airfryer',    text: "Airfryer",        estoque: 1,   color1: "#f03e3e", color2: "#c81e1e", textColor: "#FFFFFF", destaque: true },
    { id: 'caneca',      text: "Caneca",          estoque: 10,  color1: "#2f9ade", color2: "#1c81c2", textColor: "#FFFFFF" },
    { id: 'calendario',  text: "Calendário",      estoque: 20,  color1: "#E8A020", color2: "#c9860f", textColor: "#1a1206" },
    { id: 'mochila',     text: "Mochila",         estoque: 10,  color1: "#0072bb", color2: "#005e9c", textColor: "#FFFFFF" },
    { id: 'caneca_cafe', text: "Caneca de Café",  estoque: 5,   color1: "#E8A020", color2: "#c9860f", textColor: "#1a1206" },
    { id: 'garrafa',     text: "Garrafa Squeeze", estoque: 5,   color1: "#2f9ade", color2: "#1c81c2", textColor: "#FFFFFF" }
];

// Quando um prêmio esgota, o peso dele vai pro item de maior estoque
const ITEM_REPOSICAO = 'sonho_valsa';

// ==========================================================
// VERSÃO DO ESTOQUE — aumente este número TODA VEZ que mexer na
// lista `items` acima. Se o número mudar, o estado salvo no tablet
// é descartado e os valores novos passam a valer.
//
// Sem isso, editar a lista não teria efeito nenhum: o localStorage
// restaura os pesos antigos assim que a página carrega.
// ==========================================================
const VERSAO_ESTOQUE = 10;

// Giros já registrados na planilha ANTES desta configuração de estoque.
// Em evento novo (planilha limpa) deixe vazio. Se você reaproveitar uma
// planilha que já tem histórico, preencha aqui quanto de cada prêmio já
// saiu — senão a sincronização acha que o estoque estourou e esgota tudo.
const GIROS_JA_CONTABILIZADOS = {};

// Inicializa peso e contador de cada prêmio.
// Itens ilimitados usam `peso` fixo; os demais usam o estoque.
items.forEach(item => {
    item.weight = item.ilimitado ? item.peso : item.estoque;
    item.saidas = 0;
    item.esgotado = false;
    item.jaSaiu = GIROS_JA_CONTABILIZADOS[item.id] || 0;
});

let cliquesLogo = 0;
let timerCliques = null;
let airfryerForcada = false;

// ==========================================================
// PERSISTÊNCIA DE ESTADO DA ROLETA (esgotados, contador, easter egg)
// Garante que, se o navegador/tablet for reiniciado no meio do
// evento, os prêmios já esgotados continuem esgotados.
// ==========================================================
const STORAGE_KEY_ESTADO = 'estado_roleta_cf';

function salvarEstadoRoleta() {
    const estado = {
        versao: VERSAO_ESTOQUE,
        premios: items.map(i => ({ id: i.id, weight: i.weight, saidas: i.saidas, esgotado: !!i.esgotado })),
        airfryerForcada
    };
    localStorage.setItem(STORAGE_KEY_ESTADO, JSON.stringify(estado));
}

function carregarEstadoRoleta() {
    try {
        const salvo = JSON.parse(localStorage.getItem(STORAGE_KEY_ESTADO) || 'null');
        if (!salvo || !salvo.premios) return;

        // Estado antigo (de antes da atualização de estoque): descarta,
        // senão os pesos velhos sobrescreveriam os novos.
        if (salvo.versao !== VERSAO_ESTOQUE) {
            localStorage.removeItem(STORAGE_KEY_ESTADO);
            console.log('%c↻ Estoque atualizado — estado antigo descartado.', 'color:#0072bb;font-weight:bold');
            return;
        }

        salvo.premios.forEach(p => {
            const item = items.find(i => i.id === p.id);
            if (item) {
                item.weight = p.weight;
                item.saidas = p.saidas || 0;
                item.esgotado = !!p.esgotado;
            }
        });

        airfryerForcada = !!salvo.airfryerForcada;
        if (airfryerForcada) {
            logoTrigger.style.borderColor = "#f59e0b";
        }
    } catch (e) {
        console.warn('Não foi possível restaurar o estado da roleta:', e);
    }
}

// Marca um prêmio como esgotado: zera o peso dele e transfere para o
// item de reposição, mantendo a soma dos pesos estável. Genérico (serve
// pra qualquer prêmio) e idempotente — chamar de novo não faz nada.
function aplicarEsgotamento(id) {
    const item = items.find(i => i.id === id);
    if (!item || item.esgotado) return false;

    // Só transfere se a reposição ainda tiver estoque. Sem essa checagem,
    // um prêmio esgotado depois "ressuscitava" o item de reposição já
    // esgotado, que voltava a ser sorteado além do estoque real.
    const reposicao = items.find(i => i.id === ITEM_REPOSICAO);
    if (reposicao && reposicao.id !== item.id && !reposicao.esgotado) {
        reposicao.weight += item.weight;
    }
    item.weight = 0;
    item.esgotado = true;
    return true;
}

// Registra a saída de um prêmio e esgota automaticamente ao atingir o estoque
function registrarSaida(id) {
    const item = items.find(i => i.id === id);
    if (!item) return;

    // Itens ilimitados (sem entrega física) nunca esgotam
    if (item.ilimitado) return;

    item.saidas++;
    if (item.saidas >= item.estoque) {
        aplicarEsgotamento(id);
    }
    salvarEstadoRoleta();
}

// ==========================================================
// AJUSTE DE ESTOQUE AO VIVO (usar pelo console: F12 -> Console)
//
// O peso de cada prêmio É o estoque dele, então "mudar as odds"
// = informar quantas unidades ainda existem de verdade.
//
// Importante: editar a lista `items` no arquivo NÃO adianta com o
// evento em andamento, porque o estado salvo no navegador sobrescreve
// os valores do arquivo ao carregar a página. Use estas funções.
//
//   verEstoque()                    -> mostra a situação atual
//   ajustarEstoque('caneca', 3)     -> restam 3 canecas
//   ajustarEstoque('mochila', 0)    -> mochila acabou (sai da roleta)
//   resetarRoleta()                 -> volta tudo aos valores do arquivo
// ==========================================================
function verEstoque() {
    const total = items.reduce((s, i) => s + i.weight, 0);
    console.table(items.map(i => ({
        id: i.id,
        Prêmio: i.text,
        'Estoque inicial': i.estoque,
        'Já saiu': i.saidas,
        'Restam': Math.max(i.estoque - i.saidas, 0),
        'Chance agora': total > 0 ? (i.weight / total * 100).toFixed(2) + '%' : '—',
        Esgotado: i.esgotado ? 'SIM' : '-'
    })));
    return `Total de ${items.reduce((s, i) => s + Math.max(i.estoque - i.saidas, 0), 0)} unidades restantes.`;
}

// Informa quantas unidades AINDA EXISTEM de um prêmio.
// A chance dele passa a ser proporcional a esse número.
function ajustarEstoque(id, unidadesRestantes) {
    const item = items.find(i => i.id === id);
    if (!item) {
        console.error(`Prêmio "${id}" não existe. IDs válidos:`, items.map(i => i.id).join(', '));
        return;
    }

    const restante = Math.max(0, Number(unidadesRestantes) || 0);

    // Reancora o item: o que ainda existe passa a ser o estoque, o
    // contador zera, e o marco zero passa a ser o total já registrado
    // na planilha — senão a próxima sincronização desfaria o ajuste.
    item.jaSaiu = (item.jaSaiu || 0) + item.saidas;
    item.estoque = restante;
    item.saidas = 0;
    item.weight = restante;
    item.esgotado = restante === 0;

    salvarEstadoRoleta();
    drawWheel(currentAngle);
    atualizarDisponibilidade();

    const total = items.reduce((s, i) => s + i.weight, 0);
    console.log(
        `%c✓ ${item.text}: ${restante} unidade(s) restante(s)` +
        (restante === 0 ? ' — saiu da roleta.' : ` — chance agora: ${(restante / total * 100).toFixed(2)}%`),
        'color:#15803d;font-weight:bold'
    );
    return verEstoque();
}

// Volta tudo aos valores originais do arquivo (apaga o estado salvo)
function resetarRoleta() {
    localStorage.removeItem('estado_roleta_cf');
    console.log('%c↺ Estado apagado. Recarregue a página (F5) para aplicar.', 'color:#0072bb;font-weight:bold');
}

// ==========================================================
// SINCRONIZAÇÃO COM O GOOGLE SHEETS (camada extra de segurança)
// A planilha é a fonte da verdade: se o tablet trocar de navegador,
// limpar dados ou for substituído no meio do evento, o contador de
// cada prêmio é recuperado daqui. Usa `porPremio`, que o doGet já
// devolve com a contagem de todos os itens.
// ==========================================================
function sincronizarEstadoComSheets() {
    if (!SHEETS_ENDPOINT || SHEETS_ENDPOINT.includes('SEU_ID_AQUI')) return;

    fetch(SHEETS_ENDPOINT + '?t=' + Date.now() + '&token=' + encodeURIComponent(API_TOKEN))
        .then(response => response.json())
        .then(data => {
            const porPremio = data.porPremio || {};
            let mudou = false;

            items.forEach(item => {
                if (item.ilimitado) return; // nunca esgota

                // A planilha guarda o histórico INTEIRO do evento. Como o
                // estoque foi reancorado no que ainda existe, descontamos
                // os giros que já estavam contabilizados antes do reajuste.
                const naPlanilha = (porPremio[item.id] || 0) - (item.jaSaiu || 0);

                // só sobe, nunca desce: evita que uma leitura parcial da
                // planilha "devolva" prêmios que já saíram no tablet
                if (naPlanilha > item.saidas) {
                    item.saidas = naPlanilha;
                    mudou = true;
                }
                if (item.saidas >= item.estoque && !item.esgotado) {
                    aplicarEsgotamento(item.id);
                    mudou = true;
                }
            });

            if (mudou) {
                salvarEstadoRoleta();
                drawWheel(currentAngle);
                if (!isSpinning) atualizarDisponibilidade();
                console.log('Estado sincronizado com a planilha.');
            }
        })
        .catch(error => {
            console.warn('Não foi possível sincronizar estado com a planilha:', error);
        });
}

const logoTrigger = document.getElementById('logo-trigger');

function acionarLogo() {
    const airfryer = items.find(i => i.id === 'airfryer');
    // se já foi forçada ou já saiu, não faz nada
    if (airfryerForcada || !airfryer || airfryer.esgotado) return;

    cliquesLogo++;

    if (cliquesLogo === 1) {
        timerCliques = setTimeout(() => {
            cliquesLogo = 0;
        }, 2000);
    }

    if (cliquesLogo >= 5) {
        clearTimeout(timerCliques);
        airfryerForcada = true;

        // Com peso 1 em ~446, a Airfryer tem ~37% de chance de NÃO sair
        // durante o evento inteiro. Este gatilho oculto turbina a chance
        // dela pra ~20%, permitindo "provocar" a saída num momento
        // escolhido (encerramento, cliente importante, etc).
        const somaOutros = items
            .filter(i => i.id !== 'airfryer' && !i.esgotado)
            .reduce((s, i) => s + i.weight, 0);
        const novoPeso = somaOutros * 0.25;

        // desconta do item de reposição pra soma total não inflar
        const reposicao = items.find(i => i.id === ITEM_REPOSICAO);
        const acrescimo = novoPeso - airfryer.weight;
        if (reposicao && reposicao.weight > acrescimo) {
            reposicao.weight -= acrescimo;
        }
        airfryer.weight = novoPeso;

        logoTrigger.style.borderColor = "#f59e0b";
        console.log("EASTER EGG ATIVADO — chance da Airfryer turbinada.");
        salvarEstadoRoleta();
        drawWheel(currentAngle);
    }
}

logoTrigger.addEventListener('click', acionarLogo);
// Suporte a teclado, já que o elemento agora é focável (tabindex)
logoTrigger.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        acionarLogo();
    }
});

let currentAngle = 0;
const totalSlices = items.length;
const sliceAngle = (2 * Math.PI) / totalSlices;
let isSpinning = false;

// ==========================================================
// ÍCONES DOS PRÊMIOS — desenhados como vetor no próprio canvas.
// Nada de arquivos externos: menos requisições, funciona offline e
// escala sem perder nitidez. Cada função desenha centrada em (0,0)
// dentro de uma caixa de tamanho `s`, usando a cor já definida em
// ctx.fillStyle / ctx.strokeStyle.
// ==========================================================
const ICONES = {
    // Todos os ícones são de LINHA (stroke), não silhueta cheia: em fatias
    // claras (âmbar) uma silhueta preta vira um borrão. Contorno funciona
    // bem em qualquer cor de fundo e mantém o desenho legível pequeno.
    _prep(ctx, s) {
        ctx.strokeStyle = ctx.fillStyle;
        ctx.lineWidth = Math.max(1.6, s * 0.085);
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
    },

    _roundRect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    },

    // Bombom embrulhado (Sonho de Valsa)
    sonho_valsa(ctx, s) {
        ICONES._prep(ctx, s);
        ctx.beginPath();
        ctx.arc(0, 0, s * 0.26, 0, Math.PI * 2);
        ctx.stroke();
        [-1, 1].forEach(lado => {
            ctx.beginPath();
            ctx.moveTo(lado * s * 0.24, -s * 0.1);
            ctx.lineTo(lado * s * 0.48, -s * 0.22);
            ctx.lineTo(lado * s * 0.48, s * 0.22);
            ctx.lineTo(lado * s * 0.24, s * 0.1);
            ctx.stroke();
        });
    },

    // Cabo carregador (plugue USB + fio)
    cabo(ctx, s) {
        ICONES._prep(ctx, s);
        // conector
        ICONES._roundRect(ctx, -s * 0.16, -s * 0.42, s * 0.32, s * 0.26, s * 0.05);
        ctx.stroke();
        // pinos
        [-1, 1].forEach(l => {
            ctx.beginPath();
            ctx.moveTo(l * s * 0.07, -s * 0.42);
            ctx.lineTo(l * s * 0.07, -s * 0.5);
            ctx.stroke();
        });
        // fio ondulado
        ctx.beginPath();
        ctx.moveTo(0, -s * 0.16);
        ctx.bezierCurveTo(s * 0.3, s * 0.02, -s * 0.3, s * 0.22, s * 0.1, s * 0.46);
        ctx.stroke();
    },

    // Caneta
    caneta(ctx, s) {
        ICONES._prep(ctx, s);
        ctx.save();
        ctx.rotate(-Math.PI / 6);
        ctx.beginPath();
        ctx.moveTo(-s * 0.09, -s * 0.38);
        ctx.lineTo(s * 0.09, -s * 0.38);
        ctx.lineTo(s * 0.09, s * 0.18);
        ctx.lineTo(0, s * 0.4);
        ctx.lineTo(-s * 0.09, s * 0.18);
        ctx.closePath();
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-s * 0.09, s * 0.18);
        ctx.lineTo(s * 0.09, s * 0.18);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-s * 0.09, -s * 0.28);
        ctx.lineTo(s * 0.09, -s * 0.28);
        ctx.stroke();
        ctx.restore();
    },

    // Fone de ouvido (headphone)
    fone(ctx, s) {
        ICONES._prep(ctx, s);
        // arco
        ctx.beginPath();
        ctx.arc(0, s * 0.02, s * 0.34, Math.PI, 0);
        ctx.stroke();
        // conchas
        [-1, 1].forEach(l => {
            ICONES._roundRect(ctx, l * s * 0.34 - s * 0.09, s * 0.0, s * 0.18, s * 0.3, s * 0.07);
            ctx.stroke();
        });
    },

    // Airfryer (fritadeira elétrica)
    airfryer(ctx, s) {
        ICONES._prep(ctx, s);
        ICONES._roundRect(ctx, -s * 0.32, -s * 0.3, s * 0.64, s * 0.68, s * 0.12);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-s * 0.32, s * 0.02);
        ctx.lineTo(s * 0.32, s * 0.02);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(s * 0.14, -s * 0.14, s * 0.07, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-s * 0.12, s * 0.22);
        ctx.lineTo(s * 0.12, s * 0.22);
        ctx.stroke();
    },

    // Copo térmico (tumbler com tampa)
    // Xícara de café com pires (diferencia da caneca comum)
    caneca_cafe(ctx, s) {
        ICONES._prep(ctx, s);
        // xícara
        ctx.beginPath();
        ctx.moveTo(-s * 0.24, -s * 0.16);
        ctx.lineTo(s * 0.18, -s * 0.16);
        ctx.lineTo(s * 0.13, s * 0.16);
        ctx.lineTo(-s * 0.19, s * 0.16);
        ctx.closePath();
        ctx.stroke();
        // alça
        ctx.beginPath();
        ctx.arc(s * 0.2, -s * 0.02, s * 0.11, -Math.PI / 2, Math.PI / 2);
        ctx.stroke();
        // pires
        ctx.beginPath();
        ctx.moveTo(-s * 0.34, s * 0.26);
        ctx.lineTo(s * 0.3, s * 0.26);
        ctx.stroke();
        // vapor
        [-1, 1].forEach(l => {
            ctx.beginPath();
            ctx.moveTo(l * s * 0.1, -s * 0.26);
            ctx.lineTo(l * s * 0.1, -s * 0.4);
            ctx.stroke();
        });
    },

    // "Não foi dessa vez" — carinha neutra
    nada(ctx, s) {
        ICONES._prep(ctx, s);
        ctx.beginPath();
        ctx.arc(0, 0, s * 0.34, 0, Math.PI * 2);
        ctx.stroke();
        // olhos
        [-1, 1].forEach(l => {
            ctx.beginPath();
            ctx.arc(l * s * 0.13, -s * 0.08, s * 0.045, 0, Math.PI * 2);
            ctx.stroke();
        });
        // boca reta
        ctx.beginPath();
        ctx.moveTo(-s * 0.14, s * 0.15);
        ctx.lineTo(s * 0.14, s * 0.15);
        ctx.stroke();
    },

    // Calendário
    calendario(ctx, s) {
        ICONES._prep(ctx, s);
        ICONES._roundRect(ctx, -s * 0.36, -s * 0.3, s * 0.72, s * 0.66, s * 0.07);
        ctx.stroke();
        // faixa do topo
        ctx.beginPath();
        ctx.moveTo(-s * 0.36, -s * 0.12);
        ctx.lineTo(s * 0.36, -s * 0.12);
        ctx.stroke();
        // argolas
        [-1, 1].forEach(l => {
            ctx.beginPath();
            ctx.moveTo(l * s * 0.18, -s * 0.3);
            ctx.lineTo(l * s * 0.18, -s * 0.44);
            ctx.stroke();
        });
        // marcações dos dias
        for (let ly = 0; ly < 2; ly++) {
            for (let lx = -1; lx <= 1; lx++) {
                ctx.beginPath();
                ctx.arc(lx * s * 0.19, s * 0.04 + ly * s * 0.2, s * 0.035, 0, Math.PI * 2);
                ctx.stroke();
            }
        }
    },

    // Mochila
    mochila(ctx, s) {
        ICONES._prep(ctx, s);
        ICONES._roundRect(ctx, -s * 0.3, -s * 0.22, s * 0.6, s * 0.62, s * 0.12);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, -s * 0.22, s * 0.16, Math.PI, 0);
        ctx.stroke();
        ICONES._roundRect(ctx, -s * 0.17, s * 0.08, s * 0.34, s * 0.24, s * 0.05);
        ctx.stroke();
    },

    // Caneca de café (com alça)
    caneca(ctx, s) {
        ICONES._prep(ctx, s);
        // corpo
        ICONES._roundRect(ctx, -s * 0.3, -s * 0.22, s * 0.46, s * 0.58, s * 0.07);
        ctx.stroke();
        // alça
        ctx.beginPath();
        ctx.arc(s * 0.16, s * 0.06, s * 0.15, -Math.PI / 2, Math.PI / 2);
        ctx.stroke();
        // vapor
        [-1, 0, 1].forEach(l => {
            ctx.beginPath();
            ctx.moveTo(l * s * 0.11 - s * 0.07, -s * 0.32);
            ctx.lineTo(l * s * 0.11 - s * 0.07, -s * 0.46);
            ctx.stroke();
        });
    },

    // Garrafa squeeze
    garrafa(ctx, s) {
        ICONES._prep(ctx, s);
        ICONES._roundRect(ctx, -s * 0.2, -s * 0.12, s * 0.4, s * 0.52, s * 0.09);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-s * 0.09, -s * 0.12);
        ctx.lineTo(-s * 0.09, -s * 0.3);
        ctx.lineTo(s * 0.09, -s * 0.3);
        ctx.lineTo(s * 0.09, -s * 0.12);
        ctx.stroke();
        ICONES._roundRect(ctx, -s * 0.12, -s * 0.42, s * 0.24, s * 0.12, s * 0.04);
        ctx.stroke();
    }
};

function drawWheel(rotation = 0) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const raioTotal = canvas.width / 2;

    // Fator de escala relativo ao design original (canvas de 420px,
    // raio 210px) — assim fontes, traços e espaçamentos continuam
    // proporcionais mesmo com o canvas rodando em resolução maior.
    const escala = raioTotal / 210;

    // O aro metálico agora é desenhado DENTRO do canvas (antes era uma
    // border do CSS, que não aceita gradiente). Por isso as fatias param
    // um pouco antes da borda.
    const larguraAro = 15 * escala;
    const radius = raioTotal - larguraAro;

    for (let i = 0; i < totalSlices; i++) {
        const startAngle = rotation + i * sliceAngle;
        const endAngle = startAngle + sliceAngle;
        const item = items[i];
        const estaEsgotado = !!item.esgotado;
        const ehDestaque = !!item.destaque && !estaEsgotado;

        const sliceGradient = ctx.createRadialGradient(centerX, centerY, 40 * escala, centerX, centerY, radius);
        if (estaEsgotado) {
            sliceGradient.addColorStop(0, "#4b5563");
            sliceGradient.addColorStop(1, "#1f2937");
        } else {
            sliceGradient.addColorStop(0, item.color1);
            sliceGradient.addColorStop(1, item.color2);
        }

        ctx.save();
        // Brilho externo no prêmio principal: chama o olho pra fatia certa
        if (ehDestaque) {
            ctx.shadowColor = "rgba(255, 196, 60, 0.95)";
            ctx.shadowBlur = 26 * escala;
        }
        ctx.beginPath();
        ctx.moveTo(centerX, centerY);
        ctx.arc(centerX, centerY, radius, startAngle, endAngle);
        ctx.closePath();
        ctx.fillStyle = sliceGradient;
        ctx.fill();
        ctx.restore();

        if (estaEsgotado) {
            // leve efeito "hachurado" pra reforçar visualmente que saiu de jogo
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(centerX, centerY);
            ctx.arc(centerX, centerY, radius, startAngle, endAngle);
            ctx.closePath();
            ctx.clip();
            ctx.strokeStyle = "rgba(0,0,0,0.35)";
            ctx.lineWidth = 3 * escala;
            for (let d = -radius; d < radius * 2; d += 14 * escala) {
                ctx.beginPath();
                ctx.moveTo(centerX + d, centerY - radius);
                ctx.lineTo(centerX + d - radius, centerY + radius);
                ctx.stroke();
            }
            ctx.restore();
        }

        // ----- conteúdo da fatia: ícone + texto -----
        ctx.save();
        ctx.translate(centerX, centerY);

        const midAngle = startAngle + sliceAngle / 2;
        ctx.rotate(midAngle);

        const normalizedAngle = (midAngle % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
        const isLeftHalf = normalizedAngle > Math.PI / 2 && normalizedAngle < (3 * Math.PI) / 2;
        // vira o conteúdo na metade esquerda pra nunca ficar de cabeça pra baixo.
        // Depois do rotate(PI) o "pra fora" do disco passa a ser o -x, por isso
        // todas as distâncias abaixo são multiplicadas por `sinal`.
        if (isLeftHalf) ctx.rotate(Math.PI);
        const sinal = isLeftHalf ? -1 : 1;

        const corConteudo = estaEsgotado ? "#9ca3af" : (item.textColor || "#FFFFFF");

        // Ícone: encostado na borda externa.
        // As faixas de ícone e texto são separadas de propósito:
        // ícone ocupa ~0.72r–0.92r, texto ocupa ~0.33r–0.69r, e a logo
        // central termina por volta de 0.31r. Assim nada se sobrepõe.
        if (!estaEsgotado) {
            ctx.save();
            ctx.translate(sinal * radius * 0.82, 0);
            ctx.fillStyle = corConteudo;
            ctx.shadowColor = "rgba(0,0,0,0.45)";
            ctx.shadowBlur = 5 * escala;
            const desenhar = ICONES[item.id];
            if (desenhar) desenhar(ctx, 38 * escala);
            ctx.restore();
        }

        // Texto: logo abaixo do ícone (mais pra dentro do raio), mas ainda
        // longe o bastante do centro pra não passar por baixo da logo
        ctx.fillStyle = corConteudo;
        ctx.font = `bold ${Math.round(14 * escala)}px 'Segoe UI', Tahoma, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.shadowColor = corConteudo === "#FFFFFF" ? "rgba(0, 0, 0, 0.75)" : "rgba(255,255,255,0.35)";
        ctx.shadowBlur = 4 * escala;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 1;

        // largura limitada pra caber na faixa livre entre a logo central
        // e o ícone — sem isso, textos longos passam por baixo de um dos dois
        const maxTextWidth = radius * 0.34;
        const lineHeight = 16 * escala;
        const textoExibido = estaEsgotado ? "ESGOTADO" : item.text;
        const linhas = quebrarTextoEmLinhas(ctx, textoExibido, maxTextWidth);
        const baseTexto = sinal * radius * (estaEsgotado ? 0.60 : 0.51);
        const offsetInicial = -((linhas.length - 1) * lineHeight) / 2;

        linhas.forEach((linha, idx) => {
            ctx.fillText(linha, baseTexto, offsetInicial + idx * lineHeight, maxTextWidth);
        });

        ctx.restore();
    }

    desenharSeparadores(centerX, centerY, radius, rotation, escala);
    desenharAroMetalico(centerX, centerY, radius, raioTotal, escala);
}

// Cria um gradiente prateado que atravessa a roda na diagonal, simulando
// luz batendo no metal. Usado no aro e nos separadores.
function gradienteMetalico(centerX, centerY, raio) {
    const g = ctx.createLinearGradient(centerX - raio, centerY - raio, centerX + raio, centerY + raio);
    g.addColorStop(0.00, "#ffffff");
    g.addColorStop(0.18, "#c9d3dd");
    g.addColorStop(0.35, "#f7fafc");
    g.addColorStop(0.52, "#98a5b3");
    g.addColorStop(0.70, "#eef2f6");
    g.addColorStop(0.86, "#aab6c2");
    g.addColorStop(1.00, "#ffffff");
    return g;
}

// Linhas divisórias com aparência de metal escovado
function desenharSeparadores(centerX, centerY, radius, rotation, escala) {
    ctx.save();
    ctx.strokeStyle = gradienteMetalico(centerX, centerY, radius);
    ctx.lineWidth = 5 * escala;
    ctx.lineCap = "round";
    ctx.shadowColor = "rgba(0,0,0,0.4)";
    ctx.shadowBlur = 3 * escala;

    for (let i = 0; i < totalSlices; i++) {
        const ang = rotation + i * sliceAngle;
        ctx.beginPath();
        ctx.moveTo(centerX, centerY);
        ctx.lineTo(centerX + Math.cos(ang) * radius, centerY + Math.sin(ang) * radius);
        ctx.stroke();
    }
    ctx.restore();
}

// Aro externo metálico, com uma linha escura interna e outra externa pra
// dar volume (parece um anel de alumínio, não um traço chapado)
function desenharAroMetalico(centerX, centerY, radius, raioTotal, escala) {
    const meio = (radius + raioTotal) / 2;
    const largura = raioTotal - radius;

    ctx.save();
    ctx.beginPath();
    ctx.arc(centerX, centerY, meio, 0, Math.PI * 2);
    ctx.strokeStyle = gradienteMetalico(centerX, centerY, raioTotal);
    ctx.lineWidth = largura;
    ctx.stroke();

    // sombreado nas duas bordas do aro = sensação de relevo
    ctx.lineWidth = Math.max(1, 1.5 * escala);
    ctx.strokeStyle = "rgba(0,0,0,0.45)";
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius + largura * 0.02, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(centerX, centerY, raioTotal - largura * 0.06, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
}

// Quebra o texto do prêmio em várias linhas para caber bem
// dentro da fatia da roleta, em vez de espremer tudo numa linha só.
function quebrarTextoEmLinhas(ctx, texto, larguraMaxima) {
    const palavras = texto.split(' ');
    const linhas = [];
    let linhaAtual = palavras[0] || '';

    for (let i = 1; i < palavras.length; i++) {
        const linhaTeste = linhaAtual + ' ' + palavras[i];
        if (ctx.measureText(linhaTeste).width > larguraMaxima && linhaAtual !== '') {
            linhas.push(linhaAtual);
            linhaAtual = palavras[i];
        } else {
            linhaAtual = linhaTeste;
        }
    }
    linhas.push(linhaAtual);
    return linhas;
}

// Verifica se ainda existe algum prêmio com estoque. Sem isso, quando
// tudo esgota o peso total vira 0, o sorteio cai sempre no primeiro item
// e a roleta continua premiando sem estoque nenhum.
function haPremiosDisponiveis() {
    return items.some(item => !item.esgotado && item.weight > 0);
}

function atualizarDisponibilidade() {
    const btn = document.getElementById("spinBtn");
    if (!haPremiosDisponiveis()) {
        btn.disabled = true;
        btn.textContent = "Prêmios Esgotados";
        return false;
    }
    btn.disabled = false;
    btn.textContent = "Girar Roleta";
    return true;
}

function spinWheel() {
    if (isSpinning) return;
    if (!atualizarDisponibilidade()) return;

    isSpinning = true;
    document.getElementById("spinBtn").disabled = true;

    const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
    let randomNum = Math.random() * totalWeight;
    // começa no primeiro item sorteável, não no índice 0: se o índice 0
    // tivesse peso 0 (item só de exposição), ele poderia ser escolhido
    // quando Math.random() devolvesse exatamente 0
    let winningIndex = items.findIndex(i => i.weight > 0);

    for (let i = 0; i < items.length; i++) {
        if (items[i].weight <= 0) continue; // pula itens de exposição
        randomNum -= items[i].weight;
        if (randomNum <= 0) {
            winningIndex = i;
            break;
        }
    }

    // Registra a saída e esgota automaticamente se bateu o estoque.
    // Serve pra qualquer prêmio — sem casos especiais por item.
    registrarSaida(items[winningIndex].id);

    const sliceCenterAngle = winningIndex * sliceAngle + sliceAngle / 2;
    const extraSpins = 7 * 2 * Math.PI; 
    
    const normalizedCurrentAngle = currentAngle % (2 * Math.PI);
    const targetBaseRotation = (2 * Math.PI) - sliceCenterAngle;
    
    let rotationNeeded = targetBaseRotation - normalizedCurrentAngle;
    if (rotationNeeded < 0) {
        rotationNeeded += (2 * Math.PI);
    }
    
    const totalDistance = extraSpins + rotationNeeded;
    const startAngle = currentAngle; 

    const duration = 4500; 
    let start = null;

    function animate(timestamp) {
        if (!start) start = timestamp;
        const elapsed = timestamp - start;
        
        let progress = Math.min(elapsed / duration, 1);
        const easeOut = 1 - Math.pow(1 - progress, 4);
        
        currentAngle = startAngle + totalDistance * easeOut;
        drawWheel(currentAngle);

        if (progress < 1) {
            requestAnimationFrame(animate);
        } else {
            isSpinning = false;
            // reabilita só se ainda houver estoque
            atualizarDisponibilidade();

            const premioGanho = items[winningIndex];

            // Prêmios de voucher (resgatados depois, fora do estande) ganham
            // um código único que a pessoa fotografa. Esse mesmo código vai
            // pra planilha, o que permite conferir depois quem ganhou o quê.
            const voucher = premioGanho.voucher ? gerarCodigoVoucher() : null;

            registrarPremio({ id: premioGanho.id, nome: premioGanho.text, voucher });
            showModal({ ...premioGanho, voucher });
        }
    }
    requestAnimationFrame(animate);
}

function showModal(premio) {
    const ehAirfryer = premio.id === 'airfryer';
    const temVoucher = !!premio.voucher;
    const semPremio = !!premio.semPremio;

    const modal = document.getElementById("resultModal");
    const modalContent = document.getElementById("modalContent");
    const titulo = document.getElementById("modalTitulo");
    const voucherBlock = document.getElementById("voucherBlock");
    const btnFechar = document.getElementById("btnFecharModal");

    // ----- Caso "não foi dessa vez" -----
    // Mochila e Airfryer continuam na roda pela emoção, mas não são
    // entregues agora: vão a sorteio num evento posterior.
    if (semPremio) {
        titulo.textContent = "Não foi dessa vez! 😢";
        modalContent.classList.remove("especial");
        modalContent.classList.add("sem-premio");

        document.getElementById("winnerText").innerText = premio.sorteioFuturo
            ? `A ${premio.text} será sorteada em um evento posterior. Fique de olho!`
            : "Obrigado por participar! Tente novamente.";

        anunciarParaLeitorDeTela("Não foi dessa vez.");

        voucherBlock.classList.remove("visivel");
        btnFechar.textContent = "Fechar";

        modal.classList.add("active");
        modal.setAttribute("aria-hidden", "false");
        // sem confete e sem som de vitória: não houve prêmio
        return;
    }

    modalContent.classList.remove("sem-premio");
    document.getElementById("winnerText").innerText = `Você ganhou: ${premio.text}`;

    // Anúncio pra leitor de tela — região temporária, criada e
    // removida em seguida (ver função abaixo pra entender o motivo)
    anunciarParaLeitorDeTela(`Parabéns! Você ganhou: ${premio.text}`);

    // Airfryer é o prêmio mais raro (1 unidade só) — comemoração maior
    if (ehAirfryer) {
        titulo.textContent = "PRÊMIO RARÍSSIMO! 🎉🔥";
        modalContent.classList.add("especial");
    } else {
        titulo.textContent = "Parabéns! 🎉";
        modalContent.classList.remove("especial");
    }

    // Prêmios de voucher (Seguro Residencial, Voucher Auto): exibe o
    // código em fonte grande pra pessoa fotografar. O código já foi
    // gerado e gravado junto com o registro do giro, então a conferência
    // posterior é só buscar esse código na planilha (com data/hora e
    // prêmio na mesma linha).
    if (temVoucher) {
        voucherBlock.classList.add("visivel");
        document.getElementById("voucherInfo").textContent =
            `Tire uma foto deste código e apresente no contato para resgatar seu prêmio (${premio.text}):`;
        document.getElementById("voucherCodigo").textContent = premio.voucher || '—';
        document.getElementById("voucherData").textContent = formatarDataHoraBR(new Date());
        btnFechar.textContent = "Fechar";
    } else {
        voucherBlock.classList.remove("visivel");
        btnFechar.textContent = "Resgatar Prêmio";
    }

    modal.classList.add("active");
    modal.setAttribute("aria-hidden", "false");

    dispararConfete(ehAirfryer);
    tocarSomVitoria(ehAirfryer);
}

// Gera um código de voucher curto, legível e difícil de adivinhar.
// Evita caracteres ambíguos (O/0, I/1) pra não dar confusão na hora de
// alguém ler o código de uma foto.
function gerarCodigoVoucher() {
    const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let bloco1 = '';
    let bloco2 = '';
    for (let i = 0; i < 4; i++) {
        bloco1 += alfabeto[Math.floor(Math.random() * alfabeto.length)];
        bloco2 += alfabeto[Math.floor(Math.random() * alfabeto.length)];
    }
    return `CF-${bloco1}-${bloco2}`;
}

function formatarDataHoraBR(data) {
    return data.toLocaleString('pt-BR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
}

function closeModal() {
    const modal = document.getElementById("resultModal");
    modal.classList.remove("active");
    modal.setAttribute("aria-hidden", "true");
}

// Cria uma região aria-live temporária, anuncia o texto e remove
// a região do DOM logo em seguida. Diferente de manter uma região
// fixa o tempo todo: algumas extensões de leitura/acessibilidade
// desenham um destaque visual na região "viva" mais próxima e não
// soltam esse destaque até a região sumir — mantê-la permanente
// (mesmo invisível) fazia esse destaque ficar grudado na tela
// bem depois do anúncio, como um contorno ao redor da página.
function anunciarParaLeitorDeTela(texto) {
    const regiao = document.createElement('div');
    regiao.setAttribute('role', 'status');
    regiao.setAttribute('aria-live', 'assertive');
    regiao.className = 'sr-only';
    document.body.appendChild(regiao);

    // pequeno atraso garante que o leitor de tela já "viu" a região
    // vazia antes do texto mudar, o que é mais confiável pra disparar o anúncio
    setTimeout(() => {
        regiao.textContent = texto;
    }, 50);

    // tempo suficiente pra qualquer leitor de tela terminar de falar,
    // mas sem deixar a região pendurada no DOM indefinidamente
    setTimeout(() => {
        regiao.remove();
    }, 4000);
}

// ==========================================================
// EFEITOS DE VITÓRIA — confete (canvas próprio, sem dependência
// externa) e som (gerado via Web Audio API, sem precisar de
// arquivo de áudio). Respeita "prefers-reduced-motion" para
// quem configurou o sistema pra reduzir animações.
// ==========================================================
function prefereReducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

let confeteCanvas = null;
let confeteCtx = null;

function dispararConfete(especial) {
    if (prefereReducedMotion()) return;

    if (!confeteCanvas) {
        confeteCanvas = document.createElement('canvas');
        confeteCanvas.style.position = 'fixed';
        confeteCanvas.style.top = '0';
        confeteCanvas.style.left = '0';
        confeteCanvas.style.width = '100%';
        confeteCanvas.style.height = '100%';
        confeteCanvas.style.pointerEvents = 'none';
        confeteCanvas.style.zIndex = '200';
        confeteCanvas.style.border = 'none';
        confeteCanvas.style.borderRadius = '0';
        confeteCanvas.style.background = 'transparent';
        document.body.appendChild(confeteCanvas);
        confeteCtx = confeteCanvas.getContext('2d');
    }

    confeteCanvas.width = window.innerWidth;
    confeteCanvas.height = window.innerHeight;

    const coresConfete = especial
        ? ['#f59e0b', '#fbbf24', '#F4F6F9', '#0072bb']
        : ['#0072bb', '#075485', '#4fb3e8', '#F4F6F9'];
    const particulas = [];
    const totalParticulas = especial ? 220 : 90;

    for (let i = 0; i < totalParticulas; i++) {
        particulas.push({
            x: confeteCanvas.width / 2,
            y: confeteCanvas.height / 2 - 100,
            vx: (Math.random() - 0.5) * (especial ? 16 : 12),
            vy: (Math.random() - 1.6) * (especial ? 15 : 12),
            tamanho: (especial ? 5 : 4) + Math.random() * 5,
            cor: coresConfete[Math.floor(Math.random() * coresConfete.length)],
            rotacao: Math.random() * 360,
            velRotacao: (Math.random() - 0.5) * 12,
            vida: 0
        });
    }

    const duracaoMs = especial ? 4200 : 2600;
    const inicio = performance.now();

    function animarConfete(agora) {
        const decorrido = agora - inicio;
        confeteCtx.clearRect(0, 0, confeteCanvas.width, confeteCanvas.height);

        particulas.forEach(p => {
            p.vy += 0.25; // gravidade
            p.x += p.vx;
            p.y += p.vy;
            p.rotacao += p.velRotacao;

            confeteCtx.save();
            confeteCtx.translate(p.x, p.y);
            confeteCtx.rotate((p.rotacao * Math.PI) / 180);
            confeteCtx.fillStyle = p.cor;
            confeteCtx.globalAlpha = Math.max(0, 1 - decorrido / duracaoMs);
            confeteCtx.fillRect(-p.tamanho / 2, -p.tamanho / 2, p.tamanho, p.tamanho * 0.6);
            confeteCtx.restore();
        });

        if (decorrido < duracaoMs) {
            requestAnimationFrame(animarConfete);
        } else {
            confeteCtx.clearRect(0, 0, confeteCanvas.width, confeteCanvas.height);
        }
    }

    requestAnimationFrame(animarConfete);
}

function tocarSomVitoria(especial) {
    try {
        const AudioContextRef = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextRef) return;
        const ctxAudio = new AudioContextRef();
        if (ctxAudio.state === 'suspended') {
            ctxAudio.resume();
        }

        // Arpejo padrão (dó-mi-sol). No modo especial (Airfryer),
        // acrescenta mais duas notas formando uma pequena fanfarra.
        const notas = especial
            ? [523.25, 659.25, 783.99, 1046.50, 1318.51]
            : [523.25, 659.25, 783.99];

        notas.forEach((freq, i) => {
            const osc = ctxAudio.createOscillator();
            const ganho = ctxAudio.createGain();
            osc.type = 'sine';
            osc.frequency.value = freq;

            const inicioNota = ctxAudio.currentTime + i * (especial ? 0.1 : 0.12);
            ganho.gain.setValueAtTime(0, inicioNota);
            ganho.gain.linearRampToValueAtTime(especial ? 0.25 : 0.2, inicioNota + 0.02);
            ganho.gain.exponentialRampToValueAtTime(0.001, inicioNota + 0.5);

            osc.connect(ganho);
            ganho.connect(ctxAudio.destination);
            osc.start(inicioNota);
            osc.stop(inicioNota + 0.5);
        });
    } catch (erro) {
        console.warn('Não foi possível tocar o som de vitória:', erro);
    }
}

// ==========================================================
// REGISTRO DE PRÊMIOS — Google Sheets + fallback localStorage
// ==========================================================
const STORAGE_KEY = 'historico_premios_cf';

function getHistorico() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    } catch (e) {
        return [];
    }
}

function salvarHistorico(historico) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(historico));
}

function atualizarStatusBar() {
    const historico = getHistorico();
    const pendentes = historico.filter(h => !h.sincronizado).length;
    const dot = document.getElementById('statusDot');
    const text = document.getElementById('statusText');

    if (pendentes === 0) {
        dot.className = 'status-dot';
        text.textContent = 'Sincronizado';
    } else {
        dot.className = 'status-dot pending';
        text.textContent = `${pendentes} pendente(s)`;
    }
}

// Registra um prêmio: salva local sempre, depois tenta enviar pro Sheets
function registrarPremio(premio) {
    const historico = getHistorico();
    const registro = {
        ...premio,
        giroId: gerarIdGiro(),
        timestamp: new Date().toISOString(),
        sincronizado: false
    };
    historico.push(registro);
    salvarHistorico(historico);
    atualizarStatusBar();

    enviarParaSheets(registro, historico.length - 1);
}

// Gera um ID único por giro. Isso é o que permite ao Apps Script
// detectar reenvios (ex: fetch que "parece" ter falhado por timeout
// mas na verdade já tinha chegado) e não duplicar a linha na planilha.
function gerarIdGiro() {
    if (window.crypto && window.crypto.randomUUID) {
        return window.crypto.randomUUID();
    }
    // fallback para navegadores mais antigos sem crypto.randomUUID
    return 'giro-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
}

function enviarParaSheets(registro, indice) {
    fetch(SHEETS_ENDPOINT, {
        method: 'POST',
        // text/plain evita o preflight OPTIONS, que o Apps Script
        // não trata bem e causaria erro de CORS.
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ id: registro.id, nome: registro.nome, giroId: registro.giroId, voucher: registro.voucher || '', token: API_TOKEN })
    })
    .then(response => response.json())
    .then(() => {
        const historico = getHistorico();
        if (historico[indice]) {
            historico[indice].sincronizado = true;
            salvarHistorico(historico);
        }
        atualizarStatusBar();
        console.log('Registrado na planilha:', registro.nome);
    })
    .catch(error => {
        console.warn('Sem conexão — item salvo localmente, será reenviado:', error);
        atualizarStatusBar();
    });
}

// Tenta reenviar tudo que ainda não foi sincronizado
// (roda ao carregar a página e sempre que a conexão voltar)
function tentarResincronizar() {
    const historico = getHistorico();
    historico.forEach((registro, indice) => {
        if (!registro.sincronizado) {
            enviarParaSheets(registro, indice);
        }
    });
}

window.addEventListener('online', () => {
    document.getElementById('statusDot').classList.remove('offline');
    tentarResincronizar();
    sincronizarEstadoComSheets();
});

window.addEventListener('offline', () => {
    document.getElementById('statusDot').classList.add('offline');
    document.getElementById('statusText').textContent = 'Sem internet';
});

// Inicialização
carregarEstadoRoleta();
drawWheel();
atualizarDisponibilidade();
atualizarStatusBar();
tentarResincronizar();
sincronizarEstadoComSheets();

// Registro do Service Worker (necessário para "Adicionar à tela
// inicial" funcionar em modo standalone no Chrome/Android).
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch((erro) => {
            console.warn('Não foi possível registrar o service worker:', erro);
        });
    });
}