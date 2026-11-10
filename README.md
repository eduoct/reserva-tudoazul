# Reserva TudoAzul

Bookmarklet que ajuda no resgate de hotéis do TudoAzul / Azul Viagens: monta os
dados dos passageiros e leva até a tela de confirmação — que é onde fica o campo
de cupom.

**Instalação e instruções:** https://eduoct.github.io/reserva-tudoazul/

> Projeto independente. Sem qualquer vínculo com a Azul Linhas Aéreas ou com a
> Azul Viagens. Marcas citadas pertencem aos seus donos.

---

## Leia antes de usar

- **O uso é por sua conta e risco.** Sem garantia de funcionamento, de resultado
  ou de suporte.
- **Você não vê as políticas do hotel pelo caminho.** No fluxo normal existe uma
  página, antes da confirmação, que mostra cancelamento, check-in/check-out e
  taxas cobradas no destino. Este atalho não passa por ela. **Confira essas
  condições na tela de confirmação antes de finalizar o resgate.**
- **Ele não reserva nada.** Para na tela de confirmação; aplicar o cupom e
  concluir é você quem faz.
- **Seus dados ficam no seu navegador.** O botão "Padrão" grava os passageiros no
  `localStorage` do próprio site, na sua máquina. Nada é enviado para servidor
  nenhum — este projeto não tem back-end.
- **Pode parar de funcionar a qualquer momento**, sem aviso, se o site mudar.

## Como funciona

1. Lê o `results.ashx` da sua sessão de busca: tarifas (hotel, quarto, pontos,
   preço), a data de check-in e a composição de passageiros que a busca pediu.
2. Monta um painel na tela de resultados com a lista de tarifas na mesma ordem
   que você está vendo, e um campo por passageiro.
3. Consulta o documento em `/booking/handlers/getHolderInfo.ashx` — o mesmo
   request do link "Validar CPF" do site — e preenche nome, sobrenome, data de
   nascimento e número TudoAzul quando existe cadastro.
4. Ao confirmar, faz a mesma sequência de dois POSTs que o site faz: um para
   selecionar a tarifa na sessão, outro (`action=book`) que cria a reserva e
   navega para a tela de confirmação.

Tudo roda na sua sessão logada, no seu navegador.

## Estrutura

    src/azul_paxes_page2.js    o script (fonte legível, comentado)
    build_bookmarklet.js       gera o bookmarklet + a página de instalação
    docs/index.html            a página publicada no GitHub Pages
    docs/bookmarklet.js        o código que o favorito (loader) baixa a cada uso
    test/                      teste offline (jsdom), fixtures sem dado pessoal
    CHANGELOG.md               o que mudou em cada versão
    KOFI.md                    textos de divulgação

## Build

    npm install
    npm run build          # = node build_bookmarklet.js

Gera `dist/azul-bookmarklet-v<versão>.html` (a página), o `.txt` com a URL
`javascript:` e `dist/bookmarklet.js`. Para publicar, copie
`dist/azul-bookmarklet-v<versão>.html` para `docs/index.html` e
`dist/bookmarklet.js` para `docs/bookmarklet.js`. O Pages publica `docs/` do
`main`: o merge é a publicação.

## Teste

    npm test

Roda o painel numa página de resultados de mentira (jsdom + jQuery 1.12.4), com
`fetch` simulado. Nenhuma requisição sai para o site. Cobre a leitura das idades
das crianças, as travas do POST 2 e o build minificado de `docs/`.

A versão sai da constante `VERSION` no topo do script. Quem já instalou precisa
**reinstalar o favorito** para receber uma versão nova — o código mora dentro do
próprio favorito.

Minificação usa [terser](https://terser.org) quando disponível; sem ele o build
usa o fonte, e funciona igual (só maior).

## Suporte

Deu problema? No rodapé do painel, clique em **🩺 Diagnóstico**: ele copia um relatório técnico
(versão, em que etapa parou, último erro) **sem nenhum dado pessoal**. Abra uma
issue com esse texto.

## Apoie

É de graça e vai continuar sendo. Mas se ele te poupou meia hora de formulário —
ou uns bons milheiros — me paga um cafezinho de aeroporto. Você sabe o preço.

☕ https://ko-fi.com/eduoct
