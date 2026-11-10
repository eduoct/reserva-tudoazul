# Changelog

Versões anteriores à 1.6.2: ver `git log` (cada release é um commit `vX.Y.Z: …`).

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
