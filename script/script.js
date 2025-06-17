var listaCaixaDeTexto = [];

function registerServiceWorker() {
  // registrando o service worker para navegadores com suporte
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker
      .register("https://elvis-almeida.github.io/App-pedidos/sw.js", {
        scope: "../",
      })
      .then(() => {
        console.log("Service Worker registrado com sucesso.");
      })
      .catch((error) => {
        console.log("Service Worker falhou:", error);
      });
  }
}

let timerId;

function startTimer(bloco) {
  console.log("clicou");
  timerId = setTimeout(function () {
    bloco.style.width = "0px";
    bloco.style.height = "0px";
    bloco.children[1].style.fontSize = "0px";
    setTimeout(() => {
      bloco.remove();
    }, 500);
    console.log("Botão/touch foi mantido pressionado por mais de 3 segundos!");
  }, 3000);
}

function stopTimer() {
  clearTimeout(timerId);
}

function criarbotoes(
  container,
  cardapio,
  idCaixaDeTextoDePedidos,
  idCaixaDePrecoDePedidos
) {
  let temp = "";
  for (let i = 0; i < cardapio.length; i++) {
    temp +=
      "<div onclick='adicionarAoPedido(`" +
      cardapio[i][0] +
      "`," +
      cardapio[i][1] +
      ",`" +
      idCaixaDeTextoDePedidos +
      "`,`" +
      idCaixaDePrecoDePedidos +
      "`)' class='bloco'>  <div class='blocoImagem' style='background-image: url(" +
      cardapio[i][2] +
      ");background-repeat: no-repeat;background-size: contain;'>  </div>  <div class='blocoTexto'>" +
      cardapio[i][0] +
      "</div>  </div>";
  }
  container.innerHTML =
    '<div id="espaçoEmBranco"></div>' +
    temp +
    "<div id='espacoEmBrancoDeBaixo'></div>";
}

// cria string para caixa de texto
function formatarLista(lista, quebrarlinha = false) {
  let resultado = "";
  let produtos = {};

  for (let i = 0; i < lista.length; i++) {
    const produto = lista[i];
    if (produtos.hasOwnProperty(produto)) {
      produtos[produto]++;
    } else {
      produtos[produto] = 1;
    }
  }

  c = 0;
  for (let produto in produtos) {
    if (c == 0) {
      resultado += `${produtos[produto]} ${produto},`;
    } else {
      resultado += ` ${produtos[produto]} ${produto},`;
    }
    c = 1;
    if (quebrarlinha) {
      resultado += "<br>";
    }
  }
  console.log(resultado);

  return resultado;
}

function adicionarAoPedido(
  Nome,
  preco,
  idCaixaDeTextoDePedidos,
  idCaixaDePrecoDePedidos
) {
  let caixaDeTextoDePedidos = document.querySelector(idCaixaDeTextoDePedidos);
  let caixaDePrecoDePedidos = document.querySelector(idCaixaDePrecoDePedidos);

  console.log(Nome + " " + preco);
  listaCaixaDeTexto.push(Nome);

  let totalPagar = parseFloat(localStorage.getItem("totalPedido"));
  totalPagar += preco;

  caixaDePrecoDePedidos.textContent = formatarNumero("", totalPagar, "");

  // criando histórco de inserção
  let historicoDeInserção = localStorage.getItem("historicoDeInserção");
  historicoDeInserção += "," + preco;
  localStorage.setItem("historicoDeInserção", historicoDeInserção);
  localStorage.setItem("totalPedido", totalPagar);

  // add texto caixa de texto

  caixaDeTextoDePedidos.textContent = formatarLista(listaCaixaDeTexto);
}

function resetarPedidos(
  idCaixaDeTextoDePedidos,
  idCaixaDePrecoDePedidos,
  idInputTroco,
  idCaixaDeTextoTroco
) {
  document.querySelector(idCaixaDeTextoDePedidos).textContent = "";
  document.querySelector(idCaixaDePrecoDePedidos).textContent = "R$ 0,00";

  document.querySelector(idInputTroco).value = "";
  document.querySelector(idCaixaDeTextoTroco).textContent = "R$ 0,00";

  listaCaixaDeTexto = [];

  localStorage.setItem("historicoDeInserção", "");
  localStorage.setItem("totalPedido", 0);
}

