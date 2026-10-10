# App de pedidos

### Um **Web App** simples para quem vende com dinheiro em eventos: monta o pedido, soma o total e calcula o troco

<table>
  <tr>
    <td><img src='./images/screenshots/f4.jpeg' width='100%'></td>
    <td><img src='./images/screenshots/f1.jpeg' width='100%'></td>
    <td><img src='./images/screenshots/f2.jpeg' width='100%'></td>
    <td><img src='./images/screenshots/f3.jpeg' width='100%'></td>
  </tr>
</table>

Esse app nasceu de uma dor que percebi nos eventos festivos da igreja: muitas opções de venda com preços diferentes, muita gente para atender e pedidos longos, o que dificultava somar o total e calcular o troco.

## Como usar

- **Toque nos itens** para montar o pedido. O topo mostra cada item com a quantidade e o total já somado; cada card mostra quantas unidades estão no pedido.
- **Apagar** tira o último item tocado. **Resetar** limpa o pedido (aparece um botão "Desfazer" por alguns segundos).
- **Finalizar** abre o resumo. Digite o valor recebido ou toque nas notas (+2, +5, +10, +20, +50, +100, "Exato") e o troco aparece na hora (ou quanto falta, em vermelho).
- **Salvar** guarda o pedido no histórico com data, hora, itens, valor recebido e troco.
- **Pix (opcional):** com o Pix ligado no menu, a tela Finalizar já abre com o QR Code no valor do pedido. O cliente lê o código, você confere o recebimento no app do banco e toca em **Pago no Pix**. Se o cliente pagar em dinheiro, é só digitar ou tocar numa nota: o QR some e a tela volta ao normal. O relatório separa o que entrou em dinheiro e no Pix.
- O pedido em andamento não se perde se o app fechar ou o celular reiniciar.

## Menu secreto

**Toque 5 vezes rápido no topo da tela** (área do pedido). O menu tem quatro abas:

- **Resumo** — total arrecadado, número de pedidos, itens vendidos, ticket médio e o ranking de vendas por item. Botões para baixar ou compartilhar o relatório (.txt) e para zerar o histórico no começo de um novo evento.
- **Pedidos** — todos os pedidos salvos. "Desfazer último pedido" tira o último do histórico e devolve os itens para a tela (para corrigir). Também dá para excluir qualquer pedido.
- **Devolver item** — em cada pedido salvo. Se faltou um item e o cliente voltou para pegar o dinheiro, toque em − no item, e o app mostra quanto devolver. O item sai do pedido, o total do evento diminui e a devolução fica registrada no pedido e no relatório.
- **Pix** — liga o QR Code Pix no fim do pedido (vem desligado). Escolha o tipo de chave, digite a chave, o nome de quem recebe e a cidade. Aparece um QR de teste de R$ 1,00 para conferir com o app do banco antes do evento.
- **Itens** — liga/desliga cada item. O que estiver desligado fica cinza na tela de vendas, marcado como **Esgotado**, e não entra no pedido.

## Dados

Tudo fica salvo **no próprio aparelho** (IndexedDB), funciona sem internet e não vai para nenhum servidor. Cada celular tem o seu próprio histórico. Na primeira abertura desta versão, o histórico da versão antiga é importado automaticamente.

## Para quem mantém o app

- **Cardápio e preços:** `script/cardapio.js`. Imagens em `images/alimentos/` (WebP, ~256 px).
- **Ao publicar qualquer mudança**, aumente a `VERSAO` em `sw.js`, senão os celulares que já instalaram o app continuam com a versão antiga.
- Sem build: é só HTML, CSS e JavaScript (módulos ES). Para testar no computador, rode um servidor local (ex.: `python3 -m http.server`) e abra `http://localhost:8000` — abrir o `index.html` direto não funciona por causa dos módulos.

| Arquivo | O que faz |
| --- | --- |
| `script/app.js` | Tela principal e finalizar pedido |
| `script/menu.js` | Menu secreto (resumo, pedidos, itens) |
| `script/db.js` | Banco local (IndexedDB) |
| `script/relatorio.js` | Totais e arquivo do relatório |
| `script/migracao.js` | Importa o histórico da versão antiga |
| `script/ui.js` | Telas, confirmações e avisos |
| `script/dinheiro.js` | Formatação de valores (em centavos) |
| `script/pix.js` | Código Pix (BR Code) e QR Code, gerados no aparelho |
| `script/vendor/qrcode.js` | Biblioteca de QR Code (Kazuhiko Arase, licença MIT) |

Acesse o app: [elvisalmeida.com.br](https://elvisalmeida.com.br/)
