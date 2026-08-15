#!/usr/bin/env node
/* Empacota azul_paxes_page2.js como bookmarklet + página de instalação.
 *
 *   node scripts/azul/build_bookmarklet.js
 *
 * Gera em dist/:
 *   azul-bookmarklet-v<versão>.html   página de instalação (é o que se publica)
 *   azul-bookmarklet-v<versão>.txt    só a URL javascript:, pra colar na mão
 *
 * A versão sai do próprio script (var VERSION = '...'). Minifica com terser
 * se estiver disponível; sem ele, usa o fonte (funciona igual, só maior).
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'azul_paxes_page2.js');
const OUT_DIR = path.join(__dirname, 'dist');
const PAGES = 'https://eduoct.github.io/reserva-tudoazul';

async function main() {
  const source = fs.readFileSync(SRC, 'utf8');
  const versao = (/var VERSION = '([^']+)'/.exec(source) || [, '0.0.0'])[1];
  const kofi = (/var KOFI = '([^']+)'/.exec(source) || [, ''])[1];

  let code = source;
  let how = 'sem minificação (terser não instalado)';
  try {
    // terser vive no sandbox de teste; não há node_modules ao lado do script
    const { minify } = require(process.env.TERSER || '/tmp/azultest/node_modules/terser');
    const res = await minify(source, {
      compress: { passes: 2 },
      mangle: true,
      format: { comments: false }
    });
    if (res.code) { code = res.code; how = 'minificado'; }
  } catch (e) {
    if (e && e.code !== 'MODULE_NOT_FOUND') throw e;
  }

  const bookmarklet = 'javascript:' + encodeURIComponent(code);
  const base = `azul-bookmarklet-v${versao}`;

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, base + '.txt'), bookmarklet);

  // Código servido pelo Pages, sempre a última versão.
  fs.writeFileSync(path.join(OUT_DIR, 'bookmarklet.js'), code);

  // Carregador: o favorito só busca o código lá e injeta. Assim a pessoa
  // instala uma vez e recebe as correções sem reinstalar nada.
  // Tenta <script src> (respeita CSP); se o navegador bloquear, cai para
  // fetch + eval; se nem isso, manda usar a versão fixa.
  const loaderSrc = `(function () {
  var u = '${PAGES}/bookmarklet.js?v=' + Date.now();
  function falhou(m) {
    alert('Reserva TudoAzul\\n\\n' + m + '\\n\\nUse a versão fixa (offline) da página de instalação:\\n${PAGES}');
  }
  var s = document.createElement('script');
  s.src = u;
  s.onerror = function () {
    fetch(u, { cache: 'no-store' })
      .then(function (r) { return r.text(); })
      .then(function (t) { try { (0, eval)(t); } catch (e) { falhou('O navegador bloqueou a execução do código baixado.'); } })
      .catch(function () { falhou('Não consegui baixar o código (sem internet ou GitHub fora do ar).'); });
  };
  document.body.appendChild(s);
})();`;
  const loader = 'javascript:' + encodeURIComponent(loaderSrc);
  fs.writeFileSync(path.join(OUT_DIR, 'loader.txt'), loader);

  const html = `<!doctype html>
<html lang="pt-BR">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Reserva TudoAzul v${versao} — instalação</title>
<style>
  :root { color-scheme: dark }
  * { box-sizing: border-box }
  body { font: 16px/1.65 system-ui, "Segoe UI", Arial; background:#0b1220; color:#e6edf7;
         margin:0; padding:32px 20px 80px; display:flex; justify-content:center }
  main { max-width:680px; width:100% }
  h1 { font-size:26px; margin:0 0 2px }
  h2 { font-size:18px; margin:34px 0 10px; color:#e6edf7 }
  .ver { color:#8aa0b8; font-size:13px; margin:0 0 28px }
  p, li { color:#c9d6e5 }
  a.drag { display:inline-block; background:#0a2540; color:#fff; text-decoration:none;
           padding:14px 26px; border-radius:8px; font-weight:600; font-size:17px;
           border-left:5px solid #00a3e0; box-shadow:0 6px 22px rgba(0,0,0,.45) }
  .hint { color:#8aa0b8; font-size:13px; margin-top:10px }
  code { background:#101828; padding:2px 6px; border-radius:4px; font-size:14px }
  ol li { margin:8px 0 }
  .box { border-radius:8px; padding:14px 16px; margin:18px 0 }
  .risco { border:1px solid #fc818155; background:#2d1414 }
  .risco h2 { margin-top:0; color:#fc8181 }
  .aviso { border-left:3px solid #ecc94b; background:#1a1a10 }
  .ok { border-left:3px solid #48bb78; background:#0f1a14 }
  textarea { width:100%; height:110px; margin-top:8px; background:#101828; color:#8aa0b8;
             border:1px solid #2d3748; border-radius:6px; padding:8px; font:11px monospace }
  footer { color:#5c6b7f; font-size:13px; margin-top:44px; border-top:1px solid #1e2836; padding-top:16px }
</style>
<main>
  <h1>Reserva TudoAzul</h1>
  <p class="ver">versão ${versao} · ${how} · ${(bookmarklet.length / 1024).toFixed(1)} KB</p>

  <p>Um atalho para a tela de resgate de hotéis do TudoAzul. Ele monta os dados dos
  passageiros e leva direto para a página de confirmação — que é onde fica o campo de cupom.</p>

  <div class="box risco">
    <h2>Leia antes de instalar</h2>
    <p><strong>O uso é por sua conta e risco.</strong> Isto não é um produto oficial da Azul,
    não tem qualquer relação com a empresa e não vem com garantia de funcionamento,
    de resultado ou de suporte. Ao instalar e usar, você assume a responsabilidade
    pelo que fizer com ele.</p>
    <p><strong>Você não vê as políticas do hotel pelo caminho.</strong> No fluxo normal do site
    existe uma página, antes da confirmação, que mostra as regras do hotel: cancelamento,
    horário de check-in e check-out, taxas cobradas no destino. Este atalho não passa por
    ela. Nada é reservado nesse pulo — mas <strong>confira essas condições na tela de
    confirmação antes de finalizar o resgate</strong>. O painel avisa quando a tarifa é não
    reembolsável; o resto das regras é por sua conta.</p>
    <p><strong>Seus dados ficam no seu navegador.</strong> Se você usar o botão "Padrão", nome,
    CPF, data de nascimento e número TudoAzul dos passageiros ficam salvos no
    <code>localStorage</code> do site, na sua máquina. Nada é enviado para mim nem para
    lugar nenhum. Em computador compartilhado, use o botão 🗑 para apagar.</p>
    <p><strong>Pode parar de funcionar a qualquer momento.</strong> Ele depende de como o site está
    montado hoje. Se a Azul mudar alguma coisa, quebra — e pode quebrar sem aviso.</p>
  </div>

  <h2>Instalar</h2>
  <p>Arraste o botão abaixo para a sua barra de favoritos:</p>
  <p><a class="drag" href="${loader.replace(/"/g, '&quot;')}">🐦 Reserva TudoAzul</a></p>
  <div class="hint">Não está vendo a barra de favoritos? <code>Ctrl+Shift+B</code> no Windows,
  <code>Cmd+Shift+B</code> no Mac.</div>
  <div class="box ok" style="margin-top:14px">
    <strong>Instala uma vez e pronto.</strong> Este favorito busca o código atualizado aqui a cada
    uso — quando eu corrijo alguma coisa, você recebe sem reinstalar nada.
  </div>
  <details style="margin-top:10px">
    <summary style="cursor:pointer;color:#8aa0b8">Prefere uma versão fixa, que não busca nada online?</summary>
    <p class="hint">Este outro favorito carrega a v${versao} inteira de dentro dele. Não depende do
    GitHub, mas também não se atualiza — para trocar de versão você reinstala.</p>
    <p><a class="drag" style="font-size:15px;padding:10px 18px"
          href="${bookmarklet.replace(/"/g, '&quot;')}">🐦 Reserva TudoAzul v${versao} (fixa)</a></p>
  </details>

  <h2>Usar</h2>
  <ol>
    <li>Entre no TudoAzul e <strong>faça login</strong>.</li>
    <li>Faça a busca de hotel normalmente, com a quantidade certa de pessoas.</li>
    <li>Na tela de resultados, clique no favorito. O painel abre no canto direito.</li>
    <li>Escolha o hotel e a tarifa no menu. A lista segue a ordem da tela.</li>
    <li>Informe o documento de cada passageiro e clique em <strong>Consultar CPFs</strong> — se
        houver cadastro no TudoAzul, nome e nascimento vêm preenchidos. Se não houver,
        digite à mão.</li>
    <li>Se são sempre as mesmas pessoas, <strong>💾 Salvar</strong> guarda o padrão para as
        próximas buscas.</li>
    <li><strong>Continuar para o cupom</strong> leva para a tela de confirmação, onde fica o
        campo de cupom.</li>
  </ol>

  <div class="box ok">
    <strong>Ele não reserva nada.</strong> O atalho para na tela de confirmação. Aplicar o
    cupom e concluir o resgate continua sendo você quem faz — e é lá que dá para conferir
    as condições antes de fechar.
  </div>

  <div class="box aviso">
    <strong>Deu problema?</strong> Clique no 🩺 do painel: ele copia um diagnóstico técnico
    (versão, em que etapa parou, último erro) sem nenhum dado pessoal. Mande esse texto
    junto com o relato.
  </div>

  <h2>Requisitos</h2>
  <ul>
    <li>Navegador de computador (Chrome, Edge, Firefox ou Brave). Em celular não funciona.</li>
    <li>Estar logado no TudoAzul.</li>
  </ul>

  <details style="margin-top:28px">
    <summary style="cursor:pointer;color:#8aa0b8">Instalar na mão (se o arrastar não funcionar)</summary>
    <p class="hint">Crie um favorito novo com qualquer nome e cole o texto abaixo no campo de
    endereço. Se o navegador apagar o <code>javascript:</code> do começo, digite de volta antes de salvar.</p>
    <textarea readonly onclick="this.select()">${loader.replace(/</g, '&lt;')}</textarea>
  </details>

  <div class="box ok" style="text-align:center">
    <p style="margin:0 0 4px;font-size:18px"><strong>Salvou a sua viagem?</strong></p>
    <p style="margin:0 0 14px">Isto é de graça e vai continuar sendo. Mas se ele te poupou meia hora
    de formulário — ou uns bons milheiros — me paga um <strong>cafezinho de aeroporto</strong>.
    Você sabe o preço.</p>
    <p style="margin:0"><a href="${kofi}" target="_blank" rel="noopener"
       style="display:inline-block;background:#00a3e0;color:#062033;text-decoration:none;
              padding:13px 26px;border-radius:8px;font-weight:600;font-size:17px">☕ Pagar um cafezinho de aeroporto</a></p>
    <p class="hint" style="margin:10px 0 0">Sem cadastro, sem assinatura. Você escolhe o valor.</p>
  </div>

  <footer>
    Reserva TudoAzul v${versao} — projeto independente, sem vínculo com a Azul Linhas Aéreas
    ou com a Azul Viagens. Marcas citadas pertencem aos seus donos.<br>
    <a href="${kofi}" target="_blank" rel="noopener" style="color:#5c6b7f">${kofi.replace('https://', '')}</a>
  </footer>
</main>
</html>`;

  fs.writeFileSync(path.join(OUT_DIR, base + '.html'), html);

  console.log('versão:     ', versao);
  console.log('fonte:      ', (source.length / 1024).toFixed(1), 'KB');
  console.log('bookmarklet:', (bookmarklet.length / 1024).toFixed(1), 'KB', '(' + how + ')');
  console.log('loader:     ', (loader.length / 1024).toFixed(2), 'KB  ->', path.join(OUT_DIR, 'loader.txt'));
  console.log('bookmarklet.js (Pages):', path.join(OUT_DIR, 'bookmarklet.js'));
  console.log('gerado:     ', path.join(OUT_DIR, base + '.html'));
}

main().catch(e => { console.error(e); process.exit(1); });