function finalizarPedido(
  idTelaFinalizarPedido,
  idCaixaDeTextoDePedidos,
  idCaixaTotal,
  idTelaFinalizarPedidoTexto,
  idInputTroco
) {
  let telaFinalizarPedido = document.querySelector(idTelaFinalizarPedido);
  let caixaDeTexto = document.querySelector(idCaixaDeTextoDePedidos);
  let telaTotal = document.querySelector(idCaixaTotal);
  let telaFinalizarPedidoTexto = document.querySelector(
    idTelaFinalizarPedidoTexto
  );
  let totalPagar = parseFloat(localStorage.getItem("totalPedido"));

  telaFinalizarPedido.style.display = "block";
  telaTotal.textContent = formatarNumero("", totalPagar, "");
  document.querySelector(idInputTroco).focus();

  telaFinalizarPedidoTexto.innerHTML = formatarLista(listaCaixaDeTexto, true);
}

function apagarPedido(idCaixaDeTextoDePedidos, idCaixaDePrecoDePedidos) {
  let totalPagar = parseFloat(localStorage.getItem("totalPedido"));
  let historicoDeInsercao = localStorage.getItem("historicoDeInserção");

  let caixaDePreco = document.querySelector(idCaixaDePrecoDePedidos);
  let caixaDeTexto = document.querySelector(idCaixaDeTextoDePedidos);

  // apagando o ultimo item da lista
  historicoDeInsercao = historicoDeInsercao.split(",");
  ultimoValor = historicoDeInsercao.slice(historicoDeInsercao.length - 1);
  localStorage.setItem(
    "historicoDeInserção",
    historicoDeInsercao.slice(0, historicoDeInsercao.length - 1)
  );

  console.log(ultimoValor);

  // apagando o ultimo valor da lista
  totalPagar -= ultimoValor;
  localStorage.setItem("totalPedido", totalPagar);

  caixaDePreco.textContent = formatarNumero("", totalPagar, "");
  listaCaixaDeTexto.pop();
  caixaDeTexto.textContent = formatarLista(listaCaixaDeTexto);
}

function fecharTela(
  idInputTroco,
  idTelaFinalizarPedido,
  idCaixaHistorico,
  idCaixaDeTextoTroco
) {
  document.querySelector(idInputTroco).value = "";
  document.querySelector(idTelaFinalizarPedido).style.display = "none";
  document.querySelector(idCaixaHistorico).style.display = "none";
  document.querySelector(idCaixaDeTextoTroco).textContent = "R$ 0,00";
}

function formatarNumero(prefixo, numero, sufixo) {
  //para identificar se o numero é float ou inteiro
  if (numero % 1 === 0) {
    return prefixo + "R$ " + numero + ",00" + sufixo;
  } else {
    // para identificar se o numero tem 2 casas depois da vigula
    if ((numero * 10) % 1 === 0) {
      return prefixo + ("R$ " + numero + "0").replace(".", ",") + sufixo;
    } else {
      return prefixo + ("R$ " + numero + "").replace(".", ",") + sufixo;
    }
  }
}

function gerarDataAtual() {
  let data = new Date();
  let dia = String(data.getDate()).padStart(2, "0");
  let mes = String(data.getMonth() + 1).padStart(2, "0");
  let ano = data.getFullYear();
  let horas = String(data.getHours()).padStart(2, "0");
  let minutos = String(data.getMinutes()).padStart(2, "0");

  dataAtual = dia + "/" + mes + "/" + ano + " - " + horas + ":" + minutos;
  console.log(dataAtual);
  return dataAtual;
}

