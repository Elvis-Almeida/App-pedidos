# Vendas Online

Versão com servidor do app de pedidos. Para quem atende, o app é o mesmo. A diferença é que agora:

- os pedidos de **todos os aparelhos** vão para um servidor central (Django + PostgreSQL);
- cada aparelho entra com um **código de convite** ligado ao nome de uma pessoa e **fica conectado para sempre**;
- cardápio (fotos e preços), nome do app, logo, favicon e Pix são configurados no **admin**;
- esgotados e Pix mudados num aparelho **valem para todos**, e o admin pode **bloquear** essas edições;
- o admin tem um **dashboard** com cruzamentos e sugestões;
- o app **continua funcionando sem internet**: as vendas ficam guardadas no celular e sobem quando a conexão volta.

Endereços em produção:

| | |
|---|---|
| App | https://vendas.elvisalmeida.com.br |
| Admin e dashboard | https://vendas.elvisalmeida.com.br/admin |
| Homologação | https://vendas-dev.elvisalmeida.com.br |

---

## Primeiro uso (depois do deploy)

1. Entre no admin com o usuário `elvis` e a senha mostrada pelo `deploy.sh`.
2. **Configuração**: nome do app, nome curto, logo (gera sozinho os ícones de Android, iPhone e da aba), favicon, Pix e bloqueios.
3. **Itens do cardápio**: o cardápio original já vem carregado, com fotos. Ajuste preços (em reais), troque fotos, mude a ordem ou tire itens do app desmarcando **No cardápio**.
4. **Eventos**: crie o evento (ex.: "Festa Junina 2027") e marque **Evento atual**. Se ninguém criar, o primeiro pedido do dia abre um "Vendas de dd/mm/aaaa".
5. **Pessoas**: cadastre quem vai vender. Ao salvar, um **código de convite** é criado na hora. Abra o convite: ele tem **QR Code e link**. A pessoa lê o QR com o celular e o app já abre conectado. Também dá para digitar o código na tela inicial.

Cada convite vale para **um aparelho**. Para outro celular da mesma pessoa, use a ação "Gerar código de convite" na lista de Pessoas.

## No celular

- **Selo no canto do topo:** sem nada (ponto verde) significa tudo enviado; "3 pendentes" significa enviando; "offline · 3" significa sem internet, com as vendas guardadas.
- **Numeração dos pedidos:** cada aparelho tem um prefixo, como `#EA-12` (Elvis Almeida, 12º pedido do evento). Não há conflito entre aparelhos, mesmo offline.
- **Menu secreto (5 toques no topo):**
  - Resumo e Pedidos com o filtro **Meus / Todos os aparelhos**.
  - Em "Todos", aparece também **Vendas por pessoa**.
  - Só o aparelho que vendeu pode alterar um pedido.
  - O antigo "Zerar histórico" não existe mais: o admin encerra o evento e abre outro.

## Bloqueios

| Onde | O que trava |
|---|---|
| Configuração → Bloquear esgotados nos aparelhos | ninguém marca/desmarca esgotado pelo celular |
| Configuração → Bloquear Pix nos aparelhos | ninguém muda o Pix pelo celular |
| Configuração → Bloquear alteração de pedidos enviados | depois que o pedido chegou ao servidor, nenhum aparelho devolve item, desfaz ou exclui |
| Aparelhos → colunas "pode…" | o mesmo, mas só para aquele aparelho |
| Aparelhos → desmarcar "ativo" | desconecta o aparelho (ele volta para a tela de convite) |

Um pedido feito offline e corrigido **antes** de chegar ao servidor pode ser alterado mesmo com bloqueio, porque ele ainda não tinha sido enviado.

Tentativas bloqueadas ficam no **Registro de alterações**, junto com quem marcou esgotado, quem mudou o Pix, devoluções e cancelamentos.

## Dashboard

O filtro no topo (evento e pessoa) vale para a página inteira. **Exportar CSV** baixa uma linha por item vendido, que abre direto no Excel ou no Google Sheets.

