function registerServiceWorker() {
    // registrando o service worker para navegadores com suporte
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('../sw.js', { scope: '../' }).then(() => {
        console.log('Service Worker registrado com sucesso.');
      }).catch(error => {
        console.log('Service Worker falhou:', error);
      });
    }
}

function criarbotoes(container, cardapio, idCaixaDeTextoDePedidos, idCaixaDePrecoDePedidos) {
    let temp = '';
    for (let i = 0; i < cardapio.length; i++) {
        temp += "<div onclick='adicionarAoPedido(`"+ cardapio[i][0] +"`,"+ cardapio[i][1]  +",`"  +  idCaixaDeTextoDePedidos +"`,`" + idCaixaDePrecoDePedidos +"`)' class='bloco'>  <div class='blocoImagem' style='background-image: url(" + cardapio[i][2] + ");background-repeat: no-repeat;background-size: contain;'>  </div>  <div class='blocoTexto'>"+ cardapio[i][0] +"</div>  </div>";
    }
    container.innerHTML += temp + "<div id='espacoEmBrancoDeBaixo'></div>";
    
}

function adicionarAoPedido(Nome, preco, idCaixaDeTextoDePedidos, idCaixaDePrecoDePedidos){

    let caixaDeTextoDePedidos = document.querySelector(idCaixaDeTextoDePedidos)
    let caixaDePrecoDePedidos = document.querySelector(idCaixaDePrecoDePedidos)

    console.log(Nome + ' ' + preco);

    let totalPagar = parseFloat(localStorage.getItem('totalPedido'));
    totalPagar += preco;

    caixaDePrecoDePedidos.textContent = formatarNumero('', totalPagar, '');

    // criando histórco de inserção
    let historicoDeInserção = localStorage.getItem('historicoDeInserção')
    historicoDeInserção += ',' + preco;
    localStorage.setItem('historicoDeInserção', historicoDeInserção);

    localStorage.setItem('totalPedido', totalPagar);

    if (caixaDeTextoDePedidos.textContent == '') {
        caixaDeTextoDePedidos.textContent += Nome;
    }else{
        caixaDeTextoDePedidos.textContent += ' + ' + Nome;
    }
}

function resetarPedidos(idCaixaDeTextoDePedidos, idCaixaDePrecoDePedidos, idInputTroco, idCaixaDeTextoTroco){

    document.querySelector(idCaixaDeTextoDePedidos).textContent='';
    document.querySelector(idCaixaDePrecoDePedidos).textContent='R$ 0,00';

    document.querySelector(idInputTroco           ).value = '';
    document.querySelector(idCaixaDeTextoTroco    ).textContent = 'R$ 0,00';

    localStorage.setItem('historicoDeInserção', '')
    localStorage.setItem('totalPedido', 0);

}

function formatarTextoDePedidos(texto) {
    texto      = texto.split(' + ');

    // Para mostar uma lista com a quantidade de pedidos

    let quantidadeDeComidaTemp = {};
    let quantidadeDeComida = [];

    for (let i = 0; i < texto.length; i++) {
        if (!quantidadeDeComidaTemp[texto[i]]) {
            quantidadeDeComidaTemp[texto[i]] = texto.filter(x => x === texto[i]).length;
            quantidadeDeComida.push([texto[i], quantidadeDeComidaTemp[texto[i]]]);
        } 
    }

    let temp = '';
    for (let i = 0; i < quantidadeDeComida.length; i++) { 
        temp += quantidadeDeComida[i][1] + ' - ' + quantidadeDeComida[i][0] + ' <br> ';
    }

    return temp;
}

function finalizarPedido(idTelaFinalizarPedido, idCaixaDeTextoDePedidos, idCaixaTotal, idTelaFinalizarPedidoTexto){
    
    let telaFinalizarPedido      = document.querySelector(idTelaFinalizarPedido);
    let caixaDeTexto             = document.querySelector(idCaixaDeTextoDePedidos);
    let telaTotal                = document.querySelector(idCaixaTotal);
    let telaFinalizarPedidoTexto = document.querySelector(idTelaFinalizarPedidoTexto);
    let totalPagar = parseFloat(localStorage.getItem('totalPedido'));

    telaFinalizarPedido.style.display = 'block';
    telaTotal.textContent             = formatarNumero('', totalPagar, '');

    telaFinalizarPedidoTexto.innerHTML = formatarTextoDePedidos(caixaDeTexto.textContent);

}