function salvarNoHistorico(
  idTelaFinalizarPedidoTexto,
  idInputTroco,
  idTelaFinalizarPedido,
  idCaixaHistorico,
  idCaixaDeTextoTroco,
  idCaixaDeTextoDePedidos,
  idCaixaDePrecoDePedidos
) {
  let totalPagar = parseFloat(localStorage.getItem("totalPedido"));
  let quantidadeDePedidos = parseInt(
    localStorage.getItem("quantidadeDePedidos")
  );
  let listaPedido = localStorage.getItem("historicoDePedidos");
  let caixaDeTexto = document.querySelector(
    idCaixaDeTextoDePedidos
  ).textContent;
  let historicoResumo;
  let totalGeral = parseFloat(localStorage.getItem("totalGeral"));

  historicoResumo = localStorage.getItem("historicoResumo");
  totalGeral += totalPagar;

  if (historicoResumo == "") {
    historicoResumo += caixaDeTexto;
  } else {
    historicoResumo += " + " + caixaDeTexto;
  }

  localStorage.setItem("totalGeral", totalGeral);
  localStorage.setItem("historicoResumo", historicoResumo);

  listaPedido +=
    "-------- " +
    quantidadeDePedidos +
    " -------- <br> " +
    gerarDataAtual() +
    " <br> <br> ";
  listaPedido += document.querySelector(idTelaFinalizarPedidoTexto).innerHTML;

  listaPedido += formatarNumero("Total = ", totalPagar, " <br> <br> ");
  localStorage.setItem("historicoDePedidos", listaPedido);

  quantidadeDePedidos++;
  localStorage.setItem("quantidadeDePedidos", quantidadeDePedidos);

  fecharTela(
    idInputTroco,
    idTelaFinalizarPedido,
    idCaixaHistorico,
    idCaixaDeTextoTroco
  );
  resetarPedidos(
    idCaixaDeTextoDePedidos,
    idCaixaDePrecoDePedidos,
    idInputTroco,
    idCaixaDeTextoTroco
  );
}

function exibirHistorico() {
  document.getElementById("historico").style.display = "block";
  document.getElementById("textoHistorico").innerHTML =
    localStorage.getItem("historicoDePedidos") + " <br> .";
}

function calcularTroco(
  idInputTroco,
  idCaixaDeTextoTroco,
  idTelaFinalizarPedido,
  idCaixaHistorico
) {
  let totalPagar = parseFloat(localStorage.getItem("totalPedido"));
  let valorRecebido = document.querySelector(idInputTroco);
  let caixaTroco = document.querySelector(idCaixaDeTextoTroco);

  let inputValue = valorRecebido.value;
  let numericValue = inputValue.replace(/[^0-9]/g, "");
  valorRecebido.value = numericValue;

  if (numericValue == "11111") {
    criarbotoes(
      container,
      cardapio,
      idCaixaDeTextoDePedidos,
      idCaixaDePrecoDePedidos
    );
  }
  if (numericValue == "4321") {
    fecharTela(
      idInputTroco,
      idTelaFinalizarPedido,
      idCaixaHistorico,
      idCaixaDeTextoTroco
    );
    exibirHistorico();
  }
  if (numericValue == "0000000000000") {
    localStorage.setItem("quantidadeDePedidos", 1);
    localStorage.setItem("historicoDePedidos", "");
    localStorage.setItem("historicoResumo", "");
    localStorage.setItem("totalGeral", 0);

    alert("Histórico Resetado");
  }

  totalPagar -= numericValue;
  if (totalPagar > 0) {
    caixaTroco.style.color = "#ff8686";
  } else {
    caixaTroco.style.color = "#86d9ff";
  }

  caixaTroco.textContent = formatarNumero("", totalPagar * -1, "");
}

function gerarHistoricoResumido() {
  let totalGeral = parseFloat(localStorage.getItem("totalGeral"));
  return (
    "Arquivo gerado em " +
    gerarDataAtual() +
    "\n\n" +
    formatarTextoDePedidos(localStorage.getItem("historicoResumo")) +
    " <br> Total = " +
    formatarNumero("", totalGeral, "")
  );
}

// let verificar = gerarDataAtual();
// verificar = String(verificar).split('/');
// let tem = String(verificar[2]).split(' - ');
// verificar[2] = tem[0]
// verificar[3] = tem[1].split(':')[0]
// verificar[4] = tem[1].split(':')[1]
// console.log(verificar);