- **Indicadores:** total arrecadado, dinheiro e Pix, pedidos, ticket médio, itens por pedido, ritmo (pedidos por hora), devoluções e cancelamentos, com variação em relação ao evento anterior.
- **"O que os dados dizem":** frases automáticas sobre o pico, o item campeão, o que esgotou e quanto deixou de vender, a pessoa mais ágil, o melhor combo, o fundo de troco e a comparação com o evento anterior.
- **Movimento:**
  - Num evento, mostra os pedidos a cada 15 min; em "todos os eventos", por hora do dia.
  - Separa dinheiro de Pix.
  - Tem uma versão em tabela.
- **Tamanho dos pedidos** e **como pagam em dinheiro** (valor exato ou qual nota).
- **Por pessoa:** pedidos, valor, ticket, itens por pedido, ritmo por hora ativa, intervalo típico entre pedidos, % no Pix, devoluções e cancelamentos.
- **Itens:**
  - Classe ABC (os que fazem 80% da receita), presença nos pedidos, hora de pico e devoluções.
  - Num evento, mostra também **a que horas esgotou e quanto faltou** (estimado pelo ritmo de venda).
- **Mapa de calor:** item × hora.
- **O que é comprado junto:** pares de itens com chance e "força" acima do acaso, bons candidatos a combo.
- **Fundo de troco sugerido:** valor e notas, calculados a partir da hora mais pesada.
- **Comparação entre eventos** e **quanto preparar no próximo evento** (média dos últimos eventos, somando a demanda perdida quando esgotou, mais 10% de folga).

Para ver o dashboard com dados de mentira (em desenvolvimento ou homologação):

```bash
python manage.py dados_exemplo           # cria eventos/pessoas "[exemplo]"
python manage.py dados_exemplo --apagar  # remove só o que foi criado
```

---

## Desenvolvimento (no seu computador)

```bash
docker compose -f compose.dev.yml up --build
```

- App: http://localhost:8000. Admin: http://localhost:8000/admin, usuário `admin`, senha `admin-dev-123`.
- O código fica montado no container: salvou, recarregou.
- Em desenvolvimento o service worker fica desligado, para o cache não atrapalhar.
- Um convite de teste: crie uma pessoa no admin e abra `http://localhost:8000/?convite=CÓDIGO`.
- No celular (mesma rede Wi-Fi): abra `http://IP-DO-COMPUTADOR:8000`. Sem HTTPS o modo offline não liga, mas todo o resto funciona.

Sem Docker:

```bash
cd backend
cp .env.exemplo .env          # o Django lê este arquivo sozinho
pip install -r requirements.txt
python manage.py preparar     # cria o banco (SQLite), o cardápio e o admin (admin / admin-dev-123)
python manage.py runserver
```

Testes: `cd backend && VENDAS_DEBUG=1 python manage.py test vendas`.

## Produção e homologação (VPS com Docker Swarm + Traefik)

A produção está em `docker-compose.yml`, no mesmo padrão da stack do Lumen:

- serviços `api`, `banco` e `tarefas`;
- segredos como arquivo, raiz somente leitura e healthcheck com hostname;
- limites de tentativas em `/admin` e no convite;
- réplicas `start-first` com rollback.

Os valores padrão do arquivo já são os de produção (`vendas.elvisalmeida.com.br`, rede do Traefik `crononest`).

**Configuração (`.env`):**

```bash
cp .env.exemplo .env
nano .env        # domínio, rede do Traefik, usuário do admin, réplicas…
```

O `.env.exemplo` lista todas as configurações, cada uma explicada. Sem `.env`, valem os padrões de produção.

O `docker stack deploy` **não lê o `.env` sozinho**: só o `docker compose` lê, o Swarm não. Por isso a publicação é sempre pelo `deploy.sh`, que carrega o arquivo antes (aceita arquivo salvo no Windows, com aspas ou `export`). Para ver a configuração final sem publicar nada:

```bash
./deploy.sh --conferir
```

Se quiser rodar na mão, carregue antes: `set -a; . ./.env; set +a; docker stack deploy -c docker-compose.yml vendas`.

| Arquivo | Para quê |
|---|---|
| `.env` (de `.env.exemplo`) | servidor, produção |
| `.env.dev` (de `.env.dev.exemplo`) | servidor, homologação |
| `backend/.env` (de `backend/.env.exemplo`) | rodar o Django no computador, sem Docker |
| nenhum | `docker compose -f compose.dev.yml up` já vem configurado |