function apagarPedido(idCaixaDeTextoDePedidos, idCaixaDePrecoDePedidos){
    
    let totalPagar          = parseFloat(localStorage.getItem('totalPedido'));
    let historicoDeInsercao = localStorage.getItem('historicoDeInserção');

    let caixaDePreco = document.querySelector(idCaixaDePrecoDePedidos);
    let caixaDeTexto = document.querySelector(idCaixaDeTextoDePedidos);
    
    let textoCortado = caixaDeTexto.textContent;
    let textoTemp1;
    let textoTemp2='';
    let ultimoValor;

    // separando a lista para poder remover o ultimo item
    textoCortado = textoCortado.split(' + ')
    textoTemp1 = textoCortado.slice(0, textoCortado.length - 1);

    for (let i = 0; i < textoTemp1.length; i++) {
        if (i==0) {
        textoTemp2 += textoTemp1[i]
            
        }else{
            textoTemp2 += ' + ' + textoTemp1[i]
        }
    }

    // apagando o ultimo item da lista
    historicoDeInsercao = historicoDeInsercao.split(',');
    ultimoValor = historicoDeInsercao.slice(historicoDeInsercao.length - 1);
    localStorage.setItem('historicoDeInserção', historicoDeInsercao.slice(0, historicoDeInsercao.length - 1))
    
    console.log(ultimoValor);

    // apagando o ultimo valor da lista
    totalPagar -= ultimoValor;
    localStorage.setItem('totalPedido', totalPagar);

    caixaDePreco.textContent = formatarNumero('', totalPagar, '')
    caixaDeTexto.textContent = textoTemp2;
    
}

function fecharTela(idInputTroco, idTelaFinalizarPedido, idCaixaHistorico, idCaixaDeTextoTroco){
    document.querySelector(idInputTroco).value = '';
    document.querySelector(idTelaFinalizarPedido).style.display = 'none';
    document.querySelector(idCaixaHistorico).style.display = 'none';
    document.querySelector(idCaixaDeTextoTroco).textContent = 'R$ 0,00'
}

function formatarNumero(prefixo ,numero, sufixo) {
    //para identificar se o numero é float ou inteiro
    if (numero % 1 === 0) {

        return prefixo + 'R$ ' + numero + ',00' + sufixo;

    }else{

        // para identificar se o numero tem 2 casas depois da vigula
        if ((numero * 10) % 1 === 0) {
            
            return prefixo + ('R$ ' + numero + '0').replace('.', ',')  + sufixo;

        }else{

            return prefixo + ('R$ ' + numero + '').replace('.', ',')  + sufixo;
            
        }
    }
}

function salvarNoHistorico(idTelaFinalizarPedidoTexto, idInputTroco, idTelaFinalizarPedido, idCaixaHistorico, idCaixaDeTextoTroco, idCaixaDeTextoDePedidos, idCaixaDePrecoDePedidos) {
    if (document.querySelector(idTelaFinalizarPedidoTexto).innerHTML != '1 -  <br> ') {
        let totalPagar          = parseFloat(localStorage.getItem('totalPedido'));
        let quantidadeDePedidos = parseInt(localStorage.getItem('quantidadeDePedidos')) 
        let listaPedido         = localStorage.getItem('historicoDePedidos');
        let caixaDeTexto             = document.querySelector(idCaixaDeTextoDePedidos).textContent;
        let historicoResumo;
        let totalGeral          = parseFloat(localStorage.getItem('totalGeral'));

        console.log(totalGeral+" AEEEEEEEEEE");
        historicoResumo = localStorage.getItem('historicoResumo');
        console.log(totalPagar);
        totalGeral += totalPagar;

        if (historicoResumo == '') {
            historicoResumo += caixaDeTexto;
        }
        else{
            historicoResumo += ' + ' + caixaDeTexto;
        }

        localStorage.setItem('totalGeral', totalGeral);
        localStorage.setItem('historicoResumo', historicoResumo);

        listaPedido += '-------- '+ quantidadeDePedidos +' -------- <br> ';
        listaPedido += document.querySelector(idTelaFinalizarPedidoTexto).innerHTML;

        listaPedido += formatarNumero('Total = ', totalPagar, ' <br> ');
        localStorage.setItem('historicoDePedidos', listaPedido);

        quantidadeDePedidos++;
        localStorage.setItem('quantidadeDePedidos', quantidadeDePedidos)
        

        fecharTela(idInputTroco, idTelaFinalizarPedido, idCaixaHistorico, idCaixaDeTextoTroco);
        resetarPedidos(idCaixaDeTextoDePedidos, idCaixaDePrecoDePedidos, idInputTroco, idCaixaDeTextoTroco);  
    } 
}

