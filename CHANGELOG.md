# Changelog

Versões anteriores à 1.6.2: ver `git log` (cada release é um commit `vX.Y.Z: …`).

## 1.6.4 (10/11/2026): o POST 2 sai do formulário do site

**Problema:** Tauá Atibaia, 2 adultos + crianças de 2 e 7. Três tentativas (v1.6.1, v1.6.2,
v1.6.3) com HTTP 500 no POST 2, já com idades certas e o `comId` da criança sem cadastro fora.

**O que ainda era diferente do site** (no modo results, painel aberto na tela de resultados):
- O painel montava o `bookingPaxes` com um builder próprio: 16 campos fixos, `idTDC` sempre `4`,
  `tipoSocio` vazio sem número. O site serializa o **formulário** que o POST 1 devolve
  (`$jbe.bookingPaxes.getPaxesInfo`): manda cada campo que a linha tem, com o padrão de cada
  `<select>` daquela linha, e não manda o que a linha não tem. Desde agosto o serializer do site
  ganhou o campo `gender` (`pax-gender`); o JS do site também preenche, com CPF, os campos
  escondidos de expedição/validade do documento (`data-cpf-date`) — o painel nunca mandava nada disso.
- `comId` do topo: o site junta o `comId` de **todas** as linhas na ordem, vazios inclusive
  (`$jbe.getFormParams`): `cpf1,cpf2,cpf3,` quando a 4ª não tem cadastro. O painel mandava só os
  preenchidos (`cpf1,cpf2,cpf3` na v1.6.3; na v1.6.2, o CPF da criança sem cadastro no lugar do vazio).
  Com 2 adultos consultados as duas formas são iguais — por isso agosto funcionou.

**O que mudou:**
- Modo results: o HTML do POST 1 fica guardado; o POST 2 preenche as linhas **desse formulário**
  (fora da página, num `DOMParser`: nada roda, nada carrega) e serializa com uma cópia fiel do
  `getPaxesInfo` de 10/11/2026 e do `getFormParams` do site (`$jbe.getFormParams` da própria página
  quando existe). Parâmetros e limpeza de vazios iguais ao `Booking1.getParams`/`addToBasket`. O POST 2
  vai para a URL final do POST 1.
- Preenchimento igual ao do site: CPF só se a linha oferece CPF; com CPF, o efeito do handler do
  tipo de documento (`data-cpf-date`); "Validar CPF" com cadastro também põe e-mail, telefone e
  nacionalidade da consulta nos campos que existirem; `comId` da linha só para quem tem cadastro.
- Campo **obrigatório** do formulário que o painel não conhece (ex.: Sexo/`pax-gender`): o painel
  mostra o campo com as opções do próprio formulário e barra o POST 2 até ser preenchido.
- Linha sem campo de documento (ex.: criança): o painel não exige documento dela.
- POST 1 que volta a caixa de login (tudoazul sem sessão): para com mensagem, sem POST 2.
- Modo form (painel na booking.aspx): o `comId` do topo não é mais sobrescrito — vai o do formulário.
- POST 1 sem formulário ("pontos insuficientes"): builder próprio como antes, `comId` com uma
  posição por passageiro.
- 🩺 Diagnóstico ganha: o formulário do POST 1 por linha (nomes dos campos, padrões dos `<select>`,
  obrigatórios extras, hidden-fields) e a forma do POST 2 (chaves, `idTDC`, posições do `comId`).
  Nenhum valor digitado.
- Testes: `test/test_post2_formulario.js` com o formulário real do www (13/08) como fixture e
  comparação byte a byte com o serializer real do site quando o JS dele está salvo na workspace.

## 1.6.3 (10/11/2026)

- POST 2: `comId` só leva o CPF de quem a consulta confirmou como cliente Azul. Criança sem consulta (ou com "sem cadastro") não vai mais no `comId` — mandar o CPF dela derrubava a reserva com HTTP 500 mesmo com idades e dados certos. Adulto sem consulta continua indo, como antes.

## 1.6.2 (09/11/2026): idade das crianças e trava do POST 2

**Problema:** busca com 2 adultos + crianças de 7 e 4 (`paxs=22&ages=0704`). O POST 2
foi com crianças de **2 e 7**, uma delas sem nome/nascimento (consulta do CPF em erro,
a outra ainda rodando), e o site respondeu HTTP 500 ("Desculpe-nos, houve um erro").

**Causa:**
- Depois do POST 1, o painel trocava os passageiros pelas linhas da tela de reserva do
  site (`data-pax-age`) **sem conferir com as idades da busca**, e levava o que tinha
  sido digitado/consultado **por posição**. As idades da tela de reserva viravam o
  `paxAge` do POST 2, e os dados de uma criança iam parar na outra.
- Nada impedia o POST 2: criança sem idade, sem nome, sem nascimento, com a consulta
  do CPF em erro ou ainda rodando, e nascimento que não dá a idade da busca no
  check-in. Tudo isso era aviso dentro do `confirm()`. O formulário do site barra
  esses casos (`isValidAge` exige a idade exata no check-in), mas o atalho pula o formulário.
- Uma consulta de CPF que estivesse rodando quando a pessoa clicava em Continuar
  ficava em "…" para sempre (atualizava o objeto antigo).

**O que mudou:**
- Idades lidas de três fontes conferidas entre si: o JSON da barra de busca de hotéis
  (`data-room-selector-data`), o seletor de quartos do site (`roomSelector('val')`, ou os
  `<select>` lidos como o site lê) e `paxs`/`ages` na URL. O buscador de pacote
  (trip-searcher) é ignorado. Fontes divergentes deixam a idade em branco e o painel
  pede o valor. O fallback pelo resumo textual não chuta mais 5 anos.
- Depois do POST 1: se as idades das crianças na tela de reserva não forem as mesmas da
  busca, o POST 2 **não vai** e o painel mostra as duas listas. Se forem as mesmas em
  outra ordem, os dados casam pela idade.
- `problemas()` barra o envio, antes do POST 1 e de novo antes do POST 2, nestes casos:
  consulta de CPF rodando ou em erro, documento/nome/nascimento faltando, criança sem
  idade, nascimento que não dá a idade da busca no check-in (a regra do site), adulto
  abaixo da idade mínima, composição diferente do `distribution` do motor.
- O padrão salvo casa cada criança pela idade no check-in, não pela posição.
- Consulta de CPF com tempo-limite de 20 s. "Consultar CPFs" não roda em dobro.
- Erro no POST 2: a mensagem diz o que foi conferido e aponta a causa provável.
- 🩺 Diagnóstico ganha: idades da busca por fonte, linhas da tela de reserva
  (tipo/idade/data), o que foi no POST 2 (só tipo e idade) e o que bloqueou. Nenhum dado
  pessoal.
- `build_bookmarklet.js` acha o fonte em `src/`. `npm test` roda o teste offline (jsdom).
