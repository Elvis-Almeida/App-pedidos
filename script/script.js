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

registerServiceWorker();

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
    ['Antarctica',         10,  './images/alimentos/guarana_antarctica.png'],
    ['River',             7,   './images/alimentos/river.png'],
    ['Copo refri',        2,   './images/alimentos/copo_de_refri.png'],
    ['Copo suco',         2,   './images/alimentos/copo_de_suco.png'],
    ['Torta doce',        3,   './images/alimentos/torta_doce.png'],
    ['Salgado',           2,   './images/alimentos/salgados.png']
]
localStorage.setItem('totalPedido', 0);
localStorage.setItem('historicoDeInserção', '');

if (!localStorage.getItem('quantidadeDePedidos')) {
    localStorage.setItem('quantidadeDePedidos', 1);
}

function listarPedido(pedido) {
    
}

function adicionarAoPedido(Nome, preco){
    console.log(Nome + ' ' + preco);

    let caixaDeTexto = document.querySelector('#caixaDeTexto>p');
    let caixaDePreco = document.getElementById('caixaDePreco');

    let totalPagar = parseFloat(localStorage.getItem('totalPedido'));
    totalPagar += preco;

    //para identificar se o numero é float ou inteiro
    if (totalPagar % 1 === 0) {

        caixaDePreco.textContent = 'R$ ' + totalPagar + ',00';

    }else{

        // para identificar se o numero tem 2 casas depois da vigula
        if ((totalPagar * 10) % 1 === 0) {
            
            caixaDePreco.textContent = ('R$ ' + totalPagar + '0').replace('.', ',');

        }else{

            caixaDePreco.textContent = ('R$ ' + totalPagar).replace('.', ',');
            
        }
    }

    // criando histórco de inserção
    let historicoDeInserção = localStorage.getItem('historicoDeInserção')
    historicoDeInserção += ',' + preco;
    localStorage.setItem('historicoDeInserção', historicoDeInserção);

    localStorage.setItem('totalPedido', totalPagar);

    if (caixaDeTexto.textContent == '') {
        caixaDeTexto.textContent += Nome;
    }else{
        caixaDeTexto.textContent += ' + ' + Nome;
    }
}

function fecharTela(){
    document.getElementById('inputPago').value = '';
    document.getElementById('telaFinalizarPedido').style.display = 'none';
    document.getElementById('historico').style.display = 'none';
    document.querySelector('#caixaTroco').textContent = 'R$ 0,00'
}

function finalizarPedido(){
    document.getElementById('telaFinalizarPedido').style.display = 'block'
    let caixaDeTexto = document.querySelector('#caixaDeTexto>p');
    let totalPagar = parseFloat(localStorage.getItem('totalPedido'));
    let telaTotal = document.getElementById('caixaTotal');
    let texto = caixaDeTexto.textContent.split(' + ');

    //para identificar se o numero é float ou inteiro
    if (totalPagar % 1 === 0) {

        telaTotal.textContent = 'R$ ' + totalPagar + ',00';

    }else{

        // para identificar se o numero tem 2 casas depois da vigula
        if ((totalPagar * 10) % 1 === 0) {
            
            telaTotal.textContent = ('R$ ' + totalPagar + '0').replace('.', ',');

        }else{

            telaTotal.textContent = ('R$ ' + totalPagar).replace('.', ',');
            
        }
    }

    // Para mostar uma lista com a quantidade de pedidos
    let quantidadeDeComidaTemp = {}
    let quantidadeDeComida = []

    for (let i = 0; i < texto.length; i++) {
        if (!quantidadeDeComidaTemp[texto[i]]) {
            quantidadeDeComidaTemp[texto[i]] = texto.filter(x => x === texto[i]).length;
            quantidadeDeComida.push([texto[i], quantidadeDeComidaTemp[texto[i]]])
        } 
    }

    let temp = '';
    for (let i = 0; i < quantidadeDeComida.length; i++) { 
        temp += quantidadeDeComida[i][1] + ' - ' + quantidadeDeComida[i][0] + ' <br> ';
    }

    document.getElementById('telaFinalizarPedidoTexto').innerHTML = temp;
}
    
    

function resetarPedidos(){
    let caixaDeTexto = document.querySelector('#caixaDeTexto>p');
    let caixaDePreco = document.getElementById('caixaDePreco');
    caixaDeTexto.textContent='';
    caixaDePreco.textContent='R$ 0,00';
    localStorage.setItem('totalPedido', 0);
    document.getElementById('inputPago').value = '';
    document.querySelector('#caixaTroco').textContent = 'R$ 0,00';
    localStorage.setItem('historicoDeInserção', '')

}