function exibirHistorico() {
    document.getElementById('historico').style.display = 'block';
    document.getElementById('textoHistorico').innerHTML = localStorage.getItem('historicoDePedidos') +' <br> .'
}

function calcularTroco(idInputTroco, idCaixaDeTextoTroco,  idTelaFinalizarPedido, idCaixaHistorico) {
    
    let totalPagar    = parseFloat(localStorage.getItem('totalPedido'));
    let valorRecebido = document.querySelector(idInputTroco).value;
    let caixaTroco    = document.querySelector(idCaixaDeTextoTroco);

    if (valorRecebido == '4321') {
        fecharTela(idInputTroco, idTelaFinalizarPedido, idCaixaHistorico, idCaixaDeTextoTroco);
        exibirHistorico();
    }
    if (valorRecebido == '0000000000000') {
        localStorage.setItem('quantidadeDePedidos', 1);
        localStorage.setItem('historicoDePedidos', '');
        localStorage.setItem('historicoResumo', '');
        alert('Histórico Resetado');
    }

    totalPagar -= valorRecebido;
    if (totalPagar > 0) {
        caixaTroco.style.color = '#ff8686'
    }else{
        caixaTroco.style.color = '#86d9ff'
    }

    caixaTroco.textContent = formatarNumero('', totalPagar*-1, '');

}

function gerarHistoricoResumido() {
    let totalGeral = parseFloat(localStorage.getItem('totalGeral'));
    return formatarTextoDePedidos(localStorage.getItem('historicoResumo')) + " <br> Total = " + formatarNumero('',totalGeral,'');
}



// ------------- principal -------------
let container = document.getElementById('container');
let cardapio = [
    ['Caldo',             2,   './images/alimentos/caldo.png'],
    ['Canjica',           2,   './images/alimentos/canjica.png'],
    ['Espetinho',         12,  './images/alimentos/espetinho.png'],
    ['Galin. caip.',      13,  './images/alimentos/galinha_caip.png'],
    ['Crepe',             2.5, './images/alimentos/crepe.png'],
    ['Misto',             3,   './images/alimentos/misto.png'],
    ['C. quente',         3,   './images/alimentos/cachorro_quente.png'],
    ['Coca-cola',         10,  './images/alimentos/coca-cola.png'],
    ['Fanta',             10,  './images/alimentos/fanta.png'],
    ['Antarctica',        10,  './images/alimentos/guarana_antarctica.png'],
    ['River',             7,   './images/alimentos/river.png'],
    ['Copo refri',        2,   './images/alimentos/copo_de_refri.png'],
    ['Copo suco',         2,   './images/alimentos/copo_de_suco.png'], 
    ['Torta doce',        3,   './images/alimentos/torta_doce.png'],
    ['Salgado',           2,   './images/alimentos/salgados.png']
]

// Id caixas de textos principais
let idCaixaDeTextoDePedidos    = "#caixaDeTexto>p";
let idCaixaDePrecoDePedidos    = "#caixaDePreco";