// if (!(parseInt(verificar[0]) >= 24 && parseInt(verificar[1]) >= 5 && parseInt(verificar[3]) >= 11 && parseInt(verificar[4]) >= 40)) {

// ------------- principal -------------
let container = document.getElementById("container");
let cardapio = [
  ["Caldo P", 3, "./images/alimentos/caldo_p.png"],
  ["Caldo G", 5, "./images/alimentos/caldo.png"],
  ["Canjica P", 3, "./images/alimentos/canjica_p.png"],
  ["Canjica G", 5, "./images/alimentos/canjica.png"],
  ["Espetinho", 18, "./images/alimentos/espetinho.png"],
  ["Galin. caip.", 20, "./images/alimentos/galinha_caip.png"],
  ["Crepe", 5, "./images/alimentos/crepe.png"],
  ["Misto", 5, "./images/alimentos/misto.png"],
  ["C. quente", 5, "./images/alimentos/cachorro_quente.png"],
  ["Coca-cola", 15, "./images/alimentos/coca-cola.png"],
  ["Fanta", 15, "./images/alimentos/fanta.png"],
  ["Antarctica", 15, "./images/alimentos/guarana_antarctica.png"],
  ["River", 10, "./images/alimentos/river.png"],
  ["Rivinho", 3, "./images/alimentos/Pitchula.png"],
  // ["Copo refri", 2, "./images/alimentos/copo_de_refri.png"],
  ["Copo suco", 5, "./images/alimentos/copo_de_suco.png"],
  ["Jarra suco", 15, "./images/alimentos/jarra_de_suco.png"],
  ["Bolo pote", 7, "./images/alimentos/bolo_no_pote.png"],
  ["Água min.", 3, "./images/alimentos/Garrafa_de_água.png"],
  ["Pula pula", 5, "./images/alimentos/pula_pula.png"],
];

// Id caixas de textos principais
let idCaixaDeTextoDePedidos = "#caixaDeTexto>p";
let idCaixaDePrecoDePedidos = "#caixaDePreco";

// Id caixas de textos tela finalizar pedido
let idInputTroco = "#inputPago";
let idCaixaDeTextoTroco = "#caixaTroco";
let idTelaFinalizarPedido = "#telaFinalizarPedido";
let idCaixaTotal = "#caixaTotal";
let idTelaFinalizarPedidoTexto = "#telaFinalizarPedidoTexto";

// Id caixa tela histórico
let idCaixaHistorico = "#historico";
let idCaixaHistoricoTexto = "#textoHistorico";

// Id botões pricipais
let idBotaoResetar = "#resetar";
let idBotaoFinalizarPedido = "#finalizarPedido";
let idBotaoApagar = "#apagar";

// Id botões tela finalizar pedidos
let idBotaoFecharTelaDePedidos = "#botaoFechar";
let idBotaoSalvarNoHistorico = "#botaoCalcular";

// Id botões tela histórico
let idBotaoFecharHistorico = "#botaoFecharHistorico";
let idBotaoDownload = "#botaoDownload";

// Id caixa de confirmação
let caixaDeConfirmacaoDeSalvamento = "#caixaDeConfirmacaoDeSalvamento";
let textoDeConfirmacao = "#textoDeConfirmacao";
let caixaDeConfirmacao = "#caixaDeConfirmacao";
let caixaDeConfirmacaoFechar = "#caixaDeConfirmacaoFechar";

// adcionando eventos nos botões
document.querySelector(idBotaoResetar).addEventListener("click", function () {
  resetarPedidos(
    idCaixaDeTextoDePedidos,
    idCaixaDePrecoDePedidos,
    idInputTroco,
    idCaixaDeTextoTroco
  );
});
document
  .querySelector(idBotaoFinalizarPedido)
  .addEventListener("click", function () {
    finalizarPedido(
      idTelaFinalizarPedido,
      idCaixaDeTextoDePedidos,
      idCaixaTotal,
      idTelaFinalizarPedidoTexto,
      idInputTroco
    );
  });
document.querySelector(idBotaoApagar).addEventListener("click", function () {
  apagarPedido(idCaixaDeTextoDePedidos, idCaixaDePrecoDePedidos);
});

