# Texto para o Ko-fi

Copie os blocos abaixo. Onde estiver `[LINK]`, ponha o endereço da página de
instalação (`azul-bookmarklet-vX.Y.Z.html` hospedado em algum lugar).

Ko-fi: https://ko-fi.com/eduoct (já está embutido na página e no rodapé do painel).

---

## Título da página

**Reserva TudoAzul — atalho para a tela de cupom**

---

## Descrição curta (aquela linha embaixo do nome)

Atalho de navegador que preenche os passageiros e leva direto para a tela de
confirmação do TudoAzul, onde fica o campo de cupom. Grátis.

---

## Descrição da página

Quem já tentou resgatar hotel no TudoAzul conhece a cena: você acha a tarifa,
clica em resgatar e a tela trava porque o saldo não cobre o valor cheio — mesmo
quando você tem um cupom que faria caber.

Este é um **bookmarklet**: um atalho que fica na barra de favoritos do navegador.
Você faz a busca normalmente, clica nele na tela de resultados, escolhe a tarifa,
informa os CPFs e ele leva você até a tela de confirmação — que é onde o campo de
cupom existe.

**O que ele faz**

- lê as tarifas da sua busca (hotel, tipo de quarto, pontos, preço) e monta um menu
- descobre sozinho quantos adultos e crianças a busca pediu
- consulta o CPF no cadastro do TudoAzul e preenche nome e data de nascimento
- guarda os passageiros que você usa sempre, para não redigitar a cada busca
- tem um botão "Simular" que mostra tudo o que será enviado, sem enviar nada

**O que ele NÃO faz**

- não finaliza resgate: ele para na tela de confirmação, o resto é você
- não aplica cupom sozinho
- não manda nada para mim: tudo roda no seu navegador, na sua sessão logada
- não funciona em celular

**Antes de instalar, leia**

O uso é **por sua conta e risco**. Projeto independente, sem qualquer vínculo com
a Azul, sem garantia de funcionamento, resultado ou suporte.

Ele **pula a página de reserva do site** — e é ali que aparecem as políticas do
hotel (cancelamento, check-in/check-out, taxas cobradas no destino). **Leia essas
condições na tela de confirmação antes de finalizar qualquer resgate.** O painel
avisa quando a tarifa é não reembolsável, mas o resto das regras é com você.

Se você usar o botão "Padrão", os dados dos passageiros (nome, CPF, nascimento)
ficam salvos **no seu próprio navegador**. Não saem da sua máquina. Em computador
compartilhado, use o botão de apagar.

E pode parar de funcionar a qualquer momento: depende de como o site está montado
hoje. Se a Azul mudar alguma coisa, quebra.

**Instalação e instruções:** [LINK]

Se te economizou tempo (ou pontos), um café ajuda a manter isso funcionando quando
o site mudar. Se não puder, usa do mesmo jeito — é de graça.

---

## "Buy me a..."

    cafezinho de aeroporto

---

## Mensagem automática de agradecimento

    Obrigado! De verdade. É esse tipo de apoio que me faz continuar mexendo no
    script quando a Azul muda alguma coisa no site — e ela muda. Achou bug ou
    algo estranho? Me manda o print que eu olho.

---

## Post para os grupos de viagem

    Fiz um atalho de navegador para a tela de resgate de hotel do TudoAzul.

    Ele preenche os passageiros (consulta o CPF e traz nome e nascimento do
    cadastro), deixa escolher a tarifa numa lista e leva direto pra tela de
    confirmação, onde fica o campo de cupom.

    É de graça, roda no seu navegador, não passa por servidor nenhum. Não
    finaliza resgate: para na confirmação e você decide.

    Instalação e o que ele faz/não faz: [LINK]

    Aviso importante: ele pula a página de reserva do site, que é onde aparecem
    as políticas do hotel. Leia as condições na tela de confirmação antes de
    fechar qualquer coisa. Uso por sua conta e risco.

---

## Quando lançar uma versão nova

1. Suba o `VERSION` em `azul_paxes_page2.js`
2. `node scripts/azul/build_bookmarklet.js`
3. Publique o `.html` novo e atualize o `[LINK]`
4. Avise no Ko-fi/grupo que precisa **reinstalar o favorito** — o código fica
   dentro do favorito, então versão nova só chega reinstalando