// Id caixas de textos tela finalizar pedido
let idInputTroco               = "#inputPago";
let idCaixaDeTextoTroco        = "#caixaTroco";
let idTelaFinalizarPedido      = "#telaFinalizarPedido";
let idCaixaTotal               = "#caixaTotal";
let idTelaFinalizarPedidoTexto = "#telaFinalizarPedidoTexto"

// Id caixa tela histórico
let idCaixaHistorico           = "#historico"
let idCaixaHistoricoTexto      = "#textoHistorico"

// Id botões pricipais 
let idBotaoResetar             = "#resetar";
let idBotaoFinalizarPedido     = "#finalizarPedido";
let idBotaoApagar              = "#apagar";

// Id botões tela finalizar pedidos
let idBotaoFecharTelaDePedidos = "#botaoFechar";
let idBotaoSalvarNoHistorico   = "#botaoCalcular";

// Id botões tela histórico
let idBotaoFecharHistorico       = "#botaoFecharHistorico";
let idBotaoDownload              = "#botaoDownload"

// adcionando eventos nos botões
document.querySelector(idBotaoResetar).addEventListener(           "click", function() {    resetarPedidos(   idCaixaDeTextoDePedidos, idCaixaDePrecoDePedidos, idInputTroco, idCaixaDeTextoTroco)   });
document.querySelector(idBotaoFinalizarPedido).addEventListener(   "click", function() {    finalizarPedido(  idTelaFinalizarPedido, idCaixaDeTextoDePedidos, idCaixaTotal, idTelaFinalizarPedidoTexto)  });
document.querySelector(idBotaoApagar).addEventListener(            "click", function() {    apagarPedido(idCaixaDeTextoDePedidos, idCaixaDePrecoDePedidos)     });

document.querySelector(idBotaoFecharHistorico).addEventListener(     "click", function() {    fecharTela(idInputTroco, idTelaFinalizarPedido, idCaixaHistorico, idCaixaDeTextoTroco)     });
document.querySelector(idBotaoFecharTelaDePedidos).addEventListener( "click", function() {    fecharTela(idInputTroco, idTelaFinalizarPedido, idCaixaHistorico, idCaixaDeTextoTroco)     });
document.querySelector(idBotaoSalvarNoHistorico).addEventListener(   "click", function() {    salvarNoHistorico(idTelaFinalizarPedidoTexto, idInputTroco, idTelaFinalizarPedido, idCaixaHistorico, idCaixaDeTextoTroco, idCaixaDeTextoDePedidos, idCaixaDePrecoDePedidos)     });

// adicionando evento de calcular no input
document.querySelector(idInputTroco).addEventListener(   "keyup", function() {    calcularTroco(idInputTroco, idCaixaDeTextoTroco,  idTelaFinalizarPedido, idCaixaHistorico)     });

// adicionando função de download do histórico
document.querySelector(idBotaoDownload).addEventListener('click', function() {
    let text = document.querySelector(idCaixaHistoricoTexto).innerHTML;
    let textoResumo = gerarHistoricoResumido();
    let resumo = document.createElement("a");

    resumo.setAttribute('href','data:text/plain;charset=utf-8, ' + encodeURIComponent(textoResumo.replace(/<br>/g, '\n')));
    resumo.setAttribute('download', "Historico_resumo.txt");
    resumo.click();
    resumo.remove();

    this.setAttribute('href','data:text/plain;charset=utf-8, ' + encodeURIComponent(text.replace(/<br>/g, '\n')));
    this.setAttribute('download', "Historico_de_pedidos.txt");
});

// ------------------ funções -------------------
localStorage.setItem('totalPedido', 0);
localStorage.setItem('historicoDeInserção', '');

if (!localStorage.getItem('quantidadeDePedidos')) {
    localStorage.setItem('quantidadeDePedidos', 1);
}   
if (!localStorage.getItem("historicoResumo")) {
    localStorage.setItem("historicoResumo", '');
    localStorage.setItem('totalGeral', 0);
}

criarbotoes(container, cardapio, idCaixaDeTextoDePedidos, idCaixaDePrecoDePedidos);
registerServiceWorker();