function apagarPedido(){
    
    let totalPagar = parseFloat(localStorage.getItem('totalPedido'));
    let caixaDePreco = document.getElementById('caixaDePreco');
    let caixaDeTexto = document.querySelector('#caixaDeTexto>p');
    let historicoDeInsercao = localStorage.getItem('historicoDeInserção')
    let textoCortado = caixaDeTexto.textContent
    let textoTemp1;
    let textoTemp2='';
    let ultimoValor

    
    textoCortado = textoCortado.split(' + ')
    textoTemp1 = textoCortado.slice(0, textoCortado.length - 1);

    for (let i = 0; i < textoTemp1.length; i++) {
        if (i==0) {
        textoTemp2 += textoTemp1[i]
            
        }else{
            textoTemp2 += ' + ' + textoTemp1[i]
        }
    }

    historicoDeInsercao = historicoDeInsercao.split(',');
    ultimoValor = historicoDeInsercao.slice(historicoDeInsercao.length - 1);
    localStorage.setItem('historicoDeInserção', historicoDeInsercao.slice(0, historicoDeInsercao.length - 1))
    console.log(ultimoValor);

    totalPagar -= ultimoValor;
    localStorage.setItem('totalPedido', totalPagar);
    
    //para identificar se o numero é float ou inteiro
    if (totalPagar % 1 === 0) {

        caixaDePreco.textContent = 'R$ ' + totalPagar + ',00';

    }else{

        // para identificar se o numero tem 2 casas depois da vigula
        if ((totalPagar * 10) % 1 === 0) {
            
            caixaDePreco.textContent = ('R$ ' + totalPagar + '0').replace('.', ',');

        }else{

            caixaDePreco.textContent = ('R$ ' + totalPagar).replace('.', ',');
            
        }
    }
    // caixaDePreco.textContent = 'R$ ' + totalPagar + ',00';
    
    caixaDeTexto.textContent = textoTemp2;
    
}

function criarbotoes(container, cardapio) {
    for (let i = 0; i < cardapio.length; i++) {
        container.innerHTML += "<div onclick='adicionarAoPedido(`"+ cardapio[i][0] +"`,"+ cardapio[i][1] +")' class='bloco'>  <div class='blocoImagem' style='background-image: url(" + cardapio[i][2] + ");background-repeat: no-repeat;background-size: contain;'>  </div>  <div class='blocoTexto'>"+ cardapio[i][0] +"</div>  </div>";
    }
    container.innerHTML += "<div id='espacoEmBrancoDeBaixo'></div>";
    container.innerHTML += "<div id='caixaDeTexto'><p></p><div id='caixaDePreco'>R$ 0,00</div></div>";
    container.innerHTML +=' <div id="botoesDeControle">  <div onclick="resetarPedidos()" class="botoes" id="resetar">Resetar</div>  <div onclick="finalizarPedido()" class="botoes" id="finalizarPedido">Finalizar</div>  <div onclick="apagarPedido()" class="botoes" id="apagar">Apagar</div>  </div>'

}

function salvarNoHistorico() {
    if (document.getElementById('telaFinalizarPedidoTexto').innerHTML != '1 -  <br> ') {
        let totalPagar = parseFloat(localStorage.getItem('totalPedido'));
        let quantidadeDePedidos = parseInt(localStorage.getItem('quantidadeDePedidos')) 
        let listaPedido = localStorage.getItem('historicoDePedidos');
        listaPedido += '-------- '+ quantidadeDePedidos +' -------- <br> ';
        listaPedido += document.getElementById('telaFinalizarPedidoTexto').innerHTML;
        
        //para identificar se o numero é float ou inteiro
        if (totalPagar % 1 === 0) {

            listaPedido += 'Total = R$ ' + totalPagar + ',00 <br> ';

        }else{

            // para identificar se o numero tem 2 casas depois da vigula
            if ((totalPagar * 10) % 1 === 0) {
                
                listaPedido += ('Total = R$ ' + totalPagar + '0 <br>').replace('.', ',');

            }else{

                listaPedido += ('Total = R$ ' + totalPagar + ' <br> ').replace('.', ',');
                
            }
        }
        
        console.log(listaPedido);
        localStorage.setItem('historicoDePedidos', listaPedido);

        quantidadeDePedidos++;
        localStorage.setItem('quantidadeDePedidos', quantidadeDePedidos)
        fecharTela();
        resetarPedidos();  
    } 
}

function exibirHistorico() {
    document.getElementById('historico').style.display = 'block';
    document.getElementById('textoHistorico').innerHTML = localStorage.getItem('historicoDePedidos') +' <br> .'
}

function calcularTroco() {
    let totalPagar = parseFloat(localStorage.getItem('totalPedido'));
    let valorRecebido = document.getElementById('inputPago').value;
    let caixaTroco = document.querySelector('#caixaTroco');

    if (valorRecebido == '4321') {
        fecharTela();
        exibirHistorico();
    }
    if (valorRecebido == '0000000000000') {
        localStorage.setItem('quantidadeDePedidos', 1);
        localStorage.setItem('historicoDePedidos', '');
        alert('Histórico Resetado');
    }

    totalPagar -= valorRecebido;
    if (totalPagar > 0) {
        caixaTroco.style.color = '#ff8686'
    }else{
        caixaTroco.style.color = '#86d9ff'
    }

    //para identificar se o numero é float ou inteiro
    if (totalPagar % 1 === 0) {

        caixaTroco.textContent = 'R$ ' + totalPagar*-1 + ',00';

    }else{

        // para identificar se o numero tem 2 casas depois da vigula
        if ((totalPagar * 10) % 1 === 0) {
            
            caixaTroco.textContent = ('R$ ' + totalPagar*-1 + '0').replace('.', ',');

        }else{

            caixaTroco.textContent = ('R$ ' + totalPagar*-1).replace('.', ',');
            
        }
    }


}

function download(filename, textInput) {
    let element = document.getElementById("botaoDownload");
    element.setAttribute('href','data:text/plain;charset=utf-8, ' + encodeURIComponent(textInput));
    element.setAttribute('download', filename);
    // element.click();
    //document.body.removeChild(element);
}
document.getElementById("botaoDownload")
    .addEventListener("click", function () {
          var text = document.getElementById("textoHistorico").innerHTML;
          var filename = "Historico_de_pedidos.txt";
          download(filename, text.replace(/<br>/g, '\n'));
    }, false);


criarbotoes(container, cardapio);