document
  .querySelector(idBotaoFecharHistorico)
  .addEventListener("click", function () {
    fecharTela(
      idInputTroco,
      idTelaFinalizarPedido,
      idCaixaHistorico,
      idCaixaDeTextoTroco
    );
  });
document
  .querySelector(idBotaoFecharTelaDePedidos)
  .addEventListener("click", function () {
    fecharTela(
      idInputTroco,
      idTelaFinalizarPedido,
      idCaixaHistorico,
      idCaixaDeTextoTroco
    );
  });
document
  .querySelector(idBotaoSalvarNoHistorico)
  .addEventListener("click", function () {
    // if (
    //   document.querySelector(idTelaFinalizarPedidoTexto).innerHTML !=
    //   "1 -  <br> "
    // ) {
    //   document.querySelector(caixaDeConfirmacaoDeSalvamento).style.display =
    //     "block";
    // }
    salvarNoHistorico(
      idTelaFinalizarPedidoTexto,
      idInputTroco,
      idTelaFinalizarPedido,
      idCaixaHistorico,
      idCaixaDeTextoTroco,
      idCaixaDeTextoDePedidos,
      idCaixaDePrecoDePedidos
    );
    document.querySelector(caixaDeConfirmacaoDeSalvamento).style.display =
      "none";
  });
document
  .querySelector(caixaDeConfirmacaoFechar)
  .addEventListener("click", function () {
    document.querySelector(caixaDeConfirmacaoDeSalvamento).style.display =
      "none";
  });
document
  .querySelector(caixaDeConfirmacao)
  .addEventListener("click", function () {
    salvarNoHistorico(
      idTelaFinalizarPedidoTexto,
      idInputTroco,
      idTelaFinalizarPedido,
      idCaixaHistorico,
      idCaixaDeTextoTroco,
      idCaixaDeTextoDePedidos,
      idCaixaDePrecoDePedidos
    );
    document.querySelector(caixaDeConfirmacaoDeSalvamento).style.display =
      "none";
  });

// document.querySelector(idBotaoSalvarNoHistorico).addEventListener(   "click", function() {    salvarNoHistorico(idTelaFinalizarPedidoTexto, idInputTroco, idTelaFinalizarPedido, idCaixaHistorico, idCaixaDeTextoTroco, idCaixaDeTextoDePedidos, idCaixaDePrecoDePedidos)     });

// adicionando evento de calcular no input
document.querySelector(idInputTroco).addEventListener("keyup", function () {
  calcularTroco(
    idInputTroco,
    idCaixaDeTextoTroco,
    idTelaFinalizarPedido,
    idCaixaHistorico
  );
});

// adicionando função de download do histórico
document.querySelector(idBotaoDownload).addEventListener("click", function () {
  let text = document.querySelector(idCaixaHistoricoTexto).innerHTML;
  let textoResumo = gerarHistoricoResumido();
  let resumo = document.createElement("a");

  this.setAttribute(
    "href",
    "data:text/plain;charset=utf-8, " +
      encodeURIComponent(text.replace(/<br>/g, "\n"))
  );
  this.setAttribute("download", "Historico_de_pedidos.txt");

  resumo.setAttribute(
    "href",
    "data:text/plain;charset=utf-8, " +
      encodeURIComponent(textoResumo.replace(/<br>/g, "\n"))
  );
  resumo.setAttribute("download", "Historico_resumo.txt");

  setTimeout(() => {
    resumo.click();
    resumo.remove();
  }, 5000);
});

// ------------------ funções -------------------
localStorage.setItem("totalPedido", 0);
localStorage.setItem("historicoDeInserção", "");

if (!localStorage.getItem("quantidadeDePedidos")) {
  localStorage.setItem("quantidadeDePedidos", 1);
}
if (!localStorage.getItem("historicoResumo")) {
  localStorage.setItem("historicoDePedidos", "");
  localStorage.setItem("historicoResumo", "");
  localStorage.setItem("totalGeral", 0);
}

criarbotoes(
  container,
  cardapio,
  idCaixaDeTextoDePedidos,
  idCaixaDePrecoDePedidos
);
registerServiceWorker();

// }