Nenhum `.env` entra na imagem Docker nem no git (estão no `.dockerignore` e no `.gitignore`).

**Antes da primeira vez:** crie um registro DNS `A` (ou `CNAME`) para `vendas.elvisalmeida.com.br` apontando para a VPS. O certificado HTTPS vem do Let's Encrypt pelo Traefik (`letsencryptresolver`).

**Publicar** (no nó manager, dentro da pasta do projeto):

```bash
./deploy.sh          # produção
```

O `deploy.sh`:

1. Constrói a imagem `vendas-online:<data-commit>`. A versão nova também faz os celulares baixarem o app atualizado.
2. Cria os segredos que faltam (`vendas_secret_key`, `vendas_db_password`, `vendas_admin_senha`) e **mostra a senha do admin uma única vez**.
3. Roda `docker stack deploy -c docker-compose.yml vendas` e **espera** o serviço ficar saudável. Ao subir, a API:
   - espera o banco;
   - migra (com trava, para duas réplicas não migrarem juntas);
   - carrega o cardápio inicial se estiver vazio;
   - cria o admin.

   Se algo falhar, o Swarm volta para a versão anterior e o script avisa.

Também dá para publicar sem o script, como no Lumen, desde que a imagem e os segredos já existam: `docker stack deploy -c docker-compose.yml vendas`.

**Homologação** (opcional): `cp .env.dev.exemplo .env.dev`, crie o DNS `vendas-dev.elvisalmeida.com.br` e rode `./deploy.sh dev`. O mesmo arquivo vira a stack `vendas-dev`, com banco, fotos, segredos e roteadores próprios.

**Backup automático:** o serviço `tarefas` guarda, uma vez por dia, uma cópia do banco (`banco-AAAA-MM-DD.dump`) e das fotos e logo (`fotos-AAAA-MM-DD.tar.gz`) no volume `vendas_backups`, mantendo 30 dias. Logo depois de cada deploy já sai a cópia do dia.

- `./backup.sh` copia esses arquivos para a pasta `backups/` da VPS, de onde você leva para fora.
- `./backup.sh prod agora` faz uma cópia nova na hora (bom antes de mexer em algo).
- Como restaurar está no próprio `backup.sh`.

**Comandos úteis:**

```bash
docker service ps vendas_api                     # situação das réplicas
docker service logs -f vendas_api                # logs da aplicação
docker service logs vendas_tarefas               # log dos backups
docker exec -it $(docker ps -q -f name=vendas_api | head -1) python manage.py createsuperuser
docker exec -it $(docker ps -q -f name=vendas_api | head -1) python manage.py changepassword elvis
```

### Segurança

- Os segredos chegam como arquivos (`/run/secrets`), nunca como variável de ambiente.
- O container roda com a raiz somente leitura e usuário sem privilégios.
- O banco só fica na rede interna, sem porta publicada.
- O Traefik limita tentativas em `/admin` e no endpoint de convite. O Django também limita o convite por IP.
- O token do aparelho fica guardado no servidor só como hash (SHA-256).
- Há Content-Security-Policy, HSTS e `X-Frame-Options: DENY`.

## Estrutura

```
backend/
  config/settings.py          configuração por variáveis VENDAS_*
  vendas/models.py            dados (configuração, itens, eventos, pessoas, convites, aparelhos, pedidos)
  vendas/api.py               API dos aparelhos (convite, estado, sincronizar)
  vendas/servicos.py          regras da sincronização e dos bloqueios
  vendas/analise.py           cálculos do dashboard
  vendas/admin.py, painel.py  admin e dashboard
  vendas/imagens.py           fotos em WebP, ícones gerados do logo
  vendas/tests/               testes automatizados
  static/app/                 o app (PWA)
  static/painel/              estilo do admin e gráficos do dashboard
  templates/                  telas do admin
Dockerfile, docker-compose.yml (produção), compose.dev.yml (local), deploy.sh, backup.sh
```

Como a sincronização funciona: o celular grava tudo primeiro no próprio banco (IndexedDB) e numa fila. Quando há internet, a fila vai inteira para `/api/sincronizar/`, na ordem em que as coisas aconteceram. Cada operação tem um id único, então reenviar não duplica nada. Em seguida o celular pede `/api/estado/?desde=N` e recebe só o que mudou desde a última vez.
